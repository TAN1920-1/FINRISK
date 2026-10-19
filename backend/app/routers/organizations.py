"""Organization (tenant) endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, select

from .. import domain
from ..audit import record_audit
from ..deps import CanManage, CurrentUser, SessionDep, Tenant
from ..models import Asset, Membership, Mitigation, Organization, Risk, VulnerabilityFinding
from ..schemas import OrganizationCreate, OrganizationOut, OrganizationUpdate
from ..services.common import unique_slug

router = APIRouter(prefix="/api/organizations", tags=["organizations"])


@router.get("", response_model=list[OrganizationOut])
def list_organizations(db: SessionDep, user: CurrentUser) -> list[OrganizationOut]:
    """Every organization the signed-in user belongs to."""
    rows = db.execute(
        select(Membership, Organization)
        .join(Organization, Organization.id == Membership.organization_id)
        .where(Membership.user_id == user.id)
        .order_by(Organization.name)
    ).all()

    result: list[OrganizationOut] = []
    for membership, organization in rows:
        member_count = db.execute(
            select(func.count()).select_from(Membership).where(
                Membership.organization_id == organization.id
            )
        ).scalar_one()
        result.append(
            OrganizationOut.model_validate(organization).model_copy(
                update={"role": membership.role, "member_count": int(member_count)}
            )
        )
    return result


@router.post("", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED)
def create_organization(
    payload: OrganizationCreate,
    request: Request,
    db: SessionDep,
    user: CurrentUser,
) -> OrganizationOut:
    """Create an additional organization; the creator becomes its administrator."""
    organization = Organization(
        name=payload.name.strip(),
        slug=unique_slug(db, Organization, payload.slug or payload.name),
        currency=payload.currency.upper(),
        industry=payload.industry,
    )
    db.add(organization)
    db.flush()

    db.add(
        Membership(
            user_id=user.id,
            organization_id=organization.id,
            role=domain.Role.ADMIN.value,
        )
    )
    record_audit(
        db,
        action=domain.AuditAction.ORGANIZATION_CREATED.value,
        user=user,
        organization_id=organization.id,
        entity_type="organization",
        entity_id=organization.id,
        detail={"name": organization.name},
    )
    db.commit()
    db.refresh(organization)
    return OrganizationOut.model_validate(organization).model_copy(update={"role": domain.Role.ADMIN.value})


@router.get("/current", response_model=OrganizationOut)
def read_current_organization(tenant: Tenant, db: SessionDep) -> OrganizationOut:
    member_count = db.execute(
        select(func.count()).select_from(Membership).where(
            Membership.organization_id == tenant.organization_id
        )
    ).scalar_one()
    return OrganizationOut.model_validate(tenant.organization).model_copy(
        update={"role": tenant.role, "member_count": int(member_count)}
    )


@router.patch("/current", response_model=OrganizationOut)
def update_current_organization(
    payload: OrganizationUpdate,
    request: Request,
    db: SessionDep,
    tenant: CanManage,
) -> OrganizationOut:
    organization = tenant.organization
    changes = payload.model_dump(exclude_unset=True)

    if "name" in changes and changes["name"]:
        organization.name = changes["name"].strip()
    if "currency" in changes and changes["currency"]:
        organization.currency = changes["currency"].upper()
    if "industry" in changes:
        organization.industry = changes["industry"]
    if "reporting_period_label" in changes:
        organization.reporting_period_label = changes["reporting_period_label"]

    record_audit(
        db,
        action="organization.updated",
        user=tenant.user,
        organization_id=organization.id,
        entity_type="organization",
        entity_id=organization.id,
        detail=changes,
    )
    db.commit()
    db.refresh(organization)
    return OrganizationOut.model_validate(organization)


@router.get("/current/summary", response_model=dict)
def organization_summary(tenant: Tenant, db: SessionDep) -> dict:
    """Compact counts used by the shell header and empty-state detection."""
    organization_id = tenant.organization_id

    def count(model, *conditions) -> int:
        stmt = select(func.count()).select_from(model).where(model.organization_id == organization_id)
        for condition in conditions:
            stmt = stmt.where(condition)
        return int(db.execute(stmt).scalar_one())

    total_risks = count(Risk)
    open_risks = count(Risk, Risk.status.in_(domain.OPEN_RISK_STATUSES))
    demo_risks = count(Risk, Risk.is_demo.is_(True))

    return {
        "organization_id": organization_id,
        "risks": total_risks,
        "open_risks": open_risks,
        "assets": count(Asset),
        "active_assets": count(Asset, Asset.is_active.is_(True)),
        "findings": count(VulnerabilityFinding),
        "open_findings": count(
            VulnerabilityFinding,
            VulnerabilityFinding.remediation_status.in_(
                [domain.RemediationStatus.OPEN.value, domain.RemediationStatus.IN_PROGRESS.value]
            ),
        ),
        "mitigations": count(Mitigation),
        "demo_risks": demo_risks,
        "data_state": (
            "empty" if total_risks == 0 else ("demo_only" if demo_risks == total_risks else "populated")
        ),
    }


@router.get("/current/check-access/{organization_id}", response_model=dict)
def check_access(organization_id: int, db: SessionDep, user: CurrentUser) -> dict:
    """Answer "can I open this organization?" without leaking its content."""
    if organization_id == 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid identifier.")
    membership = db.execute(
        select(Membership).where(
            Membership.user_id == user.id, Membership.organization_id == organization_id
        )
    ).scalar_one_or_none()
    return {"organization_id": organization_id, "allowed": membership is not None}
