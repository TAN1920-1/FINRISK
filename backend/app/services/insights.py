"""Deterministic insights for the AI Insights page.

Everything on that page is computed here from persisted rows: counts, totals and
rankings.  No language model is involved in producing a figure, so an insight can
always be reproduced by hand from the database.  Insights are labelled
``basis="deterministic"`` to make that explicit, and the page itself states that
a human reviewer owns every conclusion.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import domain
from ..models import Asset, FinancialScenario, Mitigation, Risk, VulnerabilityFinding
from ..schemas import Insight
from .scenarios import scenario_breakdown

#: How many exemplars each insight lists before deferring to the register.
ITEM_LIMIT = 5

STALE_RISK_DAYS = 365
KEY_FINDING_STATUSES = domain.OPEN_REMEDIATION_STATUSES


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _days_since(value: Optional[datetime], reference: datetime) -> Optional[int]:
    moment = _aware(value)
    if moment is None:
        return None
    return max(0, (reference - moment).days)


def _severity_of(score: int) -> str:
    return domain.severity_from_score(score)


def _worst(severities: list[str]) -> str:
    if not severities:
        return domain.Severity.MEDIUM.value
    return max(severities, key=lambda item: domain.SEVERITY_ORDER.get(item, 0))


def _risk_item(risk: Risk, **extra: Any) -> dict[str, Any]:
    item = {
        "risk_id": risk.id,
        "risk_ref": risk.risk_ref,
        "title": risk.title,
        "category": risk.category,
        "severity": risk.severity,
        "score": risk.inherent_score,
    }
    item.update(extra)
    return item


def build_insights(
    db: Session,
    organization_id: int,
    *,
    currency: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    reference_time: Optional[datetime] = None,
) -> list[Insight]:
    """Compute the deterministic insight set for one organization."""
    reference = reference_time or datetime.now(timezone.utc)

    risk_stmt = select(Risk).where(Risk.organization_id == organization_id)
    if start_date:
        risk_stmt = risk_stmt.where(Risk.created_at >= datetime.combine(start_date, time.min))
    if end_date:
        risk_stmt = risk_stmt.where(Risk.created_at <= datetime.combine(end_date, time.max))
    risks = list(db.execute(risk_stmt).scalars().all())
    open_risks = [risk for risk in risks if risk.status in domain.OPEN_RISK_STATUSES]

    insights: list[Insight] = []
    insights.append(_severity_mix(open_risks))
    insights.append(_exposure_concentration(db, open_risks, currency=currency))
    insights.append(_overdue_high_risks(open_risks, reference=reference))
    insights.append(_exposed_assets(db, organization_id))
    insights.append(_weak_evidence(open_risks))
    insights.append(_stale_risks(open_risks, reference=reference))
    insights.append(_unresolved_key_findings(db, organization_id))
    insights.append(_mitigation_load(db, organization_id, reference=reference))

    return [insight for insight in insights if insight is not None]


# ---------------------------------------------------------------------------
# Individual insights
# ---------------------------------------------------------------------------


def _severity_mix(open_risks: list[Risk]) -> Insight:
    counts: dict[str, int] = defaultdict(int)
    for risk in open_risks:
        counts[risk.severity] += 1

    ordered = [
        {"severity": severity, "count": counts.get(severity, 0)}
        for severity in (
            domain.Severity.CRITICAL.value,
            domain.Severity.HIGH.value,
            domain.Severity.MEDIUM.value,
            domain.Severity.LOW.value,
        )
    ]
    worst = _worst(
        [severity for severity, count in counts.items() if count] or []
    )
    critical = counts.get(domain.Severity.CRITICAL.value, 0)
    high = counts.get(domain.Severity.HIGH.value, 0)

    if not open_risks:
        summary = "No open risks are recorded, so there is no severity mix to report."
        severity = domain.Severity.LOW.value
    else:
        summary = (
            f"{len(open_risks)} open risk(s): {critical} critical and {high} high. "
            "Severity is the documented 5x5 likelihood x impact band."
        )
        severity = worst

    return Insight(
        key="severity_mix",
        title="Open risk severity mix",
        summary=summary,
        severity=severity,
        metric=f"{len(open_risks)} open",
        items=ordered,
    )


def _exposure_concentration(
    db: Session,
    open_risks: list[Risk],
    *,
    currency: Optional[str],
) -> Insight:
    if not open_risks:
        return Insight(
            key="exposure_concentration",
            title="Modelled exposure concentration",
            summary="No open risks are recorded, so there is no modelled exposure to concentrate.",
            severity=domain.Severity.LOW.value,
            metric=None,
            items=[],
        )

    risk_ids = [risk.id for risk in open_risks]
    scenarios = list(
        db.execute(select(FinancialScenario).where(FinancialScenario.risk_id.in_(risk_ids))).scalars().all()
    )

    by_unit: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    excluded_currencies: set[str] = set()
    scenario_count = 0
    risk_by_id = {risk.id: risk for risk in open_risks}

    for scenario in scenarios:
        scenario_currency = scenario.currency or "USD"
        if currency and scenario_currency != currency:
            excluded_currencies.add(scenario_currency)
            continue
        risk = risk_by_id.get(scenario.risk_id)
        if risk is None:
            continue
        unit = (risk.business_unit or "Unassigned").strip() or "Unassigned"
        by_unit[unit] += scenario_breakdown(scenario).expected_loss
        scenario_count += 1

    total = sum(by_unit.values(), Decimal("0.00"))
    ranked = sorted(by_unit.items(), key=lambda item: item[1], reverse=True)
    items = [
        {
            "business_unit": unit,
            "expected_loss": float(amount),
            "share": round(float(amount / total), 4) if total > 0 else 0.0,
        }
        for unit, amount in ranked[:ITEM_LIMIT]
    ]

    if total <= 0:
        summary = (
            "No financial scenario has been recorded against the open risks yet, so no exposure "
            "concentration can be calculated. Add expected-loss assumptions to the relevant risks."
        )
        severity = domain.Severity.LOW.value
    else:
        top_unit, top_amount = ranked[0]
        share = float(top_amount / total) if total > 0 else 0.0
        summary = (
            f"Modelled expected loss across {scenario_count} scenario(s) is "
            f"{total:,.2f} {currency or ''}".rstrip()
            + f"; {top_unit} carries {share:.0%} of it."
        )
        severity = (
            domain.Severity.HIGH.value
            if share >= 0.6
            else (domain.Severity.MEDIUM.value if share >= 0.4 else domain.Severity.LOW.value)
        )
    if excluded_currencies:
        summary += (
            " Scenarios in "
            + ", ".join(sorted(excluded_currencies))
            + " were excluded because they are not in the reporting currency; convert them explicitly "
            "before comparing."
        )

    return Insight(
        key="exposure_concentration",
        title="Modelled exposure concentration",
        summary=summary,
        severity=severity,
        metric=f"{total:,.2f}" if total > 0 else None,
        items=items,
    )


def _overdue_high_risks(open_risks: list[Risk], *, reference: datetime) -> Insight:
    today = reference.date()
    overdue = [
        risk
        for risk in open_risks
        if risk.due_date is not None
        and risk.due_date < today
        and risk.severity in (domain.Severity.CRITICAL.value, domain.Severity.HIGH.value)
    ]
    overdue.sort(key=lambda risk: (risk.due_date or today))

    items = [
        _risk_item(
            risk,
            due_date=risk.due_date.isoformat() if risk.due_date else None,
            days_overdue=(today - risk.due_date).days if risk.due_date else None,
            owner_id=risk.owner_id,
        )
        for risk in overdue[:ITEM_LIMIT]
    ]

    return Insight(
        key="overdue_high_risks",
        title="Overdue critical and high risks",
        summary=(
            f"{len(overdue)} critical or high risk(s) are past their due date."
            if overdue
            else "No critical or high risk is past its due date."
        ),
        severity=domain.Severity.HIGH.value if overdue else domain.Severity.LOW.value,
        metric=f"{len(overdue)} overdue",
        items=items,
    )


def _exposed_assets(db: Session, organization_id: int) -> Insight:
    assets = list(
        db.execute(
            select(Asset).where(Asset.organization_id == organization_id, Asset.internet_exposed.is_(True))
        ).scalars().all()
    )
    if not assets:
        return Insight(
            key="exposed_assets",
            title="Internet-facing assets with open findings",
            summary="No asset is recorded as internet facing.",
            severity=domain.Severity.LOW.value,
            metric="0",
            items=[],
        )

    rows = db.execute(
        select(VulnerabilityFinding.asset_id, func.count(VulnerabilityFinding.id))
        .where(
            VulnerabilityFinding.asset_id.in_([asset.id for asset in assets]),
            VulnerabilityFinding.remediation_status.in_(KEY_FINDING_STATUSES),
        )
        .group_by(VulnerabilityFinding.asset_id)
    ).all()
    counts = {int(row[0]): int(row[1]) for row in rows if row[0] is not None}

    affected = sorted(
        ((asset, counts.get(asset.id, 0)) for asset in assets if counts.get(asset.id, 0) > 0),
        key=lambda item: (item[1], item[0].criticality),
        reverse=True,
    )

    items = [
        {
            "asset_id": asset.id,
            "asset_ref": asset.asset_ref,
            "name": asset.name,
            "criticality": asset.criticality,
            "open_findings": count,
        }
        for asset, count in affected[:ITEM_LIMIT]
    ]
    worst_criticality = max((asset.criticality for asset, _ in affected), default=0)

    return Insight(
        key="exposed_assets",
        title="Internet-facing assets with open findings",
        summary=(
            f"{len(affected)} internet-facing asset(s) carry unremediated findings; "
            f"the highest criticality among them is {worst_criticality}/5."
            if affected
            else "No internet-facing asset currently carries an unremediated finding."
        ),
        severity=(
            domain.Severity.HIGH.value
            if affected and worst_criticality >= 4
            else (domain.Severity.MEDIUM.value if affected else domain.Severity.LOW.value)
        ),
        metric=f"{len(affected)} asset(s)",
        items=items,
    )


def _weak_evidence(open_risks: list[Risk]) -> Insight:
    weak_qualities = {domain.EvidenceQuality.NONE.value, domain.EvidenceQuality.LOW.value}
    weak = [
        risk
        for risk in open_risks
        if risk.severity in (domain.Severity.CRITICAL.value, domain.Severity.HIGH.value)
        and risk.evidence_quality in weak_qualities
    ]
    weak.sort(key=lambda risk: risk.inherent_score, reverse=True)

    return Insight(
        key="weak_evidence",
        title="High-severity risks with weak evidence",
        summary=(
            f"{len(weak)} critical or high risk(s) rest on no evidence or low-quality evidence. "
            "Their confidence-adjusted priority is discounted until the evidence improves."
            if weak
            else "No critical or high risk is supported by low-quality evidence."
        ),
        severity=domain.Severity.MEDIUM.value if weak else domain.Severity.LOW.value,
        metric=f"{len(weak)} risk(s)",
        items=[
            _risk_item(risk, evidence_quality=risk.evidence_quality)
            for risk in weak[:ITEM_LIMIT]
        ],
    )


def _stale_risks(open_risks: list[Risk], *, reference: datetime) -> Insight:
    stale: list[tuple[Risk, int]] = []
    for risk in open_risks:
        age = _days_since(risk.created_at, reference)
        if age is not None and age > STALE_RISK_DAYS:
            stale.append((risk, age))
    stale.sort(key=lambda item: item[1], reverse=True)

    return Insight(
        key="stale_risks",
        title="Open risks older than one review cycle",
        summary=(
            f"{len(stale)} open risk(s) have been open for more than {STALE_RISK_DAYS} days and need "
            "an explicit review or a documented acceptance."
            if stale
            else f"No open risk is older than {STALE_RISK_DAYS} days."
        ),
        severity=domain.Severity.MEDIUM.value if stale else domain.Severity.LOW.value,
        metric=f"{len(stale)} risk(s)",
        items=[_risk_item(risk, days_open=age) for risk, age in stale[:ITEM_LIMIT]],
    )


def _unresolved_key_findings(db: Session, organization_id: int) -> Insight:
    """Findings that upstream intelligence flags as exploited but are still open."""
    findings = list(
        db.execute(
            select(VulnerabilityFinding).where(
                VulnerabilityFinding.organization_id == organization_id,
                VulnerabilityFinding.remediation_status.in_(KEY_FINDING_STATUSES),
            )
        ).scalars().all()
    )
    flagged = [
        finding
        for finding in findings
        if finding.exploit_evidence
        or (finding.priority_band in (domain.Severity.CRITICAL.value, domain.Severity.HIGH.value))
    ]
    flagged.sort(key=lambda item: (item.priority_score or 0.0), reverse=True)

    return Insight(
        key="unresolved_key_findings",
        title="Unresolved priority findings",
        summary=(
            f"{len(flagged)} open finding(s) are rated critical/high by the context-aware priority "
            "score or carry exploitation evidence."
            if flagged
            else "No open finding carries exploitation evidence or a critical/high priority."
        ),
        severity=(
            domain.Severity.CRITICAL.value
            if any(item.priority_band == domain.Severity.CRITICAL.value for item in flagged)
            else (domain.Severity.HIGH.value if flagged else domain.Severity.LOW.value)
        ),
        metric=f"{len(flagged)} finding(s)",
        items=[
            {
                "finding_id": finding.id,
                "cve_id": finding.cve_id,
                "title": finding.title,
                "asset_id": finding.asset_id,
                "priority_score": finding.priority_score,
                "priority_band": finding.priority_band,
                "exploit_evidence": finding.exploit_evidence,
            }
            for finding in flagged[:ITEM_LIMIT]
        ],
    )


def _mitigation_load(db: Session, organization_id: int, *, reference: datetime) -> Insight:
    rows = db.execute(
        select(Mitigation).where(
            Mitigation.organization_id == organization_id,
            Mitigation.status.in_(
                (
                    domain.MitigationStatus.PLANNED.value,
                    domain.MitigationStatus.IN_PROGRESS.value,
                    domain.MitigationStatus.BLOCKED.value,
                )
            ),
        )
    ).scalars().all()

    today = reference.date()
    overdue = [row for row in rows if row.due_date is not None and row.due_date < today]
    blocked = [row for row in rows if row.status == domain.MitigationStatus.BLOCKED.value]
    overdue.sort(key=lambda row: row.due_date or today)

    return Insight(
        key="mitigation_load",
        title="Remediation workload",
        summary=(
            f"{len(rows)} remediation action(s) are in flight, {len(overdue)} past due and "
            f"{len(blocked)} blocked. Completing an action does not by itself reduce a risk's "
            "residual score; the post-mitigation likelihood and impact must be recorded."
        ),
        severity=(
            domain.Severity.HIGH.value
            if overdue or blocked
            else (domain.Severity.MEDIUM.value if rows else domain.Severity.LOW.value)
        ),
        metric=f"{len(rows)} open",
        items=[
            {
                "mitigation_id": row.id,
                "action_ref": row.action_ref,
                "risk_id": row.risk_id,
                "status": row.status,
                "priority": row.priority,
                "due_date": row.due_date.isoformat() if row.due_date else None,
                "overdue": bool(row.due_date and row.due_date < today),
            }
            for row in overdue[:ITEM_LIMIT]
        ],
    )
