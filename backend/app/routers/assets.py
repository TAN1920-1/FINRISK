"""Asset registry endpoints."""

from __future__ import annotations

import csv
import io
from decimal import Decimal, InvalidOperation
from typing import Annotated, Optional

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import func, or_, select

from .. import domain
from ..audit import record_audit
from ..config import settings
from ..deps import CanManage, CanWrite, Paging, SessionDep, Tenant
from ..models import Asset, Risk, User, VulnerabilityFinding, utcnow
from ..schemas import (
    AssetCreate,
    AssetOut,
    AssetUpdate,
    ImportErrorRow,
    ImportResultOut,
    Message,
    Page,
    RiskOut,
)
from ..serializers import asset_out, risk_out
from ..services.common import build_page, next_reference, ordered

router = APIRouter(prefix="/api/assets", tags=["assets"])

SORTABLE = {
    "name": Asset.name,
    "asset_ref": Asset.asset_ref,
    "criticality": Asset.criticality,
    "data_sensitivity": Asset.data_sensitivity,
    "created_at": Asset.created_at,
    "updated_at": Asset.updated_at,
    "last_assessed_at": Asset.last_assessed_at,
}


def _money(raw: object) -> Optional[Decimal]:
    """Parse a money cell into 2-decimal currency.

    A blank cell means "not valued" and stays ``None`` rather than becoming a
    zero; anything else that is not a non-negative number raises.
    """
    text = str(raw or "").strip().replace(",", "")
    if not text:
        return None
    amount = Decimal(text)
    if amount < 0:
        raise ValueError(text)
    return amount.quantize(Decimal("0.01"))


def _rollups(db, organization_id: int, asset_ids: list[int]) -> tuple[dict[int, int], dict[int, int], dict[int, str]]:
    """Return open-risk counts, open-finding counts and worst severity per asset."""
    if not asset_ids:
        return {}, {}, {}

    risk_rows = db.execute(
        select(Risk.asset_id, func.count(Risk.id), func.max(Risk.likelihood * Risk.impact))
        .where(
            Risk.organization_id == organization_id,
            Risk.asset_id.in_(asset_ids),
            Risk.status.in_(domain.OPEN_RISK_STATUSES),
        )
        .group_by(Risk.asset_id)
    ).all()
    open_risks = {row[0]: int(row[1]) for row in risk_rows}
    severity = {
        row[0]: domain.severity_from_score(row[2]) for row in risk_rows if row[2] is not None
    }

    finding_rows = db.execute(
        select(VulnerabilityFinding.asset_id, func.count(VulnerabilityFinding.id))
        .where(
            VulnerabilityFinding.organization_id == organization_id,
            VulnerabilityFinding.asset_id.in_(asset_ids),
            VulnerabilityFinding.remediation_status.in_(
                [domain.RemediationStatus.OPEN.value, domain.RemediationStatus.IN_PROGRESS.value]
            ),
        )
        .group_by(VulnerabilityFinding.asset_id)
    ).all()
    open_findings = {row[0]: int(row[1]) for row in finding_rows}

    return open_risks, open_findings, severity


def _owner_names(db, owner_ids: list[int]) -> dict[int, str]:
    if not owner_ids:
        return {}
    rows = db.execute(select(User.id, User.full_name).where(User.id.in_(owner_ids))).all()
    return {row[0]: row[1] for row in rows}


@router.get("", response_model=Page[AssetOut])
def list_assets(
    tenant: Tenant,
    db: SessionDep,
    paging: Paging,
    q: Annotated[Optional[str], Query(max_length=120)] = None,
    asset_type: Annotated[Optional[domain.AssetType], Query()] = None,
    environment: Annotated[Optional[domain.Environment], Query()] = None,
    business_unit: Annotated[Optional[str], Query(max_length=120)] = None,
    criticality: Annotated[Optional[list[int]], Query()] = None,
    internet_exposed: Annotated[Optional[bool], Query()] = None,
    active_only: Annotated[bool, Query()] = True,
) -> Page[AssetOut]:
    """Paginated asset inventory with filtering and rollup counts."""
    stmt = select(Asset).where(Asset.organization_id == tenant.organization_id)

    if active_only:
        stmt = stmt.where(Asset.is_active.is_(True))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(func.lower(Asset.name).like(like), func.lower(Asset.asset_ref).like(like))
        )
    if asset_type:
        stmt = stmt.where(Asset.asset_type == asset_type.value)
    if environment:
        stmt = stmt.where(Asset.environment == environment.value)
    if business_unit:
        stmt = stmt.where(Asset.business_unit == business_unit)
    if criticality:
        stmt = stmt.where(Asset.criticality.in_(criticality))
    if internet_exposed is not None:
        stmt = stmt.where(Asset.internet_exposed.is_(internet_exposed))

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    stmt = ordered(stmt, paging, SORTABLE, Asset.updated_at).offset(paging.offset).limit(paging.limit)
    assets = db.execute(stmt).scalars().all()

    open_risks, open_findings, severity = _rollups(db, tenant.organization_id, [a.id for a in assets])
    owners = _owner_names(db, [a.owner_id for a in assets if a.owner_id])

    items = [
        asset_out(
            asset,
            owner_name=owners.get(asset.owner_id),
            open_risks=open_risks.get(asset.id, 0),
            open_findings=open_findings.get(asset.id, 0),
            severity=severity.get(asset.id),
        )
        for asset in assets
    ]
    return build_page(items, int(total), paging)


