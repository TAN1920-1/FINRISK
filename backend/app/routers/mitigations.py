"""Mitigation workflow API.

A mitigation records *planned work*, not proof that a risk has been removed.
Closing an action therefore never silently lowers the risk register's residual
score: the residual only moves when an analyst records explicit post-mitigation
likelihood/impact values (see ``PATCH /api/risks/{id}``).
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import domain
from ..audit import record_audit
from ..deps import CanManage, CanWrite, Paging, SessionDep, Tenant, TenantContext, client_ip
from ..models import Membership, Mitigation, Risk, User, utcnow
from ..schemas import (
    Message,
    MitigationCreate,
    MitigationOut,
    MitigationStatusOut,
    MitigationStatusUpdate,
    MitigationUpdate,
    Page,
)
from ..serializers import mitigation_out
from ..services.common import build_page, count_for, next_reference, ordered
from ..services.notifications import notify_user

router = APIRouter(prefix="/api/mitigations", tags=["mitigations"])

SORTABLE = {
    "action_ref": Mitigation.action_ref,
    "description": Mitigation.description,
    "priority": Mitigation.priority,
    "status": Mitigation.status,
    "due_date": Mitigation.due_date,
    "estimated_cost": Mitigation.estimated_cost,
    "created_at": Mitigation.created_at,
    "updated_at": Mitigation.updated_at,
}

#: Statuses after which nothing is outstanding any more.
FINAL_STATUSES: frozenset[str] = frozenset(
    {domain.MitigationStatus.COMPLETED.value, domain.MitigationStatus.CANCELLED.value}
)

_RESIDUAL_NOTE = (
    "The action status was updated. The risk's residual score is unchanged: record explicit "
    "post-mitigation likelihood and impact on the risk to move it."
)


def _is_overdue(mitigation: Mitigation) -> bool:
    if mitigation.status in FINAL_STATUSES or mitigation.due_date is None:
        return False
    return mitigation.due_date < date.today()


def _get_risk(db: Session, organization_id: int, risk_id: int) -> Risk:
    risk = db.execute(
        select(Risk).where(Risk.id == risk_id, Risk.organization_id == organization_id)
    ).scalar_one_or_none()
    if risk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk not found.")
    return risk


def _get_mitigation(db: Session, organization_id: int, mitigation_id: int) -> Mitigation:
    mitigation = db.execute(
        select(Mitigation).where(
            Mitigation.id == mitigation_id, Mitigation.organization_id == organization_id
        )
    ).scalar_one_or_none()
    if mitigation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mitigation not found.")
    return mitigation


def _context(db: Session, mitigations: list[Mitigation]) -> list[MitigationOut]:
    """Attach the parent risk reference and the assignee's name in two queries."""
    if not mitigations:
        return []
    risk_ids = {item.risk_id for item in mitigations}
    user_ids = {item.assigned_user_id for item in mitigations if item.assigned_user_id}

    risks = {risk.id: risk for risk in db.execute(select(Risk).where(Risk.id.in_(risk_ids))).scalars()}
    users: dict[int, User] = {}
    if user_ids:
        users = {user.id: user for user in db.execute(select(User).where(User.id.in_(user_ids))).scalars()}

    results: list[MitigationOut] = []
    for mitigation in mitigations:
        payload = mitigation_out(
            mitigation,
            risk=risks.get(mitigation.risk_id),
            assignee=users.get(mitigation.assigned_user_id) if mitigation.assigned_user_id else None,
        )
        results.append(payload.model_copy(update={"is_overdue": _is_overdue(mitigation)}))
    return results


def _validate_assignee(db: Session, organization_id: int, user_id: Optional[int]) -> None:
    """Refuse to assign work to somebody outside the organization."""
    if user_id is None:
        return
    member = db.execute(
        select(Membership.id).where(
            Membership.user_id == user_id, Membership.organization_id == organization_id
        )
    ).first()
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The assignee is not a member of this organization.",
        )


