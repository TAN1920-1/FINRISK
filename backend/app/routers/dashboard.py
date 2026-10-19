"""Dashboard aggregation API.

Every figure returned by this module is derived from persisted rows for the
caller's organization.  Nothing is hardcoded and no random values are generated
at render time.  When there is no data the endpoint says so explicitly through
``data_state`` rather than inventing placeholder statistics.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select

from .. import domain
from ..deps import SessionDep, Tenant
from ..models import (
    Asset,
    AuditLog,
    FinancialScenario,
    Mitigation,
    Risk,
    User,
    VulnerabilityFinding,
    as_utc,
    utcnow,
)
from ..schemas import (
    DashboardFilters,
    DashboardOut,
    KpiValue,
    NamedSeries,
    OrganizationOut,
    SeriesPoint,
)
from ..scoring.financial import compute_losses
from ..serializers import mitigation_out, risk_out
from ..services.scenarios import inputs_from_scenario

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

MONTH_BUCKETS = 12
TOP_RISK_LIMIT = 5
UPCOMING_MITIGATION_LIMIT = 5
RECENT_ACTIVITY_LIMIT = 10

OPEN_FINDING_STATUSES = domain.OPEN_REMEDIATION_STATUSES


def _day_start(value: date) -> datetime:
    """Naive UTC start-of-day, matching how SQLite stores the timestamps."""
    return datetime.combine(value, time.min)


def _day_end(value: date) -> datetime:
    return datetime.combine(value, time.max)


def _risk_statement(organization_id: int, filters: DashboardFilters):
    stmt = select(Risk).where(Risk.organization_id == organization_id)
    if filters.start_date:
        stmt = stmt.where(Risk.created_at >= _day_start(filters.start_date))
    if filters.end_date:
        stmt = stmt.where(Risk.created_at <= _day_end(filters.end_date))
    if filters.category:
        stmt = stmt.where(Risk.category == filters.category.value)
    if filters.business_unit:
        stmt = stmt.where(Risk.business_unit == filters.business_unit)
    if filters.asset_id is not None:
        stmt = stmt.where(Risk.asset_id == filters.asset_id)
    if filters.severity:
        low, high = domain.SEVERITY_SCORE_RANGES[filters.severity.value]
        score = Risk.likelihood * Risk.impact
        stmt = stmt.where(score >= low, score <= high)
    return stmt


def _month_label(value: datetime) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def _month_labels(today: date) -> list[str]:
    labels: list[str] = []
    cursor = date(today.year, today.month, 1)
    for _ in range(MONTH_BUCKETS):
        labels.append(f"{cursor.year:04d}-{cursor.month:02d}")
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    return list(reversed(labels))


@router.get("", response_model=DashboardOut, summary="Organization risk dashboard")
def get_dashboard(
    tenant: Tenant,
    db: SessionDep,
    filters: Annotated[DashboardFilters, Depends()],
) -> DashboardOut:
    organization_id = tenant.organization_id
    organization_currency = tenant.organization.currency or "USD"
    today = date.today()

    risks = list(db.execute(_risk_statement(organization_id, filters)).scalars().all())
    risk_ids = {risk.id for risk in risks}

    assets = list(
        db.execute(
            select(Asset).where(Asset.organization_id == organization_id, Asset.is_active.is_(True))
        )
        .scalars()
        .all()
    )
    findings_stmt = select(VulnerabilityFinding).where(
        VulnerabilityFinding.organization_id == organization_id
    )
    if filters.asset_id is not None:
        findings_stmt = findings_stmt.where(VulnerabilityFinding.asset_id == filters.asset_id)
    findings = list(db.execute(findings_stmt).scalars().all())

    scenarios = (
        list(
            db.execute(
                select(FinancialScenario).where(
                    FinancialScenario.organization_id == organization_id,
                    or_(
                        FinancialScenario.risk_id.in_(risk_ids) if risk_ids else False,
                        FinancialScenario.risk_id.is_(None),
                    ),
                )
            )
            .scalars()
            .all()
        )
        if risk_ids
        else []
    )

    mitigations = list(
        db.execute(select(Mitigation).where(Mitigation.organization_id == organization_id)).scalars().all()
    )

    # --- risk counts -------------------------------------------------------
    severity_counts: dict[str, int] = defaultdict(int)
    category_counts: dict[str, int] = defaultdict(int)
    business_unit_exposure: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    currency_totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    per_scenario: list[tuple[FinancialScenario, Decimal, Decimal]] = []

    for scenario in scenarios:
        result = compute_losses(inputs_from_scenario(scenario))
        scenario_currency = scenario.currency or "USD"
        currency_totals[scenario_currency] += result.expected_loss
        per_scenario.append((scenario, result.expected_loss, result.expected_residual_loss))

    dominant_currency = (
        max(currency_totals.items(), key=lambda item: item[1])[0] if currency_totals else organization_currency
    )
    expected_gross = sum(
        (expected for scenario, expected, _ in per_scenario if (scenario.currency or "USD") == dominant_currency),
        Decimal("0.00"),
    )
    expected_residual = sum(
        (residual for scenario, _, residual in per_scenario if (scenario.currency or "USD") == dominant_currency),
        Decimal("0.00"),
    )

    risk_by_id = {risk.id: risk for risk in risks}
    for scenario, expected, _ in per_scenario:
        if (scenario.currency or "USD") != dominant_currency:
            continue
        parent = risk_by_id.get(scenario.risk_id) if scenario.risk_id else None
        unit = (parent.business_unit if parent and parent.business_unit else None) or "Unassigned"
        business_unit_exposure[unit] += expected

    open_risks = 0
    overdue_risks = 0
    open_statuses = set(domain.OPEN_RISK_STATUSES)
    for risk in risks:
        severity_counts[risk.severity] += 1
        category_counts[risk.category] += 1
        if risk.status in open_statuses:
            open_risks += 1
            if risk.due_date and risk.due_date < today:
                overdue_risks += 1

    # --- trend ------------------------------------------------------------
    labels = _month_labels(today)
    created_buckets: dict[str, int] = defaultdict(int)
    resolved_buckets: dict[str, int] = defaultdict(int)
    for risk in risks:
        if risk.created_at:
            key = _month_label(risk.created_at)
            if key in labels:
                created_buckets[key] += 1
        if risk.closed_at:
            key = _month_label(risk.closed_at)
            if key in labels:
                resolved_buckets[key] += 1

    trend_points = [
        SeriesPoint(label=label, value=created_buckets.get(label, 0), secondary=resolved_buckets.get(label, 0))
        for label in labels
    ]

    # --- findings ---------------------------------------------------------
    open_findings = [item for item in findings if item.remediation_status in OPEN_FINDING_STATUSES]
    critical_findings = [item for item in findings if item.priority_band == domain.Severity.CRITICAL.value]

    # --- mitigations ------------------------------------------------------
    open_mitigations = [item for item in mitigations if item.status not in {"completed", "cancelled"}]
    overdue_mitigations = [
        item for item in open_mitigations if item.due_date is not None and item.due_date < today
    ]

    # --- 30-day momentum --------------------------------------------------
    window_start = utcnow() - timedelta(days=30)
    previous_start = window_start - timedelta(days=30)
    recent_count = sum(
        1 for risk in risks if as_utc(risk.created_at) and as_utc(risk.created_at) >= window_start
    )
    previous_count = sum(
        1
        for risk in risks
        if as_utc(risk.created_at)
        and previous_start <= as_utc(risk.created_at) < window_start
    )
    momentum: Optional[float] = None
    if previous_count:
        momentum = round((recent_count - previous_count) / previous_count * 100, 1)

    reduction_pct = (
        round(float((expected_gross - expected_residual) / expected_gross) * 100, 1)
        if expected_gross > 0
        else None
    )

    kpis = [
        KpiValue(key="total_risks", label="Total risks", value=float(len(risks))),
        KpiValue(key="open_risks", label="Open risks", value=float(open_risks)),
        KpiValue(
            key="critical_risks",
            label="Critical risks",
            value=float(severity_counts.get(domain.Severity.CRITICAL.value, 0)),
        ),
        KpiValue(
            key="high_risks",
            label="High risks",
            value=float(severity_counts.get(domain.Severity.HIGH.value, 0)),
        ),
        KpiValue(
            key="overdue_risks",
            label="Overdue risks",
            value=float(overdue_risks),
            help_text="Open risks whose due date has passed.",
        ),
        KpiValue(
            key="expected_gross_exposure",
            label="Expected gross exposure",
            value=float(expected_gross),
            currency=dominant_currency,
            is_estimate=True,
            help_text="Sum of probability x net loss across scenarios in the reporting currency.",
        ),
        KpiValue(
            key="expected_residual_exposure",
            label="Expected residual exposure",
            value=float(expected_residual),
            currency=dominant_currency,
            is_estimate=True,
            help_text="Uses each scenario's post-mitigation probability where one is recorded.",
        ),
        KpiValue(
            key="potential_avoided_loss",
            label="Potential avoided loss",
            value=float(expected_gross - expected_residual),
            currency=dominant_currency,
            is_estimate=True,
        ),
        KpiValue(
            key="expected_loss_reduction_pct",
            label="Modelled exposure reduction",
            value=reduction_pct or 0.0,
            unit="%",
            is_estimate=True,
        ),
        KpiValue(key="open_findings", label="Open vulnerability findings", value=float(len(open_findings))),
        KpiValue(key="critical_findings", label="Critical priority findings", value=float(len(critical_findings))),
        KpiValue(key="assets_total", label="Tracked assets", value=float(len(assets))),
        KpiValue(
            key="assets_internet_exposed",
            label="Internet-exposed assets",
            value=float(sum(1 for asset in assets if asset.internet_exposed)),
        ),
        KpiValue(key="mitigations_open", label="Open mitigations", value=float(len(open_mitigations))),
        KpiValue(key="mitigations_overdue", label="Overdue mitigations", value=float(len(overdue_mitigations))),
        KpiValue(
            key="risks_created_30d",
            label="Risks created (30 days)",
            value=float(recent_count),
            trend=momentum,
            help_text="Percentage change against the previous 30 days.",
        ),
    ]

    # --- top risks --------------------------------------------------------
    assets_by_id = {asset.id: asset for asset in assets}
    owner_ids = {risk.owner_id for risk in risks if risk.owner_id}
    owners = (
        {user.id: user for user in db.execute(select(User).where(User.id.in_(owner_ids))).scalars()}
        if owner_ids
        else {}
    )
    top_risks_raw = sorted(risks, key=lambda item: (item.inherent_score, item.id), reverse=True)[:TOP_RISK_LIMIT]
    exposure_by_risk: dict[int, tuple[Decimal, Decimal]] = defaultdict(lambda: (Decimal("0.00"), Decimal("0.00")))
    for scenario, expected, residual in per_scenario:
        if scenario.risk_id is None or (scenario.currency or "USD") != dominant_currency:
            continue
        gross, resid = exposure_by_risk[scenario.risk_id]
        exposure_by_risk[scenario.risk_id] = (gross + expected, resid + residual)

    top_risks = [
        risk_out(
            risk,
            asset_name=(assets_by_id.get(risk.asset_id).name if risk.asset_id in assets_by_id else None),
            owner_name=(owners.get(risk.owner_id).full_name if risk.owner_id in owners else None),
            expected_gross_exposure=exposure_by_risk[risk.id][0] if risk.id in exposure_by_risk else None,
            expected_residual_exposure=exposure_by_risk[risk.id][1] if risk.id in exposure_by_risk else None,
            currency=dominant_currency if risk.id in exposure_by_risk else None,
        )
        for risk in top_risks_raw
    ]

    # --- upcoming mitigations --------------------------------------------
    upcoming = sorted(
        (item for item in open_mitigations if item.due_date is not None),
        key=lambda row: row.due_date,
    )[:UPCOMING_MITIGATION_LIMIT]
    upcoming_risk_ids = {item.risk_id for item in upcoming}
    upcoming_risks = {
        risk.id: risk
        for risk in db.execute(select(Risk).where(Risk.id.in_(upcoming_risk_ids))).scalars()
    }

    # --- activity ---------------------------------------------------------
    activity_rows = (
        db.execute(
            select(AuditLog)
            .where(AuditLog.organization_id == organization_id)
            .order_by(AuditLog.created_at.desc())
            .limit(RECENT_ACTIVITY_LIMIT)
        )
        .scalars()
        .all()
    )

    # --- data state -------------------------------------------------------
    rows_total = len(risks) + len(assets) + len(scenarios) + len(findings) + len(mitigations)
    non_demo = sum(
        1
        for row in [*risks, *assets, *scenarios, *findings, *mitigations]
        if not getattr(row, "is_demo", False)
    )
    if rows_total == 0:
        data_state = "empty"
    elif non_demo == 0:
        data_state = "demo_only"
    else:
        data_state = "populated"

    notes = [
        "Financial figures are modelled estimates over the stated scenario horizon; "
        "they are decision support, not a prediction of future losses.",
    ]
    if len(currency_totals) > 1:
        others = ", ".join(sorted(code for code in currency_totals if code != dominant_currency))
        notes.append(
            f"Scenarios exist in more than one currency. Totals show only {dominant_currency}; "
            f"amounts in {others} are excluded rather than converted."
        )
    if data_state == "demo_only":
        notes.append(
            "All records currently in this organization were created by the demonstration seeder "
            "and are labelled as such."
        )
    elif data_state == "empty":
        notes.append("No risk, asset, scenario, finding or mitigation records exist yet.")

    return DashboardOut(
        organization=OrganizationOut.model_validate(tenant.organization).model_copy(
            update={"role": tenant.role}
        ),
        generated_at=utcnow(),
        filters=filters,
        kpis=kpis,
        risks_created_vs_resolved=NamedSeries(name="Risks created vs resolved", points=trend_points),
        risks_by_category=[
            SeriesPoint(label=category, value=float(count)) for category, count in sorted(category_counts.items())
        ],
        risks_by_severity=[
            SeriesPoint(label=severity, value=float(severity_counts.get(severity, 0)))
            for severity in ("critical", "high", "medium", "low")
        ],
        exposure_by_business_unit=[
            SeriesPoint(label=unit, value=float(amount))
            for unit, amount in sorted(business_unit_exposure.items(), key=lambda item: item[1], reverse=True)
        ],
        assets_by_criticality=[
            SeriesPoint(
                label=f"{level}/5",
                value=float(sum(1 for asset in assets if asset.criticality == level)),
            )
            for level in range(1, 6)
        ],
        top_risks=top_risks,
        recent_activity=[
            {
                "id": row.id,
                "action": row.action,
                "entity_type": row.entity_type,
                "entity_id": row.entity_id,
                "user_email": row.user_email,
                "at": row.created_at,
            }
            for row in activity_rows
        ],
        upcoming_mitigations=[
            mitigation_out(item, risk=upcoming_risks.get(item.risk_id)) for item in upcoming
        ],
        data_state=data_state,
        notes=notes,
    )