@router.get("/options", response_model=list[dict])
def asset_options(tenant: Tenant, db: SessionDep) -> list[dict]:
    """Lightweight list for select inputs."""
    rows = db.execute(
        select(Asset.id, Asset.name, Asset.asset_ref)
        .where(Asset.organization_id == tenant.organization_id, Asset.is_active.is_(True))
        .order_by(Asset.name)
    ).all()
    return [{"id": row[0], "name": row[1], "asset_ref": row[2]} for row in rows]


@router.get("/{asset_id}", response_model=AssetOut)
def read_asset(asset_id: int, tenant: Tenant, db: SessionDep) -> AssetOut:
    asset = db.get(Asset, asset_id)
    if asset is None or asset.organization_id != tenant.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found.")

    open_risks, open_findings, severity = _rollups(db, tenant.organization_id, [asset.id])
    owners = _owner_names(db, [asset.owner_id] if asset.owner_id else [])
    return asset_out(
        asset,
        owner_name=owners.get(asset.owner_id),
        open_risks=open_risks.get(asset.id, 0),
        open_findings=open_findings.get(asset.id, 0),
        severity=severity.get(asset.id),
    )


@router.get("/{asset_id}/risks", response_model=list[RiskOut])
def list_asset_risks(asset_id: int, tenant: Tenant, db: SessionDep) -> list[RiskOut]:
    """Risks linked to a single asset (used by the asset detail page)."""
    asset = db.get(Asset, asset_id)
    if asset is None or asset.organization_id != tenant.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found.")

    risks = db.execute(
        select(Risk)
        .where(Risk.organization_id == tenant.organization_id, Risk.asset_id == asset_id)
        .order_by((Risk.likelihood * Risk.impact).desc())
    ).scalars().all()

    owners = _owner_names(db, [r.owner_id for r in risks if r.owner_id])
    return [
        risk_out(risk, asset_name=asset.name, owner_name=owners.get(risk.owner_id))
        for risk in risks
    ]