def _notify_assignee(
    db: Session,
    tenant: TenantContext,
    mitigation: Mitigation,
    risk: Risk,
    *,
    assigned_now: bool,
) -> None:
    """Tell the assignee about newly assigned work.

    Self-assignment is skipped: notifying yourself about an action you just
    created is noise.  ``assigned_now`` reports whether the assignment is new
    (creation) or was part of an update.
    """
    if mitigation.assigned_user_id is None or mitigation.assigned_user_id == tenant.user.id:
        return
    notify_user(
        db,
        organization_id=tenant.organization_id,
        user_id=mitigation.assigned_user_id,
        title=f"Remediation action {mitigation.action_ref} assigned to you",
        body=(
            f"{risk.risk_ref} - {risk.title}: {mitigation.description}"
            + ("" if assigned_now else " (reassigned)")
        ),
        level="info",
        link="/mitigation-plans",
    )


@router.get("/meta", summary="Filter vocabularies for the mitigation pages")
def mitigation_meta(tenant: Tenant) -> dict:
    return {
        "statuses": [item.value for item in domain.MitigationStatus],
        "priorities": [item.value for item in domain.Severity],
        "final_statuses": sorted(FINAL_STATUSES),
    }


@router.get("", response_model=Page[MitigationOut], summary="List mitigations")
def list_mitigations(
    tenant: Tenant,
    db: SessionDep,
    paging: Paging,
    q: Annotated[Optional[str], Query(max_length=120)] = None,
    state: Annotated[Optional[domain.MitigationStatus], Query(alias="status")] = None,
    priority: Annotated[Optional[domain.Severity], Query()] = None,
    risk_id: Annotated[Optional[int], Query()] = None,
    assigned_user_id: Annotated[Optional[int], Query()] = None,
    overdue_only: Annotated[bool, Query()] = False,
    open_only: Annotated[bool, Query()] = False,
) -> Page[MitigationOut]:
    stmt = select(Mitigation).where(Mitigation.organization_id == tenant.organization_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Mitigation.description.ilike(like), Mitigation.action_ref.ilike(like)))
    if state:
        stmt = stmt.where(Mitigation.status == state.value)
    if priority:
        stmt = stmt.where(Mitigation.priority == priority.value)
    if risk_id is not None:
        stmt = stmt.where(Mitigation.risk_id == risk_id)
    if assigned_user_id is not None:
        stmt = stmt.where(Mitigation.assigned_user_id == assigned_user_id)
    if open_only or overdue_only:
        stmt = stmt.where(Mitigation.status.notin_(sorted(FINAL_STATUSES)))
    if overdue_only:
        stmt = stmt.where(Mitigation.due_date < date.today())

    total = int(db.execute(count_for(stmt)).scalar_one())
    rows = (
        db.execute(
            ordered(stmt, paging, SORTABLE, Mitigation.due_date)
            .offset(paging.offset)
            .limit(paging.limit)
        )
        .scalars()
        .all()
    )
    return build_page(_context(db, list(rows)), total, paging)


@router.post(
    "",
    response_model=MitigationOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a mitigation action",
)
def create_mitigation(
    payload: MitigationCreate, request: Request, tenant: CanWrite, db: SessionDep
) -> MitigationOut:
    risk = _get_risk(db, tenant.organization_id, payload.risk_id)
    _validate_assignee(db, tenant.organization_id, payload.assigned_user_id)

    action_ref = payload.action_ref or next_reference(
        db, Mitigation, tenant.organization_id, "MIT", column="action_ref"
    )
    mitigation = Mitigation(
        organization_id=tenant.organization_id,
        risk_id=risk.id,
        action_ref=action_ref,
        **payload.model_dump(exclude={"risk_id", "action_ref"}),
    )
    db.add(mitigation)
    db.flush()
    record_audit(
        db,
        action=domain.AuditAction.MITIGATION_CREATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="mitigation",
        entity_id=mitigation.id,
        detail={"risk_ref": risk.risk_ref, "action_ref": action_ref},
        ip_address=client_ip(request),
    )
    _notify_assignee(db, tenant, mitigation, risk, assigned_now=True)
    db.commit()
    db.refresh(mitigation)
    return mitigation_out(mitigation, risk=risk)


