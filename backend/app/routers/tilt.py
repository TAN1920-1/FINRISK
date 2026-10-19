"""Preserved TILT third-party assessment endpoints.

Ports the legacy questionnaire / vendor / calculation / OSINT routes into the
new tenant-scoped package.  Every vendor row is filtered by
``tenant.organization_id``; questionnaire templates are global definitions
(the ORM model has no organization column) so they are shared by all tenants.
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select

from .. import domain
from ..audit import record_audit
from ..deps import CanManage, CanWrite, Paging, SessionDep, Tenant, client_ip
from ..models import QuestionnaireTemplate, VendorAssessment, utcnow
from ..schemas import (
    Message,
    OsintScanOut,
    Page,
    QuestionnaireTemplateOut,
    QuestionnaireTemplateUpsert,
    VendorAssessmentCreate,
    VendorAssessmentOut,
    VendorAssessmentUpdate,
)
from ..serializers import vendor_out
from ..services import legacy_calculator, osint
from ..services.common import build_page, ordered

router = APIRouter(prefix="/api/tilt", tags=["tilt"])

VENDOR_SORTABLE = {
    "vendor_name": VendorAssessment.vendor_name,
    "status": VendorAssessment.status,
    "assessment_type": VendorAssessment.assessment_type,
    "created_at": VendorAssessment.created_at,
    "updated_at": VendorAssessment.updated_at,
    "last_scanned_at": VendorAssessment.last_scanned_at,
}

_AUDIT_TEMPLATE_CREATED = "tilt.template_created"
_AUDIT_TEMPLATE_UPDATED = "tilt.template_updated"
_AUDIT_TEMPLATE_DELETED = "tilt.template_deleted"
_AUDIT_VENDOR_CREATED = "tilt.vendor_created"
_AUDIT_VENDOR_UPDATED = "tilt.vendor_updated"
_AUDIT_VENDOR_DELETED = "tilt.vendor_deleted"
_AUDIT_VENDOR_CALCULATED = "tilt.vendor_calculated"
_AUDIT_VENDOR_OSINT_SCANNED = "tilt.vendor_osint_scanned"
_AUDIT_VENDOR_ACKNOWLEDGED = "tilt.vendor_acknowledged"


def _load_vendor(db, tenant: Tenant, vendor_id: int) -> VendorAssessment:
    vendor = db.get(VendorAssessment, vendor_id)
    if vendor is None or vendor.organization_id != tenant.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor assessment not found.")
    return vendor


def _template_dict(row: QuestionnaireTemplate) -> dict[str, Any]:
    return {
        "id": row.id,
        "position": row.position,
        "text": row.text,
        "category": row.category,
        "weight": row.weight,
        "criticality": row.criticality,
        "points": row.points,
    }


def _answer_value(mapping: Optional[dict], item_id: Any) -> Optional[float]:
    """Look up a scored answer, tolerating int/str JSON key coercion."""
    if not mapping:
        return None
    for key in (item_id, str(item_id)):
        if key in mapping:
            value = mapping[key]
            break
    else:
        try:
            key = int(item_id)
        except (TypeError, ValueError):
            return None
        if key not in mapping:
            return None
        value = mapping[key]
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _weakness_strength(template: list[dict], mapping: Optional[dict]) -> tuple[Optional[str], Optional[str]]:
    """Derive the weakest / strongest answered items from the scores."""
    scored: list[tuple[float, str]] = []
    for item in template:
        value = _answer_value(mapping, item.get("id"))
        label = item.get("text")
        if value is None or not label:
            continue
        scored.append((value, label))
    if len(scored) < 2:
        return None, None
    scored.sort(key=lambda pair: pair[0])
    if scored[0][0] == scored[-1][0]:
        return None, None
    return scored[0][1], scored[-1][1]


# ---------------------------------------------------------------------------
# Questionnaire templates
# ---------------------------------------------------------------------------


@router.get("/templates/{kind}", response_model=list[QuestionnaireTemplateOut])
def list_templates(
    kind: domain.TemplateKind,
    tenant: Tenant,
    db: SessionDep,
) -> list[QuestionnaireTemplateOut]:
    """Return every template for a questionnaire kind, ordered by position."""
    rows = db.execute(
        select(QuestionnaireTemplate)
        .where(QuestionnaireTemplate.kind == kind.value)
        .order_by(QuestionnaireTemplate.position)
    ).scalars().all()
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No '{kind.value}' questionnaire templates are defined.",
        )
    return [QuestionnaireTemplateOut.model_validate(row) for row in rows]


@router.post("/templates/{kind}", response_model=QuestionnaireTemplateOut, status_code=status.HTTP_201_CREATED)
def create_template(
    kind: domain.TemplateKind,
    payload: QuestionnaireTemplateUpsert,
    request: Request,
    db: SessionDep,
    tenant: CanManage,
) -> QuestionnaireTemplateOut:
    """Add a template row; positions are unique within a kind."""
    duplicate = db.execute(
        select(QuestionnaireTemplate.id).where(
            QuestionnaireTemplate.kind == kind.value,
            QuestionnaireTemplate.position == payload.position,
        )
    ).first()
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A '{kind.value}' template already exists at position {payload.position}.",
        )

    row = QuestionnaireTemplate(kind=kind.value, **payload.model_dump())
    db.add(row)
    db.flush()
    record_audit(
        db,
        action=_AUDIT_TEMPLATE_CREATED,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="questionnaire_template",
        entity_id=row.id,
        detail={"kind": kind.value, "position": row.position},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(row)
    return QuestionnaireTemplateOut.model_validate(row)


@router.patch("/templates/{kind}/{template_id}", response_model=QuestionnaireTemplateOut)
def update_template(
    kind: domain.TemplateKind,
    template_id: int,
    payload: QuestionnaireTemplateUpsert,
    request: Request,
    db: SessionDep,
    tenant: CanManage,
) -> QuestionnaireTemplateOut:
    row = db.get(QuestionnaireTemplate, template_id)
    if row is None or row.kind != kind.value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found.")

    changes = payload.model_dump(exclude_unset=True)
    new_position = changes.get("position")
    if new_position is not None and new_position != row.position:
        duplicate = db.execute(
            select(QuestionnaireTemplate.id).where(
                QuestionnaireTemplate.kind == kind.value,
                QuestionnaireTemplate.position == new_position,
                QuestionnaireTemplate.id != template_id,
            )
        ).first()
        if duplicate is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A '{kind.value}' template already exists at position {new_position}.",
            )

    for field, value in changes.items():
        setattr(row, field, value)

    record_audit(
        db,
        action=_AUDIT_TEMPLATE_UPDATED,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="questionnaire_template",
        entity_id=row.id,
        detail={"kind": kind.value, "fields": sorted(changes.keys())},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(row)
    return QuestionnaireTemplateOut.model_validate(row)


@router.delete("/templates/{kind}/{template_id}", response_model=Message)
def delete_template(
    kind: domain.TemplateKind,
    template_id: int,
    request: Request,
    db: SessionDep,
    tenant: CanManage,
) -> Message:
    row = db.get(QuestionnaireTemplate, template_id)
    if row is None or row.kind != kind.value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found.")

    position = row.position
    db.delete(row)
    record_audit(
        db,
        action=_AUDIT_TEMPLATE_DELETED,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="questionnaire_template",
        entity_id=template_id,
        detail={"kind": kind.value, "position": position},
        ip_address=client_ip(request),
    )
    db.commit()
    return Message(message=f"'{kind.value}' template at position {position} deleted.")


# ---------------------------------------------------------------------------
# Vendor assessments
# ---------------------------------------------------------------------------


@router.get("/vendors", response_model=Page[VendorAssessmentOut])
def list_vendors(
    tenant: Tenant,
    db: SessionDep,
    paging: Paging,
    q: Annotated[Optional[str], Query(max_length=120)] = None,
    status_filter: Annotated[Optional[str], Query(alias="status", max_length=30)] = None,
    assessment_type: Annotated[Optional[domain.TemplateKind], Query()] = None,
) -> Page[VendorAssessmentOut]:
    """Paginated vendor assessments, filterable by name/domain, status and type."""
    stmt = select(VendorAssessment).where(VendorAssessment.organization_id == tenant.organization_id)

    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(VendorAssessment.vendor_name).like(like),
                func.lower(func.coalesce(VendorAssessment.primary_domain, "")).like(like),
            )
        )
    if status_filter:
        stmt = stmt.where(VendorAssessment.status == status_filter)
    if assessment_type:
        stmt = stmt.where(VendorAssessment.assessment_type == assessment_type.value)

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    stmt = (
        ordered(stmt, paging, VENDOR_SORTABLE, VendorAssessment.updated_at)
        .offset(paging.offset)
        .limit(paging.limit)
    )
    vendors = db.execute(stmt).scalars().all()
    return build_page([vendor_out(row) for row in vendors], int(total), paging)


@router.post("/vendors", response_model=VendorAssessmentOut, status_code=status.HTTP_201_CREATED)
def create_vendor(
    payload: VendorAssessmentCreate,
    request: Request,
    db: SessionDep,
    tenant: CanWrite,
) -> VendorAssessmentOut:
    """Create a vendor assessment."""
    values = payload.model_dump()
    values["assessment_type"] = payload.assessment_type.value
    vendor = VendorAssessment(
        organization_id=tenant.organization_id,
        created_by_id=tenant.user.id,
        **values,
    )
    db.add(vendor)
    db.flush()
    record_audit(
        db,
        action=_AUDIT_VENDOR_CREATED,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="vendor_assessment",
        entity_id=vendor.id,
        detail={"vendor_name": vendor.vendor_name, "assessment_type": vendor.assessment_type},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(vendor)
    return vendor_out(vendor)


@router.get("/vendors/{vendor_id}", response_model=VendorAssessmentOut)
def read_vendor(vendor_id: int, tenant: Tenant, db: SessionDep) -> VendorAssessmentOut:
    return vendor_out(_load_vendor(db, tenant, vendor_id))


@router.patch("/vendors/{vendor_id}", response_model=VendorAssessmentOut)
def update_vendor(
    vendor_id: int,
    payload: VendorAssessmentUpdate,
    request: Request,
    db: SessionDep,
    tenant: CanWrite,
) -> VendorAssessmentOut:
    vendor = _load_vendor(db, tenant, vendor_id)
    changes = payload.model_dump(exclude_unset=True)
    if isinstance(changes.get("assessment_type"), domain.StrEnum):
        changes["assessment_type"] = changes["assessment_type"].value

    for field, value in changes.items():
        setattr(vendor, field, value)

    record_audit(
        db,
        action=_AUDIT_VENDOR_UPDATED,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="vendor_assessment",
        entity_id=vendor.id,
        detail={"fields": sorted(changes.keys())},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(vendor)
    return vendor_out(vendor)


@router.delete("/vendors/{vendor_id}", response_model=Message)
def delete_vendor(
    vendor_id: int,
    request: Request,
    db: SessionDep,
    tenant: CanManage,
) -> Message:
    vendor = _load_vendor(db, tenant, vendor_id)
    name = vendor.vendor_name
    db.delete(vendor)
    record_audit(
        db,
        action=_AUDIT_VENDOR_DELETED,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="vendor_assessment",
        entity_id=vendor_id,
        detail={"vendor_name": name},
        ip_address=client_ip(request),
    )
    db.commit()
    return Message(message=f"Vendor assessment for {name} deleted.")


@router.post("/vendors/{vendor_id}/calculate", response_model=VendorAssessmentOut)
def calculate_vendor(
    vendor_id: int,
    request: Request,
    db: SessionDep,
    tenant: CanWrite,
) -> VendorAssessmentOut:
    """Run the legacy scoring for the vendor's assessment type and persist it."""
    vendor = _load_vendor(db, tenant, vendor_id)

    rows = db.execute(
        select(QuestionnaireTemplate)
        .where(QuestionnaireTemplate.kind == vendor.assessment_type)
        .order_by(QuestionnaireTemplate.position)
    ).scalars().all()
    template = [_template_dict(row) for row in rows]

    if vendor.assessment_type == domain.TemplateKind.CLOUD.value:
        scores = vendor.cloud_scores or {}
        result = legacy_calculator.calculate_cloud(scores, template)
    else:
        scores = vendor.answers or {}
        result = legacy_calculator.calculate_standard(scores, template)

    vendor.impact = result.get("impact")
    vendor.likelihood = result.get("likelihood")
    vendor.vulnerability = result.get("vulnerability")
    vendor.score = result.get("score")
    vendor.max_score = result.get("max_score")
    vendor.verdict = result.get("verdict")
    vendor.inherent_score = domain.risk_score(vendor.likelihood, vendor.impact)

    weakness, strength = _weakness_strength(template, scores)
    if weakness:
        vendor.weakness = weakness
    if strength:
        vendor.strength = strength

    record_audit(
        db,
        action=_AUDIT_VENDOR_CALCULATED,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="vendor_assessment",
        entity_id=vendor.id,
        detail={
            "assessment_type": vendor.assessment_type,
            "score": vendor.score,
            "max_score": vendor.max_score,
            "verdict": vendor.verdict,
        },
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(vendor)
    return vendor_out(vendor)


@router.post("/vendors/{vendor_id}/osint-scan", response_model=OsintScanOut)
def scan_vendor_osint(
    vendor_id: int,
    request: Request,
    db: SessionDep,
    tenant: CanWrite,
) -> OsintScanOut:
    """Run the OSINT checks and persist the resulting warnings."""
    vendor = _load_vendor(db, tenant, vendor_id)

    result = osint.scan_vendor(vendor.vendor_name, vendor.primary_domain)
    vendor.osint_warnings = result.warnings
    vendor.osint_urls = result.urls
    vendor.last_scanned_at = utcnow()
    vendor.osint_acknowledged = False

    record_audit(
        db,
        action=_AUDIT_VENDOR_OSINT_SCANNED,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="vendor_assessment",
        entity_id=vendor.id,
        detail={"warning_count": len(result.warnings), "live_checks": result.live_checks_enabled},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(vendor)
    return OsintScanOut(
        vendor=vendor_out(vendor),
        warnings=result.warnings,
        osint_results=result.results,
        live_checks_enabled=result.live_checks_enabled,
        notes=result.notes,
    )


@router.post("/vendors/{vendor_id}/acknowledge", response_model=VendorAssessmentOut)
def acknowledge_vendor(
    vendor_id: int,
    request: Request,
    db: SessionDep,
    tenant: CanWrite,
) -> VendorAssessmentOut:
    """Mark the vendor's OSINT warnings as acknowledged."""
    vendor = _load_vendor(db, tenant, vendor_id)
    vendor.osint_acknowledged = True

    record_audit(
        db,
        action=_AUDIT_VENDOR_ACKNOWLEDGED,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="vendor_assessment",
        entity_id=vendor.id,
        detail={"osint_acknowledged": True},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(vendor)
    return vendor_out(vendor)
