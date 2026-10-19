"""Audit-trail API.

The audit trail is organization-scoped and readable by administrators only: it
records who did what, when, and from which address, so it is itself sensitive.

Entries are written by :mod:`app.audit` on the same transaction as the change
they describe, which is why this module only ever reads.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Query, Response
from sqlalchemy import or_, select

from .. import domain
from ..deps import CanAdminister, Paging, SessionDep
from ..models import AuditLog
from ..schemas import AuditLogOut, Page
from ..services.common import build_page, count_for, ordered
from ..services.exports import csv_response

router = APIRouter(prefix="/api/audit-logs", tags=["audit"])

SORTABLE = {
    "created_at": AuditLog.created_at,
    "action": AuditLog.action,
    "entity_type": AuditLog.entity_type,
    "user_email": AuditLog.user_email,
}

#: Every audited action, so the UI filter is driven by the server vocabulary.
ACTIONS: list[str] = sorted(action.value for action in domain.AuditAction)


def _filtered(
    organization_id: int,
    *,
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    user_id: Optional[int] = None,
    search: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
):
    stmt = select(AuditLog).where(AuditLog.organization_id == organization_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if user_id is not None:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                AuditLog.action.ilike(like),
                AuditLog.user_email.ilike(like),
                AuditLog.entity_type.ilike(like),
                AuditLog.entity_id.ilike(like),
            )
        )
    if start is not None:
        stmt = stmt.where(AuditLog.created_at >= start)
    if end is not None:
        stmt = stmt.where(AuditLog.created_at <= end)
    return stmt


@router.get("/meta", summary="Audit-trail filter vocabulary")
def audit_meta(tenant: CanAdminister) -> dict:
    return {"actions": ACTIONS}


@router.get("", response_model=Page[AuditLogOut], summary="List audit-trail entries")
def list_audit_logs(
    tenant: CanAdminister,
    db: SessionDep,
    paging: Paging,
    action: Annotated[Optional[str], Query(max_length=60)] = None,
    entity_type: Annotated[Optional[str], Query(max_length=60)] = None,
    user_id: Annotated[Optional[int], Query()] = None,
    q: Annotated[Optional[str], Query(max_length=120)] = None,
    start: Annotated[Optional[datetime], Query()] = None,
    end: Annotated[Optional[datetime], Query()] = None,
) -> Page[AuditLogOut]:
    stmt = _filtered(
        tenant.organization_id,
        action=action,
        entity_type=entity_type,
        user_id=user_id,
        search=q,
        start=start,
        end=end,
    )
    total = int(db.execute(count_for(stmt)).scalar_one())
    rows = (
        db.execute(
            ordered(stmt, paging, SORTABLE, AuditLog.created_at)
            .offset(paging.offset)
            .limit(paging.limit)
        )
        .scalars()
        .all()
    )
    return build_page([AuditLogOut.model_validate(row) for row in rows], total, paging)


@router.get("/export", summary="Export the filtered audit trail as CSV")
def export_audit_logs(
    tenant: CanAdminister,
    db: SessionDep,
    action: Annotated[Optional[str], Query(max_length=60)] = None,
    entity_type: Annotated[Optional[str], Query(max_length=60)] = None,
    user_id: Annotated[Optional[int], Query()] = None,
    q: Annotated[Optional[str], Query(max_length=120)] = None,
    start: Annotated[Optional[datetime], Query()] = None,
    end: Annotated[Optional[datetime], Query()] = None,
) -> Response:
    """The same filtered view as the list endpoint, as a downloadable CSV."""
    stmt = _filtered(
        tenant.organization_id,
        action=action,
        entity_type=entity_type,
        user_id=user_id,
        search=q,
        start=start,
        end=end,
    ).order_by(AuditLog.created_at.desc())

    rows = db.execute(stmt).scalars().all()
    return csv_response(
        filename="audit-logs.csv",
        headers=[
            "timestamp_utc",
            "action",
            "user_email",
            "entity_type",
            "entity_id",
            "ip_address",
            "detail",
        ],
        rows=[
            [
                row.created_at.isoformat() if row.created_at else "",
                row.action,
                row.user_email or "",
                row.entity_type or "",
                row.entity_id or "",
                row.ip_address or "",
                row.detail if row.detail else "",
            ]
            for row in rows
        ],
    )
