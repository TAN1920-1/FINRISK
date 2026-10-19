"""Reusable FastAPI dependencies: authentication, tenant scoping, roles, paging."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Callable, Optional

import jwt
from fastapi import Depends, Header, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import domain
from .db import get_session
from .models import Membership, Organization, User
from .security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False, description="Bearer JWT issued by /api/auth/login")

SessionDep = Annotated[Session, Depends(get_session)]
CredentialsDep = Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer_scheme)]


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    request: Request,
    credentials: CredentialsDep,
    db: SessionDep,
) -> User:
    """Resolve the authenticated user from the bearer token."""
    if credentials is None or not credentials.credentials:
        raise _unauthorized()
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Session expired. Please sign in again.")
    except jwt.PyJWTError:
        raise _unauthorized("Invalid authentication token.")

    try:
        user_id = int(payload.get("sub", ""))
    except (TypeError, ValueError):
        raise _unauthorized("Invalid authentication token.")

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthorized("Account is not available.")

    if int(payload.get("ver", 0)) != int(user.token_version):
        raise _unauthorized("Session is no longer valid. Please sign in again.")

    # Remembered so that tenant resolution can honour the token's organization.
    request.state.token_organization_id = payload.get("org")

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


@dataclass(slots=True)
class TenantContext:
    """Authenticated user plus the organization they are acting within."""

    user: User
    organization: Organization
    membership: Membership
    role: str

    @property
    def organization_id(self) -> int:
        return self.organization.id

    @property
    def rank(self) -> int:
        return domain.ROLE_RANK.get(self.role, 0)

    def can(self, minimum: domain.Role) -> bool:
        return self.rank >= domain.ROLE_RANK[minimum.value]


def get_tenant_context(
    request: Request,
    db: SessionDep,
    user: CurrentUser,
    x_organization_id: Annotated[Optional[int], Header(alias="X-Organization-Id")] = None,
) -> TenantContext:
    """Resolve the active organization and verify the caller is a member of it.

    The organization is taken from the ``X-Organization-Id`` header when
    supplied, otherwise from the token claim, otherwise the user's first
    membership.  Membership is always re-checked against the database, so a
    client can never widen its own access by editing a token or a header.
    """
    memberships = db.execute(
        select(Membership).where(Membership.user_id == user.id)
    ).scalars().all()

    if not memberships:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not a member of any organization.",
        )

    candidate_ids = {m.organization_id for m in memberships}
    if x_organization_id is not None and x_organization_id not in candidate_ids:
        # Applies to every account, superusers included. Silently falling back to
        # one of the caller's own organizations would answer a request for
        # organization X with organization Y's data.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this organization.",
        )

    target_id = x_organization_id
    if target_id is None:
        claim = getattr(request.state, "token_organization_id", None)
        target_id = claim if claim in candidate_ids else None

    membership = next((m for m in memberships if m.organization_id == target_id), None)
    if membership is None:
        membership = memberships[0]

    organization = db.get(Organization, membership.organization_id)
    if organization is None or not organization.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization is not available.")

    return TenantContext(
        user=user,
        organization=organization,
        membership=membership,
        role=membership.role,
    )


Tenant = Annotated[TenantContext, Depends(get_tenant_context)]


def require_role(*allowed: domain.Role) -> Callable[[TenantContext], TenantContext]:
    """Dependency factory enforcing that the caller holds one of ``allowed`` roles."""

    allowed_values = {role.value for role in allowed}

    def _dependency(tenant: Tenant) -> TenantContext:
        if tenant.user.is_superuser or tenant.role in allowed_values:
            return tenant
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role does not permit this action.",
        )

    return _dependency


def require_minimum_role(minimum: domain.Role) -> Callable[[TenantContext], TenantContext]:
    """Dependency factory for an ordered role requirement (minimum privilege)."""

    threshold = domain.ROLE_RANK[minimum.value]

    def _dependency(tenant: Tenant) -> TenantContext:
        if tenant.user.is_superuser or tenant.rank >= threshold:
            return tenant
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This action requires the {minimum.value} role or higher.",
        )

    return _dependency


#: Write access to the risk register.
CanWrite = Annotated[TenantContext, Depends(require_minimum_role(domain.Role.ANALYST))]
#: Administrative operations (users, organization settings, model training).
CanManage = Annotated[TenantContext, Depends(require_minimum_role(domain.Role.RISK_MANAGER))]
CanAdminister = Annotated[TenantContext, Depends(require_minimum_role(domain.Role.ADMIN))]


class Pagination:
    """Shared query-parameter handling for list endpoints."""

    def __init__(
        self,
        page: Annotated[int, Query(ge=1, le=10_000)] = 1,
        page_size: Annotated[int, Query(ge=1, le=200)] = 25,
        sort: Annotated[Optional[str], Query(max_length=60)] = None,
        order: Annotated[str, Query(pattern="^(asc|desc)$")] = "desc",
    ) -> None:
        self.page = page
        self.page_size = page_size
        self.sort = sort
        self.order = order

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    @property
    def limit(self) -> int:
        return self.page_size


Paging = Annotated[Pagination, Depends(Pagination)]


def client_ip(request: Request) -> Optional[str]:
    """Best-effort client address for the audit trail."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else None