@router.get("/{mitigation_id}", response_model=MitigationOut, summary="Fetch one mitigation")
def get_mitigation(mitigation_id: int, tenant: Tenant, db: SessionDep) -> MitigationOut:
    mitigation = _get_mitigation(db, tenant.organization_id, mitigation_id)
    return _context(db, [mitigation])[0]


@router.patch("/{mitigation_id}", response_model=MitigationOut, summary="Update a mitigation")
def update_mitigation(
    mitigation_id: int,
    payload: MitigationUpdate,
    request: Request,
    tenant: CanWrite,
    db: SessionDep,
) -> MitigationOut:
    mitigation = _get_mitigation(db, tenant.organization_id, mitigation_id)
    data = payload.model_dump(exclude_unset=True)
    reassigned = False

    if "assigned_user_id" in data:
        _validate_assignee(db, tenant.organization_id, data["assigned_user_id"])
        reassigned = data["assigned_user_id"] != mitigation.assigned_user_id

    new_status = data.get("status")
    for field, value in data.items():
        setattr(mitigation, field, value)

    if new_status is not None:
        if new_status == domain.MitigationStatus.COMPLETED and mitigation.completed_at is None:
            mitigation.completed_at = utcnow()
        elif new_status != domain.MitigationStatus.COMPLETED:
            mitigation.completed_at = None

    record_audit(
        db,
        action=domain.AuditAction.MITIGATION_UPDATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="mitigation",
        entity_id=mitigation.id,
        detail={"fields": sorted(data.keys())},
        ip_address=client_ip(request),
    )
    if reassigned:
        _notify_assignee(db, tenant, mitigation, _get_risk(db, tenant.organization_id, mitigation.risk_id), assigned_now=False)
    db.commit()
    db.refresh(mitigation)
    return _context(db, [mitigation])[0]


@router.post(
    "/{mitigation_id}/status",
    response_model=MitigationStatusOut,
    summary="Change a mitigation's status",
)
def set_mitigation_status(
    mitigation_id: int,
    payload: MitigationStatusUpdate,
    request: Request,
    tenant: CanWrite,
    db: SessionDep,
) -> MitigationStatusOut:
    mitigation = _get_mitigation(db, tenant.organization_id, mitigation_id)
    previous = mitigation.status
    mitigation.status = payload.status.value
    if payload.status == domain.MitigationStatus.COMPLETED:
        mitigation.completed_at = mitigation.completed_at or utcnow()
        if payload.note:
            mitigation.completion_notes = payload.note
    else:
        mitigation.completed_at = None

    record_audit(
        db,
        action=domain.AuditAction.MITIGATION_UPDATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="mitigation",
        entity_id=mitigation.id,
        detail={"from": previous, "to": payload.status.value, "note": payload.note},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(mitigation)

    risk = db.get(Risk, mitigation.risk_id)
    return MitigationStatusOut(
        mitigation=_context(db, [mitigation])[0],
        risk_residual_score=risk.residual_score if risk else None,
        residual_severity=risk.residual_severity if risk else None,
        note=_RESIDUAL_NOTE,
    )


@router.delete("/{mitigation_id}", response_model=Message, summary="Delete a mitigation")
def delete_mitigation(
    mitigation_id: int, request: Request, tenant: CanManage, db: SessionDep
) -> Message:
    mitigation = _get_mitigation(db, tenant.organization_id, mitigation_id)
    reference = mitigation.action_ref
    db.delete(mitigation)
    record_audit(
        db,
        action=domain.AuditAction.MITIGATION_DELETED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="mitigation",
        entity_id=mitigation_id,
        detail={"action_ref": reference},
        ip_address=client_ip(request),
    )
    db.commit()
    return Message(message="Mitigation deleted.")
