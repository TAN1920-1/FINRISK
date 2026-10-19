"""Authentication and session endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, select

from .. import domain
from ..audit import record_audit
from ..config import settings
from ..deps import CanAdminister, CanManage, CurrentUser, SessionDep, Tenant, client_ip
from ..models import Membership, Organization, User, utcnow
from ..schemas import (
    LoginRequest,
    MemberCreate,
    MemberOut,
    MemberRoleUpdate,
    Message,
    OrganizationOut,
    PasswordChangeRequest,
    RegisterRequest,
    SessionContext,
    TokenResponse,
    UserOut,
)
from ..security import (
    PasswordPolicyError,
    create_access_token,
    hash_password,
    login_limiter,
    validate_password_strength,
    verify_password,
)
from ..services.common import unique_slug
from ..services.notifications import notify_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _organizations_for(db, user: User) -> list[OrganizationOut]:
    rows = db.execute(
        select(Membership, Organization)
        .join(Organization, Organization.id == Membership.organization_id)
        .where(Membership.user_id == user.id)
        .order_by(Organization.name)
    ).all()

    payload: list[OrganizationOut] = []
    for membership, organization in rows:
        member_count = db.execute(
            select(func.count()).select_from(Membership).where(
                Membership.organization_id == organization.id
            )
        ).scalar_one()
        payload.append(
            OrganizationOut.model_validate(organization).model_copy(
                update={"role": membership.role, "member_count": int(member_count)}
            )
        )
    return payload


def _issue_session(db, user: User, organization: Organization, role: str) -> TokenResponse:
    token, expires_at = create_access_token(
        user_id=user.id,
        email=user.email,
        token_version=user.token_version,
        organization_id=organization.id,
        role=role,
    )
    return TokenResponse(
        access_token=token,
        expires_at=expires_at,
        user=UserOut.model_validate(user),
        organizations=_organizations_for(db, user),
        active_organization_id=organization.id,
        role=role,
        permissions=domain.permissions_for(role),
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, request: Request, db: SessionDep) -> TokenResponse:
    """Create a user together with a new organization, or bootstrap the first admin.

    Open registration is disabled automatically when ``ENVIRONMENT=production``;
    the very first account may always be created so a fresh deployment can be
    provisioned (see README "Bootstrapping the first administrator").
    """
    existing_users = db.execute(select(func.count()).select_from(User)).scalar_one()
    if existing_users and not settings.allow_open_registration:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Self-registration is disabled. Ask an administrator to invite you.",
        )

    try:
        validate_password_strength(payload.password)
    except PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    email = payload.email.strip().lower()
    if db.execute(select(User.id).where(func.lower(User.email) == email)).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email address already exists.",
        )

    slug_base = payload.organization_slug or payload.organization_name

    user = User(
        email=email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        is_superuser=not bool(existing_users),
    )
    db.add(user)
    db.flush()

    organization = Organization(
        name=payload.organization_name.strip(),
        slug=unique_slug(db, Organization, slug_base),
        currency="USD",
    )
    db.add(organization)
    db.flush()

    db.add(
        Membership(
            user_id=user.id,
            organization_id=organization.id,
            role=domain.Role.ADMIN.value,
            job_title="Owner",
        )
    )

    record_audit(
        db,
        action=domain.AuditAction.USER_REGISTERED.value,
        user=user,
        organization_id=organization.id,
        entity_type="user",
        entity_id=user.id,
        detail={"organization": organization.name},
        ip_address=client_ip(request),
    )
    record_audit(
        db,
        action=domain.AuditAction.ORGANIZATION_CREATED.value,
        user=user,
        organization_id=organization.id,
        entity_type="organization",
        entity_id=organization.id,
    )

    db.commit()
    db.refresh(user)
    return _issue_session(db, user, organization, domain.Role.ADMIN.value)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: SessionDep) -> TokenResponse:
    """Authenticate with email and password."""
    email = payload.email.strip().lower()
    limiter_key = f"{email}|{client_ip(request) or 'unknown'}"
    if not login_limiter.check(limiter_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Too many sign-in attempts. Try again in "
                f"{login_limiter.retry_after(limiter_key)} seconds."
            ),
        )

    user = db.execute(select(User).where(func.lower(User.email) == email)).scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        record_audit(
            db,
            action=domain.AuditAction.LOGIN_FAILED.value,
            entity_type="user",
            detail={"email": email},
            ip_address=client_ip(request),
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email address or password is incorrect.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="This account has been deactivated."
        )

    membership = db.execute(
        select(Membership)
        .where(Membership.user_id == user.id)
        .order_by(Membership.id)
    ).scalars().first()
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not linked to an organization yet.",
        )

    organization = db.get(Organization, membership.organization_id)
    if organization is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization not found.")

    user.last_login_at = utcnow()
    login_limiter.reset(limiter_key)
    record_audit(
        db,
        action=domain.AuditAction.LOGIN_SUCCEEDED.value,
        user=user,
        organization_id=organization.id,
        entity_type="user",
        entity_id=user.id,
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(user)

    return _issue_session(db, user, organization, membership.role)


@router.get("/me", response_model=SessionContext)
def read_session(tenant: Tenant, db: SessionDep) -> SessionContext:
    """Return the authenticated user, their organizations and capabilities."""
    return SessionContext(
        user=UserOut.model_validate(tenant.user),
        organizations=_organizations_for(db, tenant.user),
        active_organization_id=tenant.organization_id,
        role=tenant.role,
        permissions=domain.permissions_for(tenant.role),
    )


@router.post("/switch-organization/{organization_id}", response_model=TokenResponse)
def switch_organization(organization_id: int, db: SessionDep, user: CurrentUser) -> TokenResponse:
    """Issue a new token scoped to another organization the user belongs to."""
    membership = db.execute(
        select(Membership).where(
            Membership.user_id == user.id, Membership.organization_id == organization_id
        )
    ).scalar_one_or_none()
    organization = db.get(Organization, organization_id)

    if membership is None or organization is None or not organization.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this organization.",
        )

    return _issue_session(db, user, organization, membership.role)


@router.post("/password", response_model=Message)
def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    db: SessionDep,
    user: CurrentUser,
) -> Message:
    """Change the current user's password and invalidate existing tokens."""
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="The current password is incorrect."
        )
    try:
        validate_password_strength(payload.new_password)
    except PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    user.password_hash = hash_password(payload.new_password)
    user.token_version += 1
    record_audit(
        db,
        action=domain.AuditAction.PASSWORD_CHANGED.value,
        user=user,
        entity_type="user",
        entity_id=user.id,
        ip_address=client_ip(request),
    )
    db.commit()
    return Message(message="Password updated. Please sign in again on other devices.")