@router.post("", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
def create_asset(payload: AssetCreate, request: Request, db: SessionDep, tenant: CanWrite) -> AssetOut:
    """Register a new asset."""
    if payload.owner_id is not None:
        owner = db.get(User, payload.owner_id)
        if owner is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Owner not found.")

    asset = Asset(
        organization_id=tenant.organization_id,
        asset_ref=(
            payload.asset_ref or next_reference(db, Asset, tenant.organization_id, "AST", column="asset_ref")
        ).strip(),
        **payload.model_dump(exclude={"asset_ref"}),
    )
    db.add(asset)
    db.flush()
    record_audit(
        db,
        action=domain.AuditAction.ASSET_CREATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="asset",
        entity_id=asset.id,
        detail={"name": asset.name, "ref": asset.asset_ref},
    )
    db.commit()
    db.refresh(asset)
    return asset_out(asset)


@router.patch("/{asset_id}", response_model=AssetOut)
def update_asset(asset_id: int, payload: AssetUpdate, db: SessionDep, tenant: CanWrite) -> AssetOut:
    asset = db.get(Asset, asset_id)
    if asset is None or asset.organization_id != tenant.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found.")

    changes = payload.model_dump(exclude_unset=True)
    if changes.get("owner_id") is not None:
        if db.get(User, changes["owner_id"]) is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Owner not found.")

    for field, value in changes.items():
        setattr(asset, field, value)

    record_audit(
        db,
        action=domain.AuditAction.ASSET_UPDATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="asset",
        entity_id=asset.id,
        detail={"fields": sorted(changes.keys())},
    )
    db.commit()
    db.refresh(asset)
    return asset_out(asset)


@router.delete("/{asset_id}", response_model=Message)
def retire_asset(asset_id: int, db: SessionDep, tenant: CanManage) -> Message:
    """Retire an asset.

    Assets are never hard-deleted: linked risks, findings and reports must keep
    their referential integrity.  The asset is marked inactive instead.
    """
    asset = db.get(Asset, asset_id)
    if asset is None or asset.organization_id != tenant.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found.")

    asset.is_active = False
    record_audit(
        db,
        action=domain.AuditAction.ASSET_DELETED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="asset",
        entity_id=asset.id,
        detail={"retired": True, "name": asset.name},
    )
    db.commit()
    return Message(message=f"{asset.name} has been retired and is hidden from active lists.")


@router.post(
    "/import",
    response_model=ImportResultOut,
    summary="Import assets from CSV",
)
async def import_assets(
    request: Request,
    tenant: CanWrite,
    db: SessionDep,
    file: UploadFile = File(...),
) -> ImportResultOut:
    """Import assets from CSV.

    Required columns: ``name``, ``asset_type``.
    Optional: ``asset_ref``, ``description``, ``environment``, ``business_unit``,
    ``criticality`` (1-5), ``data_sensitivity`` (1-5), ``internet_exposed`` (yes/no),
    ``financial_importance`` (amount, blank means not valued), ``currency`` (ISO-4217).

    Rows are validated before anything is written: a reference that already exists
    is reported as an error row rather than colliding with the unique constraint.
    """
    filename = (file.filename or "assets.csv").strip()
    if not filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Only .csv files can be imported."
        )

    raw = await file.read()
    if len(raw) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"The file exceeds the {settings.max_upload_mb} MB import limit.",
        )

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = raw.decode("latin-1")
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="The file is not readable text."
            ) from exc

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The CSV file is empty.")
    
    headers = {(name or "").strip().lower() for name in reader.fieldnames}
    if "name" not in headers or "asset_type" not in headers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The CSV must contain at least 'name' and 'asset_type' columns.",
        )

    from ..models import ImportBatch
    batch = ImportBatch(
        organization_id=tenant.organization_id,
        uploaded_by_id=tenant.user.id,
        filename=filename,
        rows_total=0,
    )
    db.add(batch)
    db.flush()

    errors: list[ImportErrorRow] = []
    created = 0
    rows = list(reader)
    batch.rows_total = len(rows)

    taken_refs = {
        ref.lower()
        for ref in db.execute(
            select(Asset.asset_ref).where(Asset.organization_id == tenant.organization_id)
        )
        .scalars()
        .all()
    }

    for index, row in enumerate(rows, start=2):
        normalised = {str(key or "").strip().lower(): value for key, value in row.items()}
        name = str(normalised.get("name") or "").strip()
        asset_type = str(normalised.get("asset_type") or "").strip().lower()

        if not name:
            errors.append(ImportErrorRow(row=index, error="Missing required 'name' value."))
            continue
        if not asset_type:
            errors.append(ImportErrorRow(row=index, error="Missing required 'asset_type' value."))
            continue
        
        try:
            domain.AssetType(asset_type)
        except ValueError:
            errors.append(ImportErrorRow(row=index, error=f"Unknown asset_type '{asset_type}'."))
            continue

        env = str(normalised.get("environment") or "").strip().lower()
        if env:
            try:
                domain.Environment(env)
            except ValueError:
                errors.append(ImportErrorRow(row=index, error=f"Unknown environment '{env}'."))
                continue

        money_text = str(normalised.get("financial_importance") or "").strip()
        try:
            financial_importance = _money(money_text)
        except (InvalidOperation, ValueError):
            errors.append(
                ImportErrorRow(
                    row=index, error=f"Invalid financial_importance '{money_text}'."
                )
            )
            continue

        currency = (str(normalised.get("currency") or "").strip().upper() or "USD")
        if len(currency) != 3 or not currency.isalpha():
            errors.append(
                ImportErrorRow(
                    row=index, error=f"Invalid currency '{currency}'; use a three-letter ISO-4217 code."
                )
            )
            continue

        explicit_ref = str(normalised.get("asset_ref") or "").strip()
        if explicit_ref:
            if explicit_ref.lower() in taken_refs:
                errors.append(
                    ImportErrorRow(
                        row=index, error=f"Asset reference '{explicit_ref}' already exists."
                    )
                )
                continue
            asset_ref = explicit_ref
        else:
            asset_ref = next_reference(db, Asset, tenant.organization_id, "AST", column="asset_ref")
            while asset_ref.lower() in taken_refs:
                asset_ref = f"AST-{int(asset_ref.split('-')[-1]) + 1:04d}"
        taken_refs.add(asset_ref.lower())

        def _to_scale(val, default=3):
            try:
                v = int(float(str(val or "").strip()))
                return v if 1 <= v <= 5 else default
            except (ValueError, TypeError):
                return default

        def _truthy(val):
            return str(val or "").strip().lower() in {"1", "true", "yes", "y", "t"}

        asset = Asset(
            organization_id=tenant.organization_id,
            asset_ref=asset_ref,
            name=name[:200],
            description=str(normalised.get("description") or "").strip() or None,
            asset_type=asset_type,
            environment=env or domain.Environment.PRODUCTION.value,
            business_unit=str(normalised.get("business_unit") or "").strip() or None,
            criticality=_to_scale(normalised.get("criticality")),
            data_sensitivity=_to_scale(normalised.get("data_sensitivity")),
            internet_exposed=_truthy(normalised.get("internet_exposed")),
            financial_importance=financial_importance,
            currency=currency,
            last_assessed_at=utcnow(),
        )
        db.add(asset)
        created += 1

    batch.rows_created = created
    batch.rows_failed = len(errors)
    batch.errors = [item.model_dump() for item in errors]

    record_audit(
        db,
        action=domain.AuditAction.ASSET_CREATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="import_batch",
        entity_id=batch.id,
        detail={"filename": filename, "created": created, "failed": len(errors)},
    )
    db.commit()
    return ImportResultOut(
        batch_id=batch.id,
        filename=filename,
        rows_total=batch.rows_total,
        rows_created=created,
        rows_failed=len(errors),
        errors=errors,
    )
