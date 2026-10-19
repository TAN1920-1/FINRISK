"""Small helpers shared by the routers (references, pagination, filtering)."""

from __future__ import annotations

import re
from typing import Any, Optional, Sequence

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from ..deps import Pagination
from ..schemas import Page

_SLUG_CLEAN = re.compile(r"[^a-z0-9]+")


def slugify(value: str) -> str:
    """Lower-case, hyphen-separated identifier safe for URLs and unique keys."""
    slug = _SLUG_CLEAN.sub("-", (value or "").strip().lower()).strip("-")
    return slug or "organization"


def unique_slug(db: Session, model, base_value: str, *, column: str = "slug") -> str:
    """Return a slug that is unique for ``model`` (appends ``-2``, ``-3``, ...)."""
    target = getattr(model, column)
    candidate = slugify(base_value)
    suffix = 1
    while db.execute(select(model.id).where(target == candidate)).first() is not None:
        suffix += 1
        candidate = f"{slugify(base_value)}-{suffix}"
    return candidate


def next_reference(db: Session, model, organization_id: int, prefix: str, *, column: str) -> str:
    """Generate the next sequential human-readable reference (e.g. ``RSK-0042``).

    ``column`` names the reference column on ``model`` (``risk_ref``, ``asset_ref``,
    ``action_ref``, ...) and is intentionally required: a default here would silently
    address the wrong column whenever the helper is reused for a different model.
    """
    target = getattr(model, column)
    existing = db.execute(
        select(target).where(model.organization_id == organization_id, target.like(f"{prefix}-%"))
    ).scalars().all()

    highest = 0
    for value in existing:
        try:
            highest = max(highest, int(str(value).split("-")[-1]))
        except (TypeError, ValueError):
            continue
    return f"{prefix}-{highest + 1:04d}"


def build_page(items: list[Any], total: int, paging: Pagination) -> Page:
    pages = (total + paging.page_size - 1) // paging.page_size if paging.page_size else 0
    return Page(items=items, total=total, page=paging.page, page_size=paging.page_size, pages=pages)


def count_for(stmt: Select) -> Select:
    """Wrap a SELECT in a COUNT(*) preserving its filters."""
    return select(func.count()).select_from(stmt.subquery())


def ordered(stmt: Select, paging: Pagination, column_map: dict[str, Any], default: Any) -> Select:
    """Apply the caller's requested sort column and direction safely."""
    column = column_map.get(paging.sort or "", default)
    return stmt.order_by(column.asc() if paging.order == "asc" else column.desc())


def in_filter(stmt: Select, column, values: Optional[Sequence[Any]]) -> Select:
    if values:
        return stmt.where(column.in_(list(values)))
    return stmt
