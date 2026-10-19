"""Notification helper.

Notifications are a *per-user* inbox.  Rows are addressed to exactly one user so
that "read" is unambiguous: a shared, organization-wide row would need a
per-user read-state table to avoid one member marking it read for everybody, and
this build does not need that.

Like :mod:`app.audit`, rows are staged on the caller's session so a notification
is never persisted for a transaction that rolled back.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ..models import Notification

#: Recognised levels; the UI maps these to colour and icon.
LEVELS = ("info", "success", "warning", "critical")


def notify_user(
    db: Session,
    *,
    organization_id: int,
    user_id: int,
    title: str,
    body: Optional[str] = None,
    level: str = "info",
    link: Optional[str] = None,
) -> Notification:
    """Stage a notification for one user (the caller owns the commit)."""
    entry = Notification(
        organization_id=organization_id,
        user_id=user_id,
        title=title[:250],
        body=body,
        level=level if level in LEVELS else "info",
        link=link[:300] if link else None,
    )
    db.add(entry)
    return entry
