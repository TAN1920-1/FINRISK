"""Cybersecurity intelligence API: CVE enrichment, findings and scanner imports.

The priority shown here is a **context-aware** score built from documented
weights (see :mod:`app.scoring.risk_scoring`).  It is explicitly *not* a CVSS
score and must never be presented as one.
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timezone
from typing import Annotated, Any, Optional

from fastapi import APIRouter, File, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import domain
from ..audit import record_audit
from ..config import settings
from ..deps import CanManage, CanWrite, Paging, SessionDep, Tenant, client_ip
from ..models import Asset, ImportBatch, Vulnerability, VulnerabilityFinding, as_utc, utcnow
from ..schemas import (
    CveLookupOut,
    FindingCreate,
    FindingOut,
    FindingUpdate,
    ImportErrorRow,
    ImportResultOut,
    Message,
    Page,
)
from ..scoring.risk_scoring import FINDING_WEIGHTS
from ..serializers import finding_out
from ..services.common import build_page, count_for, ordered
from ..services.exports import csv_response
from ..services.findings import recompute_priority
from ..services.intelligence import apply_intel_to_finding, lookup_cve, normalise_cve_id

router = APIRouter(prefix="/api/vulnerabilities", tags=["cybersecurity"])

SORTABLE = {
    "title": VulnerabilityFinding.title,
    "cve_id": VulnerabilityFinding.cve_id,
    "cvss_score": VulnerabilityFinding.cvss_score,
    "priority_score": VulnerabilityFinding.priority_score,
    "priority_band": VulnerabilityFinding.priority_band,
    "remediation_status": VulnerabilityFinding.remediation_status,
    "remediation_due_date": VulnerabilityFinding.remediation_due_date,
    "detected_at": VulnerabilityFinding.detected_at,
    "created_at": VulnerabilityFinding.created_at,
    "updated_at": VulnerabilityFinding.updated_at,
}

CSV_HEADERS = [
    "id",
    "cve_id",
    "title",
    "asset_ref",
    "asset_name",
    "cvss_score",
    "cvss_severity",
    "priority_score",
    "priority_band",
    "exploit_evidence",
    "internet_exposed",
    "remediation_status",
    "remediation_due_date",
    "detected_at",
]

#: Column names accepted by the scanner-import endpoint (documented in the UI).
IMPORT_COLUMNS = [
    "title",
    "cve_id",
    "asset_ref",
    "asset_id",
    "cvss_score",
    "cvss_severity",
    "description",
    "detected_at",
    "vulnerability_age_days",
    "exploit_evidence",
    "internet_exposed",
    "remediation_status",
    "remediation_due_date",
    "compensating_controls",
]

MAX_IMPORT_ROWS = 5000


def _truthy(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "t"}


def _optional_float(value: Any) -> Optional[float]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _optional_date(value: Any) -> Optional[date]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _optional_datetime(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    for pattern in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:19], pattern).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _get_finding(db: Session, organization_id: int, finding_id: int) -> VulnerabilityFinding:
    finding = db.execute(
        select(VulnerabilityFinding).where(
            VulnerabilityFinding.id == finding_id,
            VulnerabilityFinding.organization_id == organization_id,
        )
    ).scalar_one_or_none()
    if finding is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found.")
    return finding


def _asset_or_400(db: Session, organization_id: int, asset_id: Optional[int]) -> Optional[Asset]:
    if asset_id is None:
        return None
    asset = db.execute(
        select(Asset).where(Asset.id == asset_id, Asset.organization_id == organization_id)
    ).scalar_one_or_none()
    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Asset not found in this organization."
        )
    return asset


def _context(db: Session, findings: list[VulnerabilityFinding]) -> list[FindingOut]:
    if not findings:
        return []
    asset_ids = {item.asset_id for item in findings if item.asset_id}
    assets = (
        {asset.id: asset for asset in db.execute(select(Asset).where(Asset.id.in_(asset_ids))).scalars()}
        if asset_ids
        else {}
    )
    return [finding_out(item, asset=assets.get(item.asset_id)) for item in findings]


@router.get("/meta", summary="Scoring methodology and vocabularies")
def vulnerability_meta(tenant: Tenant) -> dict:
    return {
        "remediation_statuses": [item.value for item in domain.RemediationStatus],
        "priority_bands": ["critical", "high", "medium", "low"],
        "weights": FINDING_WEIGHTS,
        "compensating_control_penalty": 10.0,
        "methodology": (
            "Priority = weighted sum of CVSS technical severity (35), exploitation evidence (25, "
            "CISA KEV outranks a local exploit flag outranks EPSS), internet exposure (15), asset "
            "criticality (10), data sensitivity (5) and finding age (5), minus 10 when compensating "
            "controls are documented. Bands: >=75 critical, >=55 high, >=35 medium, else low."
        ),
        "disclaimer": (
            "This is a context-aware prioritisation score. It is NOT a CVSS score and must not be "
            "reported as one; CVSS is only one of its inputs."
        ),
        "nvd_configured": bool(settings.nvd_api_key),
        "import_columns": IMPORT_COLUMNS,
    }


@router.get("/cve/{cve_id}", response_model=CveLookupOut, summary="Look up a CVE (cached)")
def get_cve(
    cve_id: str,
    tenant: Tenant,
    db: SessionDep,
    refresh: Annotated[bool, Query()] = False,
) -> CveLookupOut:
    record = lookup_cve(db, cve_id, refresh=refresh)
    db.commit()
    return record


@router.get("/findings", response_model=Page[FindingOut], summary="List vulnerability findings")
def list_findings(
    tenant: Tenant,
    db: SessionDep,
    paging: Paging,
    q: Annotated[Optional[str], Query(max_length=120)] = None,
    asset_id: Annotated[Optional[int], Query()] = None,
    priority_band: Annotated[Optional[domain.Severity], Query()] = None,
    remediation_status: Annotated[Optional[domain.RemediationStatus], Query()] = None,
    kev_only: Annotated[bool, Query()] = False,
    internet_exposed_only: Annotated[bool, Query()] = False,
    min_score: Annotated[Optional[float], Query(ge=0, le=100)] = None,
    max_score: Annotated[Optional[float], Query(ge=0, le=100)] = None,
) -> Page[FindingOut]:
    stmt = select(VulnerabilityFinding).where(
        VulnerabilityFinding.organization_id == tenant.organization_id
    )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                VulnerabilityFinding.title.ilike(like),
                VulnerabilityFinding.cve_id.ilike(like),
                VulnerabilityFinding.description.ilike(like),
            )
        )
    if asset_id is not None:
        stmt = stmt.where(VulnerabilityFinding.asset_id == asset_id)
    if priority_band:
        stmt = stmt.where(VulnerabilityFinding.priority_band == priority_band.value)
    if remediation_status:
        stmt = stmt.where(VulnerabilityFinding.remediation_status == remediation_status.value)
    if internet_exposed_only:
        stmt = stmt.where(VulnerabilityFinding.internet_exposed.is_(True))
    if min_score is not None:
        stmt = stmt.where(VulnerabilityFinding.priority_score >= min_score)
    if max_score is not None:
        stmt = stmt.where(VulnerabilityFinding.priority_score <= max_score)
    if kev_only:
        stmt = stmt.where(
            VulnerabilityFinding.vulnerability_id.in_(select(Vulnerability.id).where(Vulnerability.kev_listed.is_(True)))
        )

    total = int(db.execute(count_for(stmt)).scalar_one())
    rows = (
        db.execute(
            ordered(stmt, paging, SORTABLE, VulnerabilityFinding.priority_score)
            .offset(paging.offset)
            .limit(paging.limit)
        )
        .scalars()
        .all()
    )
    return build_page(_context(db, list(rows)), total, paging)


@router.get("/findings/export", summary="Export findings (CSV)")
def export_findings(
    request: Request,
    tenant: Tenant,
    db: SessionDep,
    priority_band: Annotated[Optional[domain.Severity], Query()] = None,
    remediation_status: Annotated[Optional[domain.RemediationStatus], Query()] = None,
) -> Response:
    stmt = select(VulnerabilityFinding).where(
        VulnerabilityFinding.organization_id == tenant.organization_id
    )
    if priority_band:
        stmt = stmt.where(VulnerabilityFinding.priority_band == priority_band.value)
    if remediation_status:
        stmt = stmt.where(VulnerabilityFinding.remediation_status == remediation_status.value)
    rows = db.execute(stmt.order_by(VulnerabilityFinding.priority_score.desc())).scalars().all()
    asset_ids = {item.asset_id for item in rows if item.asset_id}
    assets = (
        {asset.id: asset for asset in db.execute(select(Asset).where(Asset.id.in_(asset_ids))).scalars()}
        if asset_ids
        else {}
    )

    record_audit(
        db,
        action=domain.AuditAction.DATA_EXPORTED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="vulnerability_finding",
        detail={"rows": len(rows)},
        ip_address=client_ip(request),
    )
    db.commit()

    def _iter():
        for item in rows:
            asset = assets.get(item.asset_id)
            yield [
                item.id,
                item.cve_id,
                item.title,
                asset.asset_ref if asset else "",
                asset.name if asset else "",
                item.cvss_score,
                item.cvss_severity,
                item.priority_score,
                item.priority_band,
                item.exploit_evidence,
                item.internet_exposed,
                item.remediation_status,
                item.remediation_due_date,
                item.detected_at,
            ]

    return csv_response(filename="finrisk-vulnerability-findings.csv", headers=CSV_HEADERS, rows=_iter())


@router.post(
    "/findings",
    response_model=FindingOut,
    status_code=status.HTTP_201_CREATED,
    summary="Record a vulnerability finding",
)
def create_finding(
    payload: FindingCreate, request: Request, tenant: CanWrite, db: SessionDep
) -> FindingOut:
    asset = _asset_or_400(db, tenant.organization_id, payload.asset_id)
    finding = VulnerabilityFinding(
        organization_id=tenant.organization_id,
        created_by_id=tenant.user.id,
        **payload.model_dump(),
    )
    if finding.detected_at is None:
        finding.detected_at = utcnow()
    if finding.vulnerability_age_days is None and finding.detected_at:
        detected_at = as_utc(finding.detected_at)
        finding.vulnerability_age_days = max(0, (utcnow() - detected_at).days)

    db.add(finding)
    db.flush()
    apply_intel_to_finding(db, finding)
    recompute_priority(db, finding, asset)

    record_audit(
        db,
        action=domain.AuditAction.FINDING_CREATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="vulnerability_finding",
        entity_id=finding.id,
        detail={"cve_id": finding.cve_id, "priority_band": finding.priority_band},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(finding)
    return finding_out(finding, asset=asset)


@router.get("/findings/{finding_id}", response_model=FindingOut, summary="Fetch one finding")
def get_finding(finding_id: int, tenant: Tenant, db: SessionDep) -> FindingOut:
    finding = _get_finding(db, tenant.organization_id, finding_id)
    return _context(db, [finding])[0]


@router.patch("/findings/{finding_id}", response_model=FindingOut, summary="Update a finding")
def update_finding(
    finding_id: int,
    payload: FindingUpdate,
    request: Request,
    tenant: CanWrite,
    db: SessionDep,
) -> FindingOut:
    finding = _get_finding(db, tenant.organization_id, finding_id)
    data = payload.model_dump(exclude_unset=True)
    if "asset_id" in data:
        _asset_or_400(db, tenant.organization_id, data["asset_id"])
    for field, value in data.items():
        setattr(finding, field, value)

    asset = db.get(Asset, finding.asset_id) if finding.asset_id else None
    recompute_priority(db, finding, asset)
    record_audit(
        db,
        action=domain.AuditAction.FINDING_UPDATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="vulnerability_finding",
        entity_id=finding.id,
        detail={"fields": sorted(data.keys())},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(finding)
    return finding_out(finding, asset=asset)


@router.post(
    "/findings/{finding_id}/enrich",
    response_model=FindingOut,
    summary="Refresh upstream intelligence for a finding",
)
def enrich_finding(
    finding_id: int,
    request: Request,
    tenant: CanWrite,
    db: SessionDep,
    refresh: Annotated[bool, Query()] = True,
) -> FindingOut:
    finding = _get_finding(db, tenant.organization_id, finding_id)
    if not finding.cve_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This finding has no CVE identifier to enrich from.",
        )
    lookup = lookup_cve(db, finding.cve_id, refresh=refresh)
    apply_intel_to_finding(db, finding)
    asset = db.get(Asset, finding.asset_id) if finding.asset_id else None
    recompute_priority(db, finding, asset)

    record_audit(
        db,
        action=domain.AuditAction.FINDING_UPDATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="vulnerability_finding",
        entity_id=finding.id,
        detail={"operation": "enrich", "warnings": lookup.warnings},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(finding)
    return finding_out(finding, asset=asset)


@router.delete("/findings/{finding_id}", response_model=Message, summary="Delete a finding")
def delete_finding(
    finding_id: int, request: Request, tenant: CanManage, db: SessionDep
) -> Message:
    finding = _get_finding(db, tenant.organization_id, finding_id)
    title = finding.title
    db.delete(finding)
    record_audit(
        db,
        action=domain.AuditAction.FINDING_DELETED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="vulnerability_finding",
        entity_id=finding_id,
        detail={"title": title},
        ip_address=client_ip(request),
    )
    db.commit()
    return Message(message="Finding deleted.")


@router.post(
    "/findings/import",
    response_model=ImportResultOut,
    summary="Import findings from a scanner CSV export",
)
async def import_findings(
    request: Request,
    tenant: CanWrite,
    db: SessionDep,
    file: UploadFile = File(...),
) -> ImportResultOut:
    """Import findings from CSV.

    The file is validated before anything is written: extension, size and a
    required ``title`` column.  Rows that cannot be parsed are reported back
    individually and recorded on the import batch instead of aborting the run.
    """
    filename = (file.filename or "upload.csv").strip()
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
        except UnicodeDecodeError as exc:  # pragma: no cover - defensive
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="The file is not readable text."
            ) from exc

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The CSV file is empty.")
    headers = {(name or "").strip().lower() for name in reader.fieldnames}
    if "title" not in headers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The CSV must contain at least a 'title' column.",
        )

    rows = list(reader)
    if len(rows) > MAX_IMPORT_ROWS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Import at most {MAX_IMPORT_ROWS} rows per file.",
        )

    assets_by_ref = {
        asset.asset_ref.lower(): asset
        for asset in db.execute(select(Asset).where(Asset.organization_id == tenant.organization_id)).scalars()
    }
    assets_by_id = {asset.id: asset for asset in assets_by_ref.values()}

    batch = ImportBatch(
        organization_id=tenant.organization_id,
        uploaded_by_id=tenant.user.id,
        filename=filename,
        rows_total=len(rows),
    )
    db.add(batch)
    db.flush()

    errors: list[ImportErrorRow] = []
    created = 0
    for index, row in enumerate(rows, start=2):  # row 1 is the header
        normalised = {str(key or "").strip().lower(): value for key, value in row.items()}
        title = str(normalised.get("title") or "").strip()
        if not title:
            errors.append(ImportErrorRow(row=index, error="Missing required 'title' value."))
            continue

        asset = None
        asset_ref = str(normalised.get("asset_ref") or "").strip().lower()
        if asset_ref:
            asset = assets_by_ref.get(asset_ref)
            if asset is None:
                errors.append(
                    ImportErrorRow(row=index, error=f"Unknown asset_ref '{asset_ref}'.")
                )
                continue
        elif str(normalised.get("asset_id") or "").strip():
            try:
                asset = assets_by_id.get(int(str(normalised["asset_id"]).strip()))
            except ValueError:
                asset = None
            if asset is None:
                errors.append(ImportErrorRow(row=index, error="asset_id does not reference a known asset."))
                continue

        remediation_status = str(normalised.get("remediation_status") or "").strip().lower()
        try:
            if remediation_status:
                domain.RemediationStatus(remediation_status)
        except ValueError:
            errors.append(
                ImportErrorRow(
                    row=index,
                    error=f"Unknown remediation_status '{remediation_status}'.",
                ),
            )
            continue

        finding = VulnerabilityFinding(
            organization_id=tenant.organization_id,
            created_by_id=tenant.user.id,
            title=title[:300],
            cve_id=normalise_cve_id(str(normalised.get("cve_id") or "")) or None,
            asset_id=asset.id if asset else None,
            description=str(normalised.get("description") or "").strip() or None,
            cvss_score=_optional_float(normalised.get("cvss_score")),
            cvss_severity=str(normalised.get("cvss_severity") or "").strip() or None,
            detected_at=_optional_datetime(normalised.get("detected_at")) or utcnow(),
            vulnerability_age_days=int(_optional_float(normalised.get("vulnerability_age_days")) or 0) or None,
            exploit_evidence=_truthy(normalised.get("exploit_evidence")),
            internet_exposed=_truthy(normalised.get("internet_exposed")),
            remediation_status=remediation_status or domain.RemediationStatus.OPEN.value,
            remediation_due_date=_optional_date(normalised.get("remediation_due_date")),
            compensating_controls=str(normalised.get("compensating_controls") or "").strip() or None,
        )
        if finding.cvss_score is not None and not (0 <= finding.cvss_score <= 10):
            errors.append(ImportErrorRow(row=index, error="cvss_score must be between 0 and 10."))
            continue
        if finding.vulnerability_age_days is None and finding.detected_at:
            detected_at = as_utc(finding.detected_at)
            finding.vulnerability_age_days = max(0, (utcnow() - detected_at).days)

        db.add(finding)
        db.flush()
        apply_intel_to_finding(db, finding)
        recompute_priority(db, finding, asset)
        created += 1

    batch.rows_created = created
    batch.rows_failed = len(errors)
    batch.errors = [item.model_dump() for item in errors]

    record_audit(
        db,
        action=domain.AuditAction.FINDING_IMPORTED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="import_batch",
        entity_id=batch.id,
        detail={"filename": filename, "created": created, "failed": len(errors)},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(batch)

    return ImportResultOut(
        batch_id=batch.id,
        filename=filename,
        rows_total=batch.rows_total,
        rows_created=created,
        rows_failed=len(errors),
        errors=errors,
    )


@router.get("/imports", summary="Recent import batches")
def list_imports(tenant: Tenant, db: SessionDep, limit: Annotated[int, Query(ge=1, le=100)] = 20) -> dict:
    rows = (
        db.execute(
            select(ImportBatch)
            .where(ImportBatch.organization_id == tenant.organization_id)
            .order_by(ImportBatch.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return {
        "items": [
            {
                "id": row.id,
                "filename": row.filename,
                "rows_total": row.rows_total,
                "rows_created": row.rows_created,
                "rows_failed": row.rows_failed,
                "errors": row.errors or [],
                "created_at": row.created_at,
            }
            for row in rows
        ]
    }
