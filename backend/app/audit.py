"""Audit-trail helper.

Sensitive actions are written through :func:`record_audit`.  Rows are added to
the caller's session and committed together with the business change, so an
audit entry can never be persisted for a transaction that rolled back.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from .models import AuditLog, User


def record_audit(
    db: Session,
    *,
    action: str,
    user: Optional[User] = None,
    organization_id: Optional[int] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[Any] = None,
    detail: Optional[dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> AuditLog:
    """Stage an audit row on ``db`` (the caller owns the commit)."""
    entry = AuditLog(
        action=action,
        user_id=user.id if user else None,
        user_email=user.email if user else None,
        organization_id=organization_id,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        detail=detail,
        ip_address=ip_address,
    )
    db.add(entry)
    return entry
