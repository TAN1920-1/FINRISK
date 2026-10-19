"""Risk register endpoints (CRUD, lifecycle, evidence, assessment history)."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from decimal import InvalidOperation
from typing import Annotated, Optional

from fastapi import APIRouter, File, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy import func, or_, select

from .. import domain
from ..audit import record_audit
from ..config import settings
from ..deps import CanManage, CanWrite, Paging, SessionDep, Tenant
from ..models import (
    Asset,
    EvidenceRecord,
    FinancialScenario,
    Mitigation,
    Risk,
    RiskAssessment,
    User,
    utcnow,
)
from ..schemas import (
    EvidenceCreate,
    EvidenceOut,
    ImportErrorRow,
    ImportResultOut,
    Message,
    Page,
    RiskAssessmentOut,
    RiskCreate,
    RiskDetailOut,
    RiskOut,
    RiskOwnerUpdate,
    RiskStatusUpdate,
    RiskUpdate,
)
from ..scoring.risk_scoring import expected_exposure_from_scenarios
from ..serializers import assessment_out, evidence_out, mitigation_out, risk_out
from ..services.common import (
    build_page,
    next_reference,
    ordered,
    parse_date,
    parse_money,
    parse_optional_scale,
    parse_scale,
    parse_share,
    parse_timestamp,
)

router = APIRouter(prefix="/api/risks", tags=["risks"])

SORTABLE = {
    "risk_ref": Risk.risk_ref,
    "title": Risk.title,
    "status": Risk.status,
    "category": Risk.category,
    "likelihood": Risk.likelihood,
    "impact": Risk.impact,
    "score": (Risk.likelihood * Risk.impact),
    "due_date": Risk.due_date,
    "created_at": Risk.created_at,
    "updated_at": Risk.updated_at,
}

#: Shared with the dashboard so both agree on what "High" covers.
SEVERITY_RANGES: dict[str, tuple[int, int]] = domain.SEVERITY_SCORE_RANGES

#: Optional CSV columns describing a documented loss scenario.  A row that fills
#: in any of these also creates the linked :class:`FinancialScenario`, which is
#: what gives the risk an expected exposure figure.  A row that leaves them all
#: blank imports as a plain risk and never invents a scenario.
SCENARIO_COLUMNS: tuple[str, ...] = (
    "scenario_name",
    "scenario_type",
    "assumptions",
    "currency",
    "probability",
    "residual_probability",
    "time_horizon_months",
    "direct_loss",
    "revenue_loss",
    "downtime_hours",
    "downtime_cost_per_hour",
    "recovery_cost",
    "incident_response_cost",
    "regulatory_cost",
    "other_cost",
    "insurance_recovery",
    "mitigation_cost",
)


def _number(raw: object) -> Optional[float]:
    """Parse a non-negative plain number; blank stays ``None``."""
    text = str(raw or "").strip()
    if not text:
        return None
    value = float(text)
    if value < 0:
        raise ValueError(text)
    return value


def _scenario_payload(
    normalised: dict[str, str], title: str
) -> tuple[Optional[dict], Optional[str]]:
    """Build the scenario columns for one CSV row.

    Returns ``(payload, error)``.  ``payload`` is ``None`` when the row carries no
    scenario columns at all.
    """
    if not any(str(normalised.get(key) or "").strip() for key in SCENARIO_COLUMNS):
        return None, None

    scenario_type = (
        str(normalised.get("scenario_type") or "").strip().lower()
        or domain.ScenarioType.BASE_CASE.value
    )
    try:
        domain.ScenarioType(scenario_type)
    except ValueError:
        return None, f"Unknown scenario_type '{scenario_type}'."

    currency = str(normalised.get("currency") or "").strip().upper() or "USD"
    if len(currency) != 3 or not currency.isalpha():
        return None, f"Invalid currency '{currency}'."

    try:
        horizon = _number(normalised.get("time_horizon_months"))
        payload = {
            "name": (
                str(normalised.get("scenario_name") or "").strip() or f"{title} - base case"
            )[:200],
            "scenario_type": scenario_type,
            "assumptions": str(normalised.get("assumptions") or "").strip() or None,
            "currency": currency,
            "time_horizon_months": int(horizon) if horizon else 12,
            "probability": parse_share(normalised.get("probability"), 0.1),
            "residual_probability": parse_share(normalised.get("residual_probability")),
            "direct_loss": parse_money(normalised.get("direct_loss")),
            "revenue_loss": parse_money(normalised.get("revenue_loss")),
            "downtime_hours": _number(normalised.get("downtime_hours")),
            "downtime_cost_per_hour": parse_money(normalised.get("downtime_cost_per_hour")),
            "recovery_cost": parse_money(normalised.get("recovery_cost")),
            "incident_response_cost": parse_money(normalised.get("incident_response_cost")),
            "regulatory_cost": parse_money(normalised.get("regulatory_cost")),
            "other_cost": parse_money(normalised.get("other_cost")),
            "insurance_recovery": parse_money(normalised.get("insurance_recovery")),
            "mitigation_cost": parse_money(normalised.get("mitigation_cost")),
        }
    except (InvalidOperation, ValueError):
        return None, "A scenario column holds a value outside its permitted range."
    return payload, None


def _load_risk(db, tenant: Tenant, risk_id: int) -> Risk:
    risk = db.get(Risk, risk_id)
    if risk is None or risk.organization_id != tenant.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk not found.")
    return risk


def _context(db, tenant: Tenant, risks: list[Risk]) -> list[RiskOut]:
    """Attach asset/owner names, mitigation counts and exposure to risks."""
    if not risks:
        return []

    risk_ids = [risk.id for risk in risks]
    asset_ids = [risk.asset_id for risk in risks if risk.asset_id]
    owner_ids = [risk.owner_id for risk in risks if risk.owner_id]

    assets = {
        row[0]: row[1]
        for row in db.execute(select(Asset.id, Asset.name).where(Asset.id.in_(asset_ids))).all()
    } if asset_ids else {}
    owners = {
        row[0]: row[1]
        for row in db.execute(select(User.id, User.full_name).where(User.id.in_(owner_ids))).all()
    } if owner_ids else {}

    mitigation_rows = db.execute(
        select(Mitigation.risk_id, func.count(Mitigation.id))
        .where(Mitigation.risk_id.in_(risk_ids))
        .group_by(Mitigation.risk_id)
    ).all()
    mitigation_counts = {row[0]: int(row[1]) for row in mitigation_rows}

    completed_rows = db.execute(
        select(Mitigation.risk_id, func.count(Mitigation.id))
        .where(
            Mitigation.risk_id.in_(risk_ids),
            Mitigation.status == domain.MitigationStatus.COMPLETED.value,
        )
        .group_by(Mitigation.risk_id)
    ).all()
    completed_counts = {row[0]: int(row[1]) for row in completed_rows}

    scenarios_by_risk: dict[int, list[FinancialScenario]] = {}
    for scenario in db.execute(
        select(FinancialScenario).where(FinancialScenario.risk_id.in_(risk_ids))
    ).scalars().all():
        scenarios_by_risk.setdefault(scenario.risk_id, []).append(scenario)

    payload: list[RiskOut] = []
    for risk in risks:
        gross = residual = None
        currency = None
        scenarios = scenarios_by_risk.get(risk.id)
        if scenarios:
            gross, currency = expected_exposure_from_scenarios(scenarios)
            residual, _ = expected_exposure_from_scenarios(scenarios, residual=True)
        payload.append(
            risk_out(
                risk,
                asset_name=assets.get(risk.asset_id),
                owner_name=owners.get(risk.owner_id),
                mitigation_count=mitigation_counts.get(risk.id, 0),
                completed_mitigation_count=completed_counts.get(risk.id, 0),
                expected_gross_exposure=gross,
                expected_residual_exposure=residual,
                currency=currency,
            )
        )
    return payload


def _base_query(tenant: Tenant):
    return select(Risk).where(Risk.organization_id == tenant.organization_id)


@router.get("", response_model=Page[RiskOut])
def list_risks(
    tenant: Tenant,
    db: SessionDep,
    paging: Paging,
    q: Annotated[Optional[str], Query(max_length=120)] = None,
    status_filter: Annotated[Optional[list[domain.RiskStatus]], Query(alias="status")] = None,
    category: Annotated[Optional[list[domain.RiskCategory]], Query()] = None,
    severity: Annotated[Optional[list[domain.Severity]], Query()] = None,
    business_unit: Annotated[Optional[str], Query(max_length=120)] = None,
    asset_id: Annotated[Optional[int], Query()] = None,
    owner_id: Annotated[Optional[int], Query()] = None,
    evidence_quality: Annotated[Optional[list[domain.EvidenceQuality]], Query()] = None,
    overdue_only: Annotated[bool, Query()] = False,
    open_only: Annotated[bool, Query()] = False,
) -> Page[RiskOut]:
    """Filterable, sortable, paginated risk register."""
    stmt = _base_query(tenant)

    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Risk.title).like(like),
                func.lower(Risk.risk_ref).like(like),
                func.lower(func.coalesce(Risk.description, "")).like(like),
            )
        )
    if status_filter:
        stmt = stmt.where(Risk.status.in_([item.value for item in status_filter]))
    elif open_only:
        stmt = stmt.where(Risk.status.in_(domain.OPEN_RISK_STATUSES))
    if category:
        stmt = stmt.where(Risk.category.in_([item.value for item in category]))
    if severity:
        score = Risk.likelihood * Risk.impact
        conditions = []
        for item in severity:
            low, high = SEVERITY_RANGES[item.value]
            conditions.append(score.between(low, high))
        stmt = stmt.where(or_(*conditions))
    if business_unit:
        stmt = stmt.where(Risk.business_unit == business_unit)
    if asset_id:
        stmt = stmt.where(Risk.asset_id == asset_id)
    if owner_id:
        stmt = stmt.where(Risk.owner_id == owner_id)
    if evidence_quality:
        stmt = stmt.where(Risk.evidence_quality.in_([item.value for item in evidence_quality]))
    if overdue_only:
        stmt = stmt.where(
            Risk.due_date.is_not(None),
            Risk.due_date < datetime.now(timezone.utc).date(),
            Risk.status.in_(domain.OPEN_RISK_STATUSES),
        )

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    stmt = ordered(stmt, paging, SORTABLE, Risk.updated_at).offset(paging.offset).limit(paging.limit)
    risks = db.execute(stmt).scalars().all()

    return build_page(_context(db, tenant, list(risks)), int(total), paging)


@router.get("/options", response_model=list[dict])
def risk_options(tenant: Tenant, db: SessionDep) -> list[dict]:
    rows = db.execute(
        select(Risk.id, Risk.risk_ref, Risk.title)
        .where(Risk.organization_id == tenant.organization_id)
        .order_by(Risk.risk_ref)
    ).all()
    return [{"id": row[0], "risk_ref": row[1], "title": row[2]} for row in rows]


@router.get("/meta", response_model=dict)
def risk_meta(tenant: Tenant, db: SessionDep) -> dict:
    """Filter vocabularies, including business units that actually exist."""
    business_units = db.execute(
        select(Risk.business_unit)
        .where(Risk.organization_id == tenant.organization_id, Risk.business_unit.is_not(None))
        .distinct()
        .order_by(Risk.business_unit)
    ).scalars().all()

    return {
        "categories": [item.value for item in domain.RiskCategory],
        "statuses": [item.value for item in domain.RiskStatus],
        "severities": [item.value for item in domain.Severity],
        "evidence_quality": [item.value for item in domain.EvidenceQuality],
        "open_statuses": list(domain.OPEN_RISK_STATUSES),
        "severity_bands": {key: list(value) for key, value in SEVERITY_RANGES.items()},
        "business_units": [unit for unit in business_units if unit],
    }


@router.get("/export")
def export_risks(
    tenant: Tenant,
    db: SessionDep,
    status_filter: Annotated[Optional[list[domain.RiskStatus]], Query(alias="status")] = None,
    category: Annotated[Optional[list[domain.RiskCategory]], Query()] = None,
    severity: Annotated[Optional[list[domain.Severity]], Query()] = None,
    business_unit: Annotated[Optional[str], Query(max_length=120)] = None,
) -> Response:
    """CSV of the currently filtered register (authorisation checked first)."""
    stmt = _base_query(tenant)
    if status_filter:
        stmt = stmt.where(Risk.status.in_([item.value for item in status_filter]))
    if category:
        stmt = stmt.where(Risk.category.in_([item.value for item in category]))
    if severity:
        score = Risk.likelihood * Risk.impact
        stmt = stmt.where(
            or_(
                *[
                    score.between(*SEVERITY_RANGES[item.value])
                    for item in severity
                ]
            )
        )
    if business_unit:
        stmt = stmt.where(Risk.business_unit == business_unit)

    risks = db.execute(stmt.order_by(Risk.risk_ref)).scalars().all()
    rows = _context(db, tenant, list(risks))

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "Risk reference",
            "Title",
            "Category",
            "Status",
            "Likelihood",
            "Impact",
            "Inherent score",
            "Severity",
            "Residual score",
            "Residual severity",
            "Evidence quality",
            "Asset",
            "Owner",
            "Business unit",
            "Due date",
            "Mitigations",
            "Expected exposure",
            "Currency",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row.risk_ref,
                row.title,
                row.category,
                row.status,
                row.likelihood,
                row.impact,
                row.inherent_score,
                row.severity,
                row.residual_score if row.residual_score is not None else "",
                row.residual_severity or "",
                row.evidence_quality,
                row.asset_name or "",
                row.owner_name or "",
                row.business_unit or "",
                row.due_date.isoformat() if row.due_date else "",
                row.mitigation_count,
                row.expected_gross_exposure if row.expected_gross_exposure is not None else "",
                row.currency or "",
            ]
        )

    filename = f"risk-register-{datetime.now(timezone.utc).date().isoformat()}.csv"
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("", response_model=RiskOut, status_code=status.HTTP_201_CREATED)
def create_risk(payload: RiskCreate, request: Request, db: SessionDep, tenant: CanWrite) -> RiskOut:
    """Add a risk to the register."""
    if payload.asset_id is not None:
        asset = db.get(Asset, payload.asset_id)
        if asset is None or asset.organization_id != tenant.organization_id:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Asset not found.")
    if payload.owner_id is not None and db.get(User, payload.owner_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Owner not found.")

    values = payload.model_dump(exclude={"risk_ref"})
    values["category"] = payload.category.value
    values["status"] = payload.status.value
    values["evidence_quality"] = payload.evidence_quality.value

    risk = Risk(
        organization_id=tenant.organization_id,
        risk_ref=(
            payload.risk_ref or next_reference(db, Risk, tenant.organization_id, "RSK", column="risk_ref")
        ).strip(),
        **values,
    )
    db.add(risk)
    db.flush()

    db.add(
        RiskAssessment(
            organization_id=tenant.organization_id,
            risk_id=risk.id,
            assessor_id=tenant.user.id,
            method=domain.AssessmentMethod.RULES.value,
            likelihood=risk.likelihood,
            impact=risk.impact,
            inherent_score=domain.risk_score(risk.likelihood, risk.impact),
            residual_likelihood=risk.residual_likelihood,
            residual_impact=risk.residual_impact,
            residual_score=risk.residual_score,
            notes="Initial assessment created with the risk record.",
        )
    )
    record_audit(
        db,
        action=domain.AuditAction.RISK_CREATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="risk",
        entity_id=risk.id,
        detail={"ref": risk.risk_ref, "severity": risk.severity},
    )
    db.commit()
    db.refresh(risk)
    return _context(db, tenant, [risk])[0]


@router.get("/{risk_id}", response_model=RiskDetailOut)
def read_risk(risk_id: int, tenant: Tenant, db: SessionDep) -> RiskDetailOut:
    risk = _load_risk(db, tenant, risk_id)
    base = _context(db, tenant, [risk])[0]

    evidence = db.execute(
        select(EvidenceRecord).where(EvidenceRecord.risk_id == risk.id).order_by(EvidenceRecord.created_at.desc())
    ).scalars().all()
    assessments = db.execute(
        select(RiskAssessment)
        .where(RiskAssessment.risk_id == risk.id)
        .order_by(RiskAssessment.assessed_at.desc())
        .limit(50)
    ).scalars().all()
    mitigations = db.execute(
        select(Mitigation).where(Mitigation.risk_id == risk.id).order_by(Mitigation.due_date)
    ).scalars().all()

    assignees = {
        row[0]: row[1]
        for row in db.execute(
            select(User.id, User.full_name).where(
                User.id.in_([m.assigned_user_id for m in mitigations if m.assigned_user_id])
            )
        ).all()
    } if any(m.assigned_user_id for m in mitigations) else {}

    return RiskDetailOut(
        **base.model_dump(),
        evidence=[evidence_out(item) for item in evidence],
        assessments=[assessment_out(item) for item in assessments],
        mitigations=[
            mitigation_out(item, risk=risk, assignee=None) for item in mitigations
        ],
    )


@router.patch("/{risk_id}", response_model=RiskOut)
def update_risk(risk_id: int, payload: RiskUpdate, db: SessionDep, tenant: CanWrite) -> RiskOut:
    risk = _load_risk(db, tenant, risk_id)
    changes = payload.model_dump(exclude_unset=True)

    if changes.pop("clear_residual", False):
        risk.residual_likelihood = None
        risk.residual_impact = None

    if changes.get("asset_id") is not None:
        asset = db.get(Asset, changes["asset_id"])
        if asset is None or asset.organization_id != tenant.organization_id:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Asset not found.")
    if changes.get("owner_id") is not None and db.get(User, changes["owner_id"]) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Owner not found.")

    for field, value in changes.items():
        if isinstance(value, domain.StrEnum):
            value = value.value
        setattr(risk, field, value)

    if risk.residual_likelihood is None or risk.residual_impact is None:
        risk.residual_likelihood = None
        risk.residual_impact = None

    if risk.status in (domain.RiskStatus.RESOLVED.value, domain.RiskStatus.CLOSED.value):
        risk.closed_at = risk.closed_at or utcnow()
    elif risk.status in domain.OPEN_RISK_STATUSES:
        risk.closed_at = None

    record_audit(
        db,
        action=domain.AuditAction.RISK_UPDATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="risk",
        entity_id=risk.id,
        detail={"fields": sorted(changes.keys())},
    )
    db.commit()
    db.refresh(risk)
    return _context(db, tenant, [risk])[0]


@router.post("/{risk_id}/status", response_model=RiskOut)
def change_status(risk_id: int, payload: RiskStatusUpdate, db: SessionDep, tenant: CanWrite) -> RiskOut:
    """Move a risk through its lifecycle, recording an assessment snapshot."""
    risk = _load_risk(db, tenant, risk_id)
    previous = risk.status
    risk.status = payload.status.value
    if payload.status in (domain.RiskStatus.RESOLVED, domain.RiskStatus.CLOSED):
        risk.closed_at = utcnow()
    else:
        risk.closed_at = None

    db.add(
        RiskAssessment(
            organization_id=tenant.organization_id,
            risk_id=risk.id,
            assessor_id=tenant.user.id,
            method=domain.AssessmentMethod.RULES.value,
            likelihood=risk.likelihood,
            impact=risk.impact,
            inherent_score=domain.risk_score(risk.likelihood, risk.impact),
            residual_likelihood=risk.residual_likelihood,
            residual_impact=risk.residual_impact,
            residual_score=risk.residual_score,
            notes=f"Status changed from {previous} to {risk.status}. {payload.note or ''}".strip(),
        )
    )
    record_audit(
        db,
        action=domain.AuditAction.RISK_STATUS_CHANGED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="risk",
        entity_id=risk.id,
        detail={"from": previous, "to": risk.status, "note": payload.note},
    )
    db.commit()
    db.refresh(risk)
    return _context(db, tenant, [risk])[0]


@router.post("/{risk_id}/owner", response_model=RiskOut)
def assign_owner(risk_id: int, payload: RiskOwnerUpdate, db: SessionDep, tenant: CanWrite) -> RiskOut:
    risk = _load_risk(db, tenant, risk_id)
    if payload.owner_id is not None and db.get(User, payload.owner_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Owner not found.")

    risk.owner_id = payload.owner_id
    record_audit(
        db,
        action=domain.AuditAction.RISK_UPDATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="risk",
        entity_id=risk.id,
        detail={"owner_id": payload.owner_id},
    )
    db.commit()
    db.refresh(risk)
    return _context(db, tenant, [risk])[0]


@router.post("/{risk_id}/assessments", response_model=RiskAssessmentOut, status_code=status.HTTP_201_CREATED)
def record_assessment(risk_id: int, db: SessionDep, tenant: CanWrite) -> RiskAssessmentOut:
    """Snapshot the current scoring of a risk (history for trend analysis)."""
    risk = _load_risk(db, tenant, risk_id)

    assessment = RiskAssessment(
        organization_id=tenant.organization_id,
        risk_id=risk.id,
        assessor_id=tenant.user.id,
        method=domain.AssessmentMethod.RULES.value,
        likelihood=risk.likelihood,
        impact=risk.impact,
        inherent_score=domain.risk_score(risk.likelihood, risk.impact),
        residual_likelihood=risk.residual_likelihood,
        residual_impact=risk.residual_impact,
        residual_score=risk.residual_score,
        confidence=domain.EVIDENCE_CONFIDENCE.get(risk.evidence_quality, 0.9),
        notes="Assessment snapshot recorded.",
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)
    return assessment_out(assessment)


@router.post("/{risk_id}/evidence", response_model=EvidenceOut, status_code=status.HTTP_201_CREATED)
def add_evidence(risk_id: int, payload: EvidenceCreate, db: SessionDep, tenant: CanWrite) -> EvidenceOut:
    risk = _load_risk(db, tenant, risk_id)
    record = EvidenceRecord(
        organization_id=tenant.organization_id,
        risk_id=risk.id,
        created_by_id=tenant.user.id,
        title=payload.title,
        description=payload.description,
        evidence_type=payload.evidence_type,
        source_url=payload.source_url,
        quality=payload.quality.value,
        collected_at=payload.collected_at or utcnow(),
    )
    db.add(record)

    highest = [
        risk.evidence_quality,
        payload.quality.value,
    ]
    order = {
        domain.EvidenceQuality.NONE.value: 0,
        domain.EvidenceQuality.LOW.value: 1,
        domain.EvidenceQuality.MEDIUM.value: 2,
        domain.EvidenceQuality.HIGH.value: 3,
        domain.EvidenceQuality.VERIFIED.value: 4,
    }
    risk.evidence_quality = max(highest, key=lambda value: order.get(value, 0))

    record_audit(
        db,
        action=domain.AuditAction.RISK_UPDATED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="risk",
        entity_id=risk.id,
        detail={"evidence_added": payload.title, "quality": payload.quality.value},
    )
    db.commit()
    db.refresh(record)
    return evidence_out(record)


@router.delete("/{risk_id}", response_model=Message)
def delete_risk(risk_id: int, db: SessionDep, tenant: CanManage) -> Message:
    """Delete a risk and its dependent records (manager and above only)."""
    risk = _load_risk(db, tenant, risk_id)
    reference = risk.risk_ref
    db.delete(risk)
    record_audit(
        db,
        action=domain.AuditAction.RISK_DELETED.value,
        user=tenant.user,
        organization_id=tenant.organization_id,
        entity_type="risk",
        entity_id=risk_id,
        detail={"ref": reference},
    )
    db.commit()
    return Message(message=f"Risk {reference} deleted.")


@router.post(
    "/import",
    response_model=ImportResultOut,
    summary="Import risks from CSV",
)
async def import_risks(
    request: Request,
    tenant: CanWrite,
    db: SessionDep,
    file: UploadFile = File(...),
) -> ImportResultOut:
    """Import risks from CSV.

    Required columns: ``title``, ``category``.
    Optional: ``risk_ref``, ``description``, ``asset_ref``, ``likelihood`` (1-5),
    ``impact`` (1-5), ``status``, ``business_unit``, ``owner_email``,
    ``evidence_quality`` (none/low/medium/high/verified), ``due_date`` (ISO-8601),
    ``residual_likelihood`` and ``residual_impact`` (1-5; both are required before
    a residual score can be computed), ``source``, ``threat_scenario``,
    ``financial_impact_assumptions``, ``existing_controls`` and ``mitigation_plan``.

    ``created_at`` and ``closed_at`` are accepted so that a historical register can
    be loaded without every row landing on the import date; a value with no
    timezone offset is read as UTC, and a row that leaves them blank is stamped
    with the import time.  ``closed_at`` defaults to the import time for rows
    whose status is ``resolved`` or ``closed``.

    A row that also fills in any loss-scenario column (see ``SCENARIO_COLUMNS``)
    creates the linked ``FinancialScenario`` as well, so the expected exposure on
    the Financial Exposure screen is populated from the same file.  Rows are
    validated before anything is written: a reference that already exists is
    reported as an error row rather than colliding with the unique constraint.
    """
    filename = (file.filename or "risks.csv").strip()
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
    if "title" not in headers or "category" not in headers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The CSV must contain at least 'title' and 'category' columns.",
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

    assets_by_ref = {
        asset.asset_ref.lower(): asset
        for asset in db.execute(select(Asset).where(Asset.organization_id == tenant.organization_id)).scalars()
    }
    users_by_email = {
        user.email.lower(): user
        for user in db.execute(select(User)).scalars()
    }

    taken_refs = {
        ref.lower()
        for ref in db.execute(
            select(Risk.risk_ref).where(Risk.organization_id == tenant.organization_id)
        )
        .scalars()
        .all()
    }

    errors: list[ImportErrorRow] = []
    created = 0
    rows = list(reader)
    batch.rows_total = len(rows)

    for index, row in enumerate(rows, start=2):
        normalised = {str(key or "").strip().lower(): value for key, value in row.items()}
        title = str(normalised.get("title") or "").strip()
        category = str(normalised.get("category") or "").strip().lower()

        if not title:
            errors.append(ImportErrorRow(row=index, error="Missing required 'title' value."))
            continue
        if not category:
            errors.append(ImportErrorRow(row=index, error="Missing required 'category' value."))
            continue
        
        try:
            domain.RiskCategory(category)
        except ValueError:
            errors.append(ImportErrorRow(row=index, error=f"Unknown category '{category}'."))
            continue

        asset = None
        asset_ref = str(normalised.get("asset_ref") or "").strip().lower()
        if asset_ref:
            asset = assets_by_ref.get(asset_ref)
            if asset is None:
                errors.append(ImportErrorRow(row=index, error=f"Unknown asset_ref '{asset_ref}'."))
                continue

        owner = None
        owner_email = str(normalised.get("owner_email") or "").strip().lower()
        if owner_email:
            owner = users_by_email.get(owner_email)
            if owner is None:
                errors.append(ImportErrorRow(row=index, error=f"Unknown owner_email '{owner_email}'."))
                continue

        risk_status = str(normalised.get("status") or "").strip().lower()
        if risk_status:
            try:
                domain.RiskStatus(risk_status)
            except ValueError:
                errors.append(ImportErrorRow(row=index, error=f"Unknown status '{risk_status}'."))
                continue

        evidence_quality = (
            str(normalised.get("evidence_quality") or "").strip().lower()
            or domain.EvidenceQuality.MEDIUM.value
        )
        try:
            domain.EvidenceQuality(evidence_quality)
        except ValueError:
            errors.append(
                ImportErrorRow(row=index, error=f"Unknown evidence_quality '{evidence_quality}'.")
            )
            continue

        try:
            due_date = parse_date(normalised.get("due_date"))
            residual_likelihood = parse_optional_scale(normalised.get("residual_likelihood"))
            residual_impact = parse_optional_scale(normalised.get("residual_impact"))
            created_at = parse_timestamp(normalised.get("created_at"))
            closed_at = parse_timestamp(normalised.get("closed_at"))
        except ValueError:
            errors.append(
                ImportErrorRow(
                    row=index,
                    error=(
                        "Invalid date or residual score. Use an ISO-8601 date, and whole "
                        "numbers from 1 to 5 for residual_likelihood and residual_impact."
                    ),
                )
            )
            continue

        if (residual_likelihood is None) != (residual_impact is None):
            errors.append(
                ImportErrorRow(
                    row=index,
                    error="Residual likelihood and impact must be supplied together.",
                )
            )
            continue

        scenario_payload, scenario_error = _scenario_payload(normalised, title)
        if scenario_error:
            errors.append(ImportErrorRow(row=index, error=scenario_error))
            continue

        explicit_ref = str(normalised.get("risk_ref") or "").strip()
        if explicit_ref:
            if explicit_ref.lower() in taken_refs:
                errors.append(
                    ImportErrorRow(row=index, error=f"Risk reference '{explicit_ref}' already exists.")
                )
                continue
            risk_ref = explicit_ref
        else:
            risk_ref = next_reference(db, Risk, tenant.organization_id, "RSK", column="risk_ref")
            while risk_ref.lower() in taken_refs:
                risk_ref = f"RSK-{int(risk_ref.split('-')[-1]) + 1:04d}"
        taken_refs.add(risk_ref.lower())

        is_closed = risk_status in (
            domain.RiskStatus.RESOLVED.value,
            domain.RiskStatus.CLOSED.value,
        )
        created_at = created_at or utcnow()

        risk = Risk(
            organization_id=tenant.organization_id,
            risk_ref=risk_ref,
            title=title[:250],
            description=str(normalised.get("description") or "").strip() or None,
            category=category,
            source=str(normalised.get("source") or "").strip() or None,
            asset_id=asset.id if asset else None,
            owner_id=owner.id if owner else None,
            business_unit=str(normalised.get("business_unit") or "").strip() or None,
            threat_scenario=str(normalised.get("threat_scenario") or "").strip() or None,
            likelihood=parse_scale(normalised.get("likelihood")),
            impact=parse_scale(normalised.get("impact")),
            financial_impact_assumptions=(
                str(normalised.get("financial_impact_assumptions") or "").strip() or None
            ),
            existing_controls=str(normalised.get("existing_controls") or "").strip() or None,
            mitigation_plan=str(normalised.get("mitigation_plan") or "").strip() or None,
            residual_likelihood=residual_likelihood,
            residual_impact=residual_impact,
            status=risk_status or domain.RiskStatus.IDENTIFIED.value,
            evidence_quality=evidence_quality,
            due_date=due_date,
            created_at=created_at,
            closed_at=closed_at or (utcnow() if is_closed else None),
        )
        db.add(risk)
        db.flush()

        # Initial assessment
        db.add(
            RiskAssessment(
                organization_id=tenant.organization_id,
                risk_id=risk.id,
                assessor_id=tenant.user.id,
                assessed_at=created_at,
                method=domain.AssessmentMethod.RULES.value,
                likelihood=risk.likelihood,
                impact=risk.impact,
                inherent_score=domain.risk_score(risk.likelihood, risk.impact),
                notes="Imported via CSV.",
            )
        )

        if scenario_payload:
            db.add(
                FinancialScenario(
                    organization_id=tenant.organization_id,
                    risk_id=risk.id,
                    asset_id=asset.id if asset else None,
                    created_by_id=tenant.user.id,
                    **scenario_payload,
                )
            )
        created += 1

    batch.rows_created = created
    batch.rows_failed = len(errors)
    batch.errors = [item.model_dump() for item in errors]

    record_audit(
        db,
        action=domain.AuditAction.RISK_CREATED.value,
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