@router.post("/logout", response_model=Message)
def logout(request: Request, db: SessionDep, user: CurrentUser) -> Message:
    """Record the sign-out.  The client discards its token."""
    record_audit(
        db,
        action=domain.AuditAction.LOGOUT.value,
        user=user,
        entity_type="user",
        entity_id=user.id,
        ip_address=client_ip(request),
    )
    db.commit()
    return Message(message="Signed out.")


# ---------------------------------------------------------------------------
# Organization membership
# ---------------------------------------------------------------------------


@router.get("/members", response_model=list[MemberOut])
def list_members(tenant: Tenant, db: SessionDep) -> list[MemberOut]:
    rows = db.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.organization_id == tenant.organization_id)
        .order_by(User.full_name)
    ).all()
    return [
        MemberOut(
            id=membership.id,
            user_id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=membership.role,
            job_title=membership.job_title,
            created_at=membership.created_at,
        )
        for membership, user in rows
    ]


@router.patch("/members/{membership_id}", response_model=MemberOut)
def update_member_role(
    membership_id: int,
    payload: MemberRoleUpdate,
    request: Request,
    db: SessionDep,
    actor: CanManage,
) -> MemberOut:
    """Change a colleague's role inside the active organization."""
    membership = db.get(Membership, membership_id)
    if membership is None or membership.organization_id != actor.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found.")

    member = db.get(User, membership.user_id)
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if member.id == actor.user.id and payload.role != domain.Role.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove your own administrator role.",
        )

    previous = membership.role
    membership.role = payload.role.value
    record_audit(
        db,
        action=domain.AuditAction.MEMBER_ROLE_CHANGED.value,
        user=actor.user,
        organization_id=actor.organization_id,
        entity_type="membership",
        entity_id=membership.id,
        detail={"from": previous, "to": membership.role, "member": member.email},
        ip_address=client_ip(request),
    )
    db.commit()

    return MemberOut(
        id=membership.id,
        user_id=member.id,
        email=member.email,
        full_name=member.full_name,
        role=membership.role,
        job_title=membership.job_title,
        created_at=membership.created_at,
    )


@router.post("/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
def add_member(
    payload: MemberCreate,
    request: Request,
    db: SessionDep,
    actor: CanAdminister,
) -> MemberOut:
    """Add a user to the active organization with an explicit role.

    An administrator is the only role that may do this, and the new membership is
    always created inside the administrator's own organization: the tenant is
    taken from the authenticated session, never from the request body.

    If the email already belongs to a user, that account is attached to this
    organization instead of a duplicate being created; its existing password is
    left untouched. Otherwise a new user is created with the supplied password.
    """
    email = payload.email.strip().lower()

    existing_member = db.execute(
        select(Membership)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.organization_id == actor.organization_id,
            func.lower(User.email) == email,
        )
    ).scalar_one_or_none()
    if existing_member is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That person is already a member of this organization.",
        )

    user = db.execute(select(User).where(func.lower(User.email) == email)).scalar_one_or_none()
    created_user = user is None
    if created_user:
        try:
            validate_password_strength(payload.password)
        except PasswordPolicyError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
        user = User(
            email=email,
            full_name=payload.full_name.strip(),
            password_hash=hash_password(payload.password),
            is_superuser=False,
        )
        db.add(user)
        db.flush()

    membership = Membership(
        user_id=user.id,
        organization_id=actor.organization_id,
        role=payload.role.value,
        job_title=payload.job_title.strip() if payload.job_title else None,
    )
    db.add(membership)
    db.flush()

    record_audit(
        db,
        action=domain.AuditAction.MEMBER_INVITED.value,
        user=actor.user,
        organization_id=actor.organization_id,
        entity_type="membership",
        entity_id=membership.id,
        detail={
            "member": user.email,
            "role": membership.role,
            "account_created": created_user,
        },
        ip_address=client_ip(request),
    )
    notify_user(
        db,
        organization_id=actor.organization_id,
        user_id=user.id,
        title=f"You were added to {actor.organization.name}",
        body=(
            f"{actor.user.full_name or actor.user.email} gave you the "
            f"{membership.role.replace('_', ' ')} role. Sign in to review the register."
        ),
        level="info",
        link="/overview",
    )
    db.commit()
    db.refresh(membership)

    return MemberOut(
        id=membership.id,
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=membership.role,
        job_title=membership.job_title,
        created_at=membership.created_at,
    )


@router.get("/roles", response_model=list[str])
def list_roles() -> list[str]:
    """Expose the available roles so the UI never hardcodes them."""
    return [role.value for role in domain.Role]
