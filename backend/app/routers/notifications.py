"""Notification inbox API.

A user only ever sees rows addressed to them; the organization is taken from the
authenticated session and re-checked on every query, so one member cannot read
another's inbox by guessing an identifier.
"""

from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import Paging, SessionDep, Tenant
from ..models import Notification
from ..schemas import Message, NotificationOut, Page
from ..services.common import build_page, count_for
from ..services.notifications import LEVELS

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _own_inbox(db: Session, organization_id: int, user_id: int):
    """Only rows addressed to this user inside this organization."""
    return select(Notification).where(
        Notification.organization_id == organization_id,
        Notification.user_id == user_id,
    )


@router.get("/summary", summary="Unread notification count")
def notification_summary(tenant: Tenant, db: SessionDep) -> dict[str, int]:
    stmt = _own_inbox(db, tenant.organization_id, tenant.user.id).where(
        Notification.is_read.is_(False)
    )
    unread = int(db.execute(count_for(stmt)).scalar_one())
    return {"unread": unread}


@router.get("", response_model=Page[NotificationOut], summary="List my notifications")
def list_notifications(
    tenant: Tenant,
    db: SessionDep,
    paging: Paging,
    unread_only: Annotated[bool, Query()] = False,
    level: Annotated[Optional[str], Query(max_length=20)] = None,
) -> Page[NotificationOut]:
    stmt = _own_inbox(db, tenant.organization_id, tenant.user.id)
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    if level:
        stmt = stmt.where(Notification.level == level)

    total = int(db.execute(count_for(stmt)).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(Notification.created_at.desc())
            .offset(paging.offset)
            .limit(paging.limit)
        )
        .scalars()
        .all()
    )
    return build_page([NotificationOut.model_validate(row) for row in rows], total, paging)


def _get_own(db: Session, organization_id: int, user_id: int, notification_id: int) -> Notification:
    notification = db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.organization_id == organization_id,
            Notification.user_id == user_id,
        )
    ).scalar_one_or_none()
    if notification is None:
        # Not "forbidden": a 404 avoids confirming that somebody else's
        # notification exists.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")
    return notification


@router.post("/{notification_id}/read", response_model=NotificationOut, summary="Mark one read")
def mark_read(notification_id: int, tenant: Tenant, db: SessionDep) -> NotificationOut:
    notification = _get_own(db, tenant.organization_id, tenant.user.id, notification_id)
    if not notification.is_read:
        notification.is_read = True
        db.commit()
        db.refresh(notification)
    return NotificationOut.model_validate(notification)


@router.post("/read-all", response_model=Message, summary="Mark every notification read")
def mark_all_read(tenant: Tenant, db: SessionDep) -> Message:
    stmt = _own_inbox(db, tenant.organization_id, tenant.user.id).where(
        Notification.is_read.is_(False)
    )
    notifications = db.execute(stmt).scalars().all()
    for notification in notifications:
        notification.is_read = True
    db.commit()
    return Message(message=f"{len(notifications)} notification(s) marked as read.")


@router.get("/meta", summary="Notification filter vocabulary")
def notification_meta(tenant: Tenant) -> dict[str, list[str]]:
    return {"levels": list(LEVELS)}
