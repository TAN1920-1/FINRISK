"""Report generation from persisted records.

Every report in this module is assembled from rows that already exist in the
database for the caller's organization.  Nothing is invented: where an input is
missing the report says so instead of substituting a plausible-looking number,
and every monetary figure carries its ISO-4217 currency code.

Two renderers are provided:

* **CSV** - the raw table, so the figures can be re-checked in a spreadsheet.
* **PDF** - a properly laid-out document (built with reportlab), not a screenshot
  of the dashboard.  It carries the organization, the reporting period, the
  generation timestamp and author, the methodology, the table and the
  limitations of the data behind it.

The financial columns come from the same engine the Scenario Simulator uses
(:mod:`app.scoring.financial` via :mod:`app.services.scenarios`), so a report
can never disagree with the screen it was exported from.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Callable, Optional
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import domain
from ..models import (
    Asset,
    FinancialScenario,
    Mitigation,
    ModelVersion,
    Risk,
    User,
    VulnerabilityFinding,
    utcnow,
)
from .exports import csv_bytes
from .insights import build_insights
from .scenarios import scenario_breakdown

#: Hard cap on rows drawn into a PDF table.  The CSV carries everything; a PDF is
#: a document, and a 5,000-row table is neither readable nor useful.
MAX_PDF_ROWS = 400

#: Repeated on every report so a reader cannot mistake an estimate for a fact.
ESTIMATE_NOTICE = (
    "Financial figures are scenario-based estimates produced by the documented loss model, "
    "not predictions of future losses. Amounts in different currencies are never summed."
)

#: Stated wherever a model output appears in a report.
MODEL_NOTICE = (
    "Model scores are decision support, not verdicts. Reported class probabilities are not "
    "calibrated real-world probabilities, and feature attributions describe model behaviour "
    "rather than causation."
)


@dataclass(frozen=True)
class ReportFilters:
    """The subset of register filters a report honours."""

    start_date: Optional[date] = None
    end_date: Optional[date] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    business_unit: Optional[str] = None

    @property
    def is_empty(self) -> bool:
        return not any(
            (self.start_date, self.end_date, self.category, self.severity, self.business_unit)
        )

    def describe(self) -> str:
        parts: list[str] = []
        if self.start_date or self.end_date:
            parts.append(
                f"{self.start_date.isoformat() if self.start_date else 'start'}"
                f" to {self.end_date.isoformat() if self.end_date else 'today'}"
            )
        if self.category:
            parts.append(f"category={self.category}")
        if self.severity:
            parts.append(f"severity={self.severity}")
        if self.business_unit:
            parts.append(f"business unit={self.business_unit}")
        return "; ".join(parts) if parts else "none"


@dataclass
class ReportDataset:
    """A rendered-agnostic report: title, table, figures and caveats."""

    report_type: str
    title: str
    columns: list[str]
    rows: list[list[Any]]
    summary: list[tuple[str, str]] = field(default_factory=list)
    methodology: str = ""
    limitations: str = ""

    @property
    def row_count(self) -> int:
        return len(self.rows)


@dataclass(frozen=True)
class ReportContext:
    """Everything the PDF needs that is not part of the data table."""

    organization_name: str
    currency: str
    generated_at: datetime
    generated_by: str
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    filters: Optional[ReportFilters] = None


@dataclass(frozen=True)
class ReportType:
    key: str
    title: str
    description: str
    builder: Callable[[Session, int, ReportFilters, Optional[str]], ReportDataset]


# ---------------------------------------------------------------------------
# Small formatting helpers
# ---------------------------------------------------------------------------


def _money(value: Optional[Decimal | float | int], currency: Optional[str]) -> str:
    """Format an amount with its explicit currency code (never a bare number)."""
    if value is None:
        return "not estimated"
    amount = Decimal(str(value)).quantize(Decimal("0.01"))
    return f"{amount:,.2f} {currency or ''}".strip()


def _number(value: Optional[float | int], digits: int = 2) -> str:
    if value is None:
        return "not estimated"
    return f"{float(value):.{digits}f}"


def _percent(value: Optional[float]) -> str:
    if value is None:
        return "not recorded"
    return f"{float(value) * 100:.1f}%"


def _text(value: Optional[str]) -> str:
    return value if value else ""


def _date(value: Optional[date | datetime]) -> str:
    return value.isoformat()[:10] if value else ""


# ---------------------------------------------------------------------------
# Shared queries
# ---------------------------------------------------------------------------


def _filtered_risks(db: Session, organization_id: int, filters: ReportFilters) -> list[Risk]:
    stmt = select(Risk).where(Risk.organization_id == organization_id)
    if filters.start_date:
        stmt = stmt.where(Risk.created_at >= datetime.combine(filters.start_date, datetime.min.time()))
    if filters.end_date:
        stmt = stmt.where(Risk.created_at <= datetime.combine(filters.end_date, datetime.max.time()))
    if filters.category:
        stmt = stmt.where(Risk.category == filters.category)
    if filters.business_unit:
        stmt = stmt.where(Risk.business_unit == filters.business_unit)
    if filters.severity:
        low, high = domain.SEVERITY_SCORE_RANGES[filters.severity]
        stmt = stmt.where(Risk.likelihood * Risk.impact >= low, Risk.likelihood * Risk.impact <= high)
    return list(db.execute(stmt.order_by(Risk.risk_ref)).scalars().all())


def _scenarios_for(
    db: Session, organization_id: int, risk_ids: Optional[list[int]] = None
) -> list[FinancialScenario]:
    """Scenarios for one organization, optionally restricted to a risk set.

    ``risk_ids=None`` means "do not restrict"; an empty list means "no risk
    matched the filters", which must yield no scenarios rather than all of them.
    """
    if risk_ids is not None and not risk_ids:
        return []
    stmt = select(FinancialScenario).where(FinancialScenario.organization_id == organization_id)
    if risk_ids is not None:
        stmt = stmt.where(FinancialScenario.risk_id.in_(risk_ids))
    return list(db.execute(stmt.order_by(FinancialScenario.name)).scalars().all())


def _name_lookups(db: Session, organization_id: int) -> tuple[dict[int, str], dict[int, str]]:
    """Return ``(asset_names, user_names)`` for one organization in two queries."""
    assets = db.execute(
        select(Asset.id, Asset.name).where(Asset.organization_id == organization_id)
    ).all()
    users = db.execute(select(User.id, User.full_name)).all()
    return (
        {int(row[0]): row[1] for row in assets},
        {int(row[0]): row[1] for row in users},
    )


def _aggregate_exposure(scenarios) -> dict[str, Decimal]:
    """Expected-loss totals per currency.

    Currencies are kept apart because summing them would invent an exchange rate.
    """
    totals: dict[str, Decimal] = {}
    for scenario in scenarios:
        breakdown = scenario_breakdown(scenario)
        code = breakdown.currency or scenario.currency or "USD"
        totals[code] = totals.get(code, Decimal("0.00")) + breakdown.expected_loss
    return totals


def _severity_mix(risks: list[Risk]) -> dict[str, int]:
    mix = {severity.value: 0 for severity in domain.Severity}
    for risk in risks:
        mix[risk.severity] = mix.get(risk.severity, 0) + 1
    return mix


# ---------------------------------------------------------------------------
# Report builders
# ---------------------------------------------------------------------------


def _executive_summary(
    db: Session, organization_id: int, filters: ReportFilters, currency: Optional[str]
) -> ReportDataset:
    risks = _filtered_risks(db, organization_id, filters)
    open_risks = [risk for risk in risks if risk.status in domain.OPEN_RISK_STATUSES]
    mix = _severity_mix(open_risks)

    scenarios = _scenarios_for(db, organization_id, [risk.id for risk in risks] or None)
    totals = _aggregate_exposure(scenarios)

    findings = list(
        db.execute(
            select(VulnerabilityFinding).where(VulnerabilityFinding.organization_id == organization_id)
        ).scalars().all()
    )
    open_findings = [
        item for item in findings if item.remediation_status in domain.OPEN_REMEDIATION_STATUSES
    ]
    key_findings = [
        item for item in open_findings if item.priority_band in (domain.Severity.CRITICAL.value, domain.Severity.HIGH.value)
    ]

    mitigations = list(
        db.execute(select(Mitigation).where(Mitigation.organization_id == organization_id)).scalars().all()
    )
    completed = [item for item in mitigations if item.status == domain.MitigationStatus.COMPLETED.value]
    today = utcnow().date()
    overdue = [
        item
        for item in mitigations
        if item.due_date is not None
        and item.due_date < today
        and item.status not in (domain.MitigationStatus.COMPLETED.value, domain.MitigationStatus.CANCELLED.value)
    ]

    insights = build_insights(db, organization_id, currency=currency, reference_time=utcnow())

    rows: list[list[Any]] = [
        ["Risks in scope", len(risks), "Rows matching the report filters."],
        ["Open risks", len(open_risks), "Status is not closed, accepted or resolved."],
        ["Critical risks", mix.get(domain.Severity.CRITICAL.value, 0), "Inherent score 20-25."],
        ["High risks", mix.get(domain.Severity.HIGH.value, 0), "Inherent score 12-19."],
        ["Medium risks", mix.get(domain.Severity.MEDIUM.value, 0), "Inherent score 5-11."],
        ["Low risks", mix.get(domain.Severity.LOW.value, 0), "Inherent score 1-4."],
        [
            "Risks with a mitigation plan",
            sum(1 for risk in open_risks if risk.mitigation_plan),
            "Free-text plan recorded on the risk.",
        ],
        ["Financial scenarios", len(scenarios), "Scenario assumptions recorded against these risks."],
        ["Open findings", len(open_findings), "Vulnerability findings not yet remediated."],
        ["Critical/high priority findings", len(key_findings), "By the context-aware priority score."],
        ["Remediation actions", len(mitigations), "Mitigation records in this organization."],
        ["Remediation completed", len(completed), "Status completed."],
        ["Remediation overdue", len(overdue), "Past due date and not completed or cancelled."],
    ]
    for code in sorted(totals):
        rows.append(
            [
                f"Expected loss ({code})",
                _money(totals[code], code),
                "Sum of probability x net loss across the matching scenarios in this currency.",
            ]
        )

    failures = [insight for insight in insights if insight.severity in (domain.Severity.CRITICAL.value, domain.Severity.HIGH.value)]
    for insight in failures:
        rows.append([f"Attention: {insight.title}", insight.metric or "-", insight.summary])

    return ReportDataset(
        report_type="executive_summary",
        title="Executive summary",
        columns=["Measure", "Value", "Notes"],
        rows=rows,
        summary=[
            ("Risks in scope", str(len(risks))),
            ("Open risks", str(len(open_risks))),
            ("Critical / high open risks", f"{mix.get(domain.Severity.CRITICAL.value, 0)} / {mix.get(domain.Severity.HIGH.value, 0)}"),
            ("Open findings", str(len(open_findings))),
            ("Remediation overdue", str(len(overdue))),
            (
                "Modelled expected loss",
                "; ".join(f"{_money(totals[code], code)}" for code in sorted(totals)) or "not estimated",
            ),
        ],
        methodology=(
            "Counts are taken directly from the risk register, finding log and mitigation records for "
            "the reporting organization. Severity is the documented 5x5 likelihood x impact band "
            "(critical 20-25, high 12-19, medium 5-11, low 1-4). Expected loss is "
            "probability x net scenario loss, computed by the shared loss engine. "
            "The attention lines are the deterministic insights the AI Insights page shows, reproduced "
            "here so the summary cannot present a rosier picture than the underlying page."
        ),
        limitations=(
            ESTIMATE_NOTICE
            + " Counts reflect the records that exist; a risk that has not been entered is not counted. "
            "No causal or predictive claim is made about any measure on this page."
        ),
    )


def _risk_register(
    db: Session, organization_id: int, filters: ReportFilters, currency: Optional[str]
) -> ReportDataset:
    risks = _filtered_risks(db, organization_id, filters)
    assets, users = _name_lookups(db, organization_id)

    mitigation_counts: dict[int, tuple[int, int]] = {}
    for mitigation in db.execute(
        select(Mitigation).where(Mitigation.organization_id == organization_id)
    ).scalars().all():
        total, done = mitigation_counts.get(mitigation.risk_id, (0, 0))
        mitigation_counts[mitigation.risk_id] = (
            total + 1,
            done + (1 if mitigation.status == domain.MitigationStatus.COMPLETED.value else 0),
        )

    rows = [
        [
            risk.risk_ref,
            risk.title,
            risk.category,
            risk.status,
            risk.likelihood,
            risk.impact,
            risk.inherent_score,
            risk.severity,
            risk.residual_score if risk.residual_score is not None else "not assessed",
            domain.severity_from_score(risk.residual_score) if risk.residual_score is not None else "not assessed",
            risk.evidence_quality,
            assets.get(risk.asset_id or -1, ""),
            users.get(risk.owner_id or -1, ""),
            _text(risk.business_unit),
            _date(risk.due_date),
            f"{mitigation_counts.get(risk.id, (0, 0))[1]}/{mitigation_counts.get(risk.id, (0, 0))[0]}",
        ]
        for risk in risks
    ]

    mix = _severity_mix(risks)
    return ReportDataset(
        report_type="risk_register",
        title="Risk register",
        columns=[
            "Reference",
            "Title",
            "Category",
            "Status",
            "Likelihood",
            "Impact",
            "Inherent score",
            "Inherent severity",
            "Residual score",
            "Residual severity",
            "Evidence quality",
            "Asset",
            "Owner",
            "Business unit",
            "Due date",
            "Mitigations completed",
        ],
        rows=rows,
        summary=[
            ("Risks listed", str(len(risks))),
            *[(f"{severity.capitalize()} (inherent)", str(mix.get(severity, 0))) for severity in mix],
            ("Residual not assessed", str(sum(1 for risk in risks if risk.residual_score is None))),
        ],
        methodology=(
            "One row per risk register entry in the reporting organization, after filters. Inherent "
            "score = likelihood x impact (1-25) and its severity band follows the documented matrix. "
            "'Residual score' is only populated when both post-mitigation likelihood and impact have "
            "been recorded; it is never inferred from the presence of a mitigation action."
        ),
        limitations=(
            "Residual risk is blank rather than estimated wherever the analyst has not recorded "
            "post-mitigation values, because completing a mitigation action does not by itself reduce "
            "a risk. Scores are an analyst convention, not a measurement."
        ),
    )


def _financial_exposure(
    db: Session, organization_id: int, filters: ReportFilters, currency: Optional[str]
) -> ReportDataset:
    risks = _filtered_risks(db, organization_id, filters)
    risk_by_id = {risk.id: risk for risk in risks}
    scenarios = _scenarios_for(db, organization_id, [risk.id for risk in risks] or None)

    rows: list[list[Any]] = []
    totals: dict[str, dict[str, Decimal]] = {}
    excluded: set[str] = set()

    for scenario in scenarios:
        if scenario.risk_id is not None and scenario.risk_id not in risk_by_id:
            continue
        breakdown = scenario_breakdown(scenario)
        code = breakdown.currency or "USD"
        if currency and code != currency:
            excluded.add(code)
            continue

        bucket = totals.setdefault(
            code,
            {
                "gross": Decimal("0.00"),
                "net": Decimal("0.00"),
                "expected": Decimal("0.00"),
                "residual": Decimal("0.00"),
                "avoided": Decimal("0.00"),
            },
        )
        bucket["gross"] += breakdown.gross_loss
        bucket["net"] += breakdown.net_loss
        bucket["expected"] += breakdown.expected_loss
        bucket["residual"] += breakdown.expected_residual_loss
        bucket["avoided"] += breakdown.potential_avoided_loss

        parent = risk_by_id.get(scenario.risk_id)
        rows.append(
            [
                scenario.name,
                parent.risk_ref if parent else "",
                scenario.scenario_type,
                code,
                f"{breakdown.probability * 100:.1f}%",
                _percent(breakdown.residual_probability),
                _money(breakdown.gross_loss, code),
                _money(breakdown.total_recoveries, code),
                _money(breakdown.net_loss, code),
                _money(breakdown.expected_loss, code),
                _money(breakdown.expected_residual_loss, code),
                _money(breakdown.potential_avoided_loss, code),
                _percent(breakdown.return_on_mitigation) if breakdown.return_on_mitigation is not None else "not calculable",
                f"{breakdown.time_horizon_months} months",
            ]
        )

    summary: list[tuple[str, str]] = [
        ("Scenarios listed", str(len(rows))),
    ]
    for code in sorted(totals):
        bucket = totals[code]
        summary.extend(
            [
                (f"Gross loss ({code})", _money(bucket["gross"], code)),
                (f"Net of recoveries ({code})", _money(bucket["net"], code)),
                (f"Expected loss ({code})", _money(bucket["expected"], code)),
                (f"Expected residual ({code})", _money(bucket["residual"], code)),
                (f"Potentially avoided ({code})", _money(bucket["avoided"], code)),
            ]
        )
    if not totals:
        summary.append(("Expected loss", "no scenario in scope"))

    limitations = ESTIMATE_NOTICE
    if excluded:
        limitations += (
            " Scenarios denominated in "
            + ", ".join(sorted(excluded))
            + " were excluded from this report because they are not in the reporting currency; "
            "convert them explicitly before comparing, because no exchange rate is assumed."
        )
    limitations += (
        " Where the same loss appears in two components (for example revenue loss and "
        "business-interruption loss), the engine flags the overlap in its notes; the gross figure "
        "should be reviewed before it is quoted."
    )

    return ReportDataset(
        report_type="financial_exposure",
        title="Financial exposure",
        columns=[
            "Scenario",
            "Risk",
            "Type",
            "Currency",
            "Probability",
            "Residual probability",
            "Gross loss",
            "Recoveries",
            "Net loss",
            "Expected loss",
            "Expected residual loss",
            "Potentially avoided",
            "Return on mitigation",
            "Horizon",
        ],
        rows=rows,
        summary=summary,
        methodology=(
            "Gross loss = direct + business interruption + revenue + recovery + incident response + "
            "regulatory + other. Net loss = gross loss - recoveries, with recoveries capped at the "
            "gross loss. Expected loss = probability x net loss over the stated horizon. Expected "
            "residual loss uses the post-mitigation probability. Potentially avoided = expected loss - "
            "expected residual loss. Return on mitigation = (avoided - mitigation cost) / mitigation cost."
        ),
        limitations=limitations,
    )


def _vulnerability_assessment(
    db: Session, organization_id: int, filters: ReportFilters, currency: Optional[str]
) -> ReportDataset:
    stmt = select(VulnerabilityFinding).where(VulnerabilityFinding.organization_id == organization_id)
    if filters.start_date:
        stmt = stmt.where(
            VulnerabilityFinding.detected_at >= datetime.combine(filters.start_date, datetime.min.time())
        )
    if filters.end_date:
        stmt = stmt.where(
            VulnerabilityFinding.detected_at <= datetime.combine(filters.end_date, datetime.max.time())
        )
    findings = list(db.execute(stmt.order_by(VulnerabilityFinding.priority_score.desc())).scalars().all())
    assets, _ = _name_lookups(db, organization_id)

    rows = [
        [
            _text(finding.cve_id),
            finding.title,
            assets.get(finding.asset_id or -1, ""),
            _number(finding.cvss_score, 1),
            _text(finding.cvss_severity),
            _number(finding.priority_score, 1),
            _text(finding.priority_band),
            "yes" if finding.exploit_evidence else "no",
            "yes" if finding.internet_exposed else "no",
            finding.remediation_status,
            _date(finding.remediation_due_date),
            finding.vulnerability_age_days if finding.vulnerability_age_days is not None else "",
        ]
        for finding in findings
    ]

    open_findings = [
        finding for finding in findings if finding.remediation_status in domain.OPEN_REMEDIATION_STATUSES
    ]
    bands = {severity.value: 0 for severity in domain.Severity}
    for finding in open_findings:
        if finding.priority_band:
            bands[finding.priority_band] = bands.get(finding.priority_band, 0) + 1

    return ReportDataset(
        report_type="vulnerability_assessment",
        title="Vulnerability assessment",
        columns=[
            "CVE",
            "Title",
            "Asset",
            "CVSS",
            "CVSS severity",
            "Priority score",
            "Priority band",
            "Exploitation evidence",
            "Internet exposed",
            "Remediation status",
            "Remediation due",
            "Age (days)",
        ],
        rows=rows,
        summary=[
            ("Findings listed", str(len(findings))),
            ("Open findings", str(len(open_findings))),
            *[(f"Open priority {band}", str(bands.get(band, 0))) for band in bands],
        ],
        methodology=(
            "The CVSS columns are the values published by the upstream source (NVD) and are shown "
            "verbatim. The 'priority score' is this platform's own deterministic, context-aware score: "
            "it combines CVSS, exploitation evidence, exposure, asset criticality, data sensitivity and "
            "vulnerability age, and subtracts a penalty where compensating controls are recorded. It is "
            "NOT an official CVSS score and must not be reported as one. Findings are ordered by that "
            "score."
        ),
        limitations=(
            "Upstream enrichment (NVD, CISA KEV, EPSS) is best-effort: when a source is unreachable the "
            "finding keeps the values it already had and the missing factor is simply absent from the "
            "priority calculation, which is stated on the finding itself. Absence of exploitation "
            "evidence means no source reported it, not that exploitation has not occurred."
        ),
    )


def _asset_risk(
    db: Session, organization_id: int, filters: ReportFilters, currency: Optional[str]
) -> ReportDataset:
    stmt = select(Asset).where(Asset.organization_id == organization_id)
    if filters.business_unit:
        stmt = stmt.where(Asset.business_unit == filters.business_unit)
    assets = list(db.execute(stmt.order_by(Asset.asset_ref)).scalars().all())

    risks = _filtered_risks(db, organization_id, filters)
    risk_ids = {risk.id for risk in risks}
    open_risks_by_asset: dict[int, list[Risk]] = {}
    for risk in risks:
        if risk.asset_id is None or risk.status not in domain.OPEN_RISK_STATUSES:
            continue
        open_risks_by_asset.setdefault(risk.asset_id, []).append(risk)

    findings = list(
        db.execute(select(VulnerabilityFinding).where(VulnerabilityFinding.organization_id == organization_id))
        .scalars()
        .all()
    )
    open_findings_by_asset: dict[int, list[VulnerabilityFinding]] = {}
    for finding in findings:
        if finding.asset_id is None or finding.remediation_status not in domain.OPEN_REMEDIATION_STATUSES:
            continue
        open_findings_by_asset.setdefault(finding.asset_id, []).append(finding)

    scenarios = _scenarios_for(db, organization_id, sorted(risk_ids) or None)
    exposure_by_asset: dict[int, Decimal] = {}
    for scenario in scenarios:
        parent = next((risk for risk in risks if risk.id == scenario.risk_id), None)
        if parent is None or parent.asset_id is None:
            continue
        breakdown = scenario_breakdown(scenario)
        if currency and breakdown.currency != currency:
            continue
        exposure_by_asset[parent.asset_id] = (
            exposure_by_asset.get(parent.asset_id, Decimal("0.00")) + breakdown.expected_loss
        )

    rows: list[list[Any]] = []
    for asset in assets:
        asset_risks = open_risks_by_asset.get(asset.id, [])
        asset_findings = open_findings_by_asset.get(asset.id, [])
        worst = "none"
        if asset_risks:
            worst = max(
                (risk.severity for risk in asset_risks),
                key=lambda item: domain.SEVERITY_ORDER.get(item, 0),
            )
        rows.append(
            [
                asset.asset_ref,
                asset.name,
                asset.asset_type,
                asset.environment,
                _text(asset.business_unit),
                asset.criticality,
                asset.data_sensitivity,
                "yes" if asset.internet_exposed else "no",
                len(asset_risks),
                worst,
                len(asset_findings),
                _money(exposure_by_asset.get(asset.id), currency) if asset.id in exposure_by_asset else "not modelled",
            ]
        )

    return ReportDataset(
        report_type="asset_risk",
        title="Asset risk",
        columns=[
            "Reference",
            "Asset",
            "Type",
            "Environment",
            "Business unit",
            "Criticality",
            "Data sensitivity",
            "Internet exposed",
            "Open risks",
            "Worst inherent severity",
            "Open findings",
            "Modelled expected loss",
        ],
        rows=rows,
        summary=[
            ("Assets listed", str(len(assets))),
            ("Internet-facing assets", str(sum(1 for asset in assets if asset.internet_exposed))),
            ("Assets with open risks", str(len(open_risks_by_asset))),
            ("Assets with open findings", str(len(open_findings_by_asset))),
        ],
        methodology=(
            "One row per asset in the registry. 'Worst inherent severity' is the highest severity "
            "among that asset's open risks. 'Modelled expected loss' is the sum of expected loss from "
            "scenarios attached to risks on that asset, in the reporting currency only."
        ),
        limitations=(
            "Expected loss is shown as 'not modelled' where no scenario exists for the asset, rather "
            "than as zero, because a missing assumption is not the same as no exposure. "
            + ESTIMATE_NOTICE
        ),
    )


def _mitigation_progress(
    db: Session, organization_id: int, filters: ReportFilters, currency: Optional[str]
) -> ReportDataset:
    risks = _filtered_risks(db, organization_id, filters)
    risk_by_id = {risk.id: risk for risk in risks}
    mitigations = list(
        db.execute(select(Mitigation).where(Mitigation.organization_id == organization_id))
        .scalars()
        .all()
    )
    _, users = _name_lookups(db, organization_id)

    today = utcnow().date()
    rows: list[list[Any]] = []
    for mitigation in mitigations:
        parent = risk_by_id.get(mitigation.risk_id)
        if parent is None:
            continue
        overdue = (
            mitigation.due_date is not None
            and mitigation.due_date < today
            and mitigation.status
            not in (domain.MitigationStatus.COMPLETED.value, domain.MitigationStatus.CANCELLED.value)
        )
        rows.append(
            [
                mitigation.action_ref,
                parent.risk_ref,
                parent.title,
                mitigation.description,
                mitigation.status,
                mitigation.priority,
                users.get(mitigation.assigned_user_id or -1, ""),
                _date(mitigation.due_date),
                "yes" if overdue else "no",
                _date(mitigation.completed_at) if mitigation.completed_at else "",
                _money(mitigation.estimated_cost, mitigation.currency or currency) if mitigation.estimated_cost is not None else "not estimated",
                parent.residual_score if parent.residual_score is not None else "not assessed",
            ]
        )

    in_flight = [
        mitigation
        for mitigation in mitigations
        if mitigation.risk_id in risk_by_id
        and mitigation.status
        not in (domain.MitigationStatus.COMPLETED.value, domain.MitigationStatus.CANCELLED.value)
    ]
    completed = [
        mitigation
        for mitigation in mitigations
        if mitigation.risk_id in risk_by_id and mitigation.status == domain.MitigationStatus.COMPLETED.value
    ]
    blocked = [
        mitigation
        for mitigation in mitigations
        if mitigation.risk_id in risk_by_id and mitigation.status == domain.MitigationStatus.BLOCKED.value
    ]

    return ReportDataset(
        report_type="mitigation_progress",
        title="Mitigation progress",
        columns=[
            "Reference",
            "Risk",
            "Risk title",
            "Action",
            "Status",
            "Priority",
            "Owner",
            "Due date",
            "Overdue",
            "Completed",
            "Estimated cost",
            "Risk residual score",
        ],
        rows=rows,
        summary=[
            ("Actions listed", str(len(rows))),
            ("In flight", str(len(in_flight))),
            ("Completed", str(len(completed))),
            ("Blocked", str(len(blocked))),
            (
                "Risk residual not assessed",
                str(sum(1 for mitigation in mitigations if mitigation.risk_id in risk_by_id and risk_by_id[mitigation.risk_id].residual_score is None)),
            ),
        ],
        methodology=(
            "One row per mitigation action attached to a risk inside the report filters. 'Risk residual "
            "score' is the risk's own post-mitigation score, not a value derived from the action's "
            "status. Percentages are deliberately not used: an action count is not a measure of risk "
            "reduction."
        ),
        limitations=(
            "Completing a mitigation action does not by itself reduce a risk. A risk only shows a lower "
            "residual score when the analyst records the post-mitigation likelihood and impact, so "
            "counting completed actions as 'risk reduced' would overstate progress."
        ),
    )


def _model_evaluation(
    db: Session, organization_id: int, filters: ReportFilters, currency: Optional[str]
) -> ReportDataset:
    models = list(
        db.execute(select(ModelVersion).order_by(ModelVersion.trained_at.desc())).scalars().all()
    )
    active = next((model for model in models if model.is_active), None)

    if active is None:
        return ReportDataset(
            report_type="model_evaluation",
            title="AI / ML model evaluation",
            columns=["Field", "Value"],
            rows=[
                ["Active model", "none"],
                [
                    "Behaviour",
                    "Predictions fall back to the documented rule-based 5x5 matrix until a model is trained.",
                ],
            ],
            summary=[("Active model", "none")],
            methodology="No model version is recorded for this deployment.",
            limitations=MODEL_NOTICE,
        )

    metrics = active.metrics or {}
    per_class = metrics.get("per_class") or {}
    rows: list[list[Any]] = [
        ["Version", active.version],
        ["Algorithm", active.algorithm],
        ["Predicted target", active.target_label],
        ["Training data", active.dataset_kind],
        ["Training rows", active.dataset_rows],
        ["Split strategy", active.split_strategy or "not recorded"],
        ["Trained at", active.trained_at.isoformat() if active.trained_at else "not recorded"],
        ["Accuracy", _number(metrics.get("accuracy"), 4)],
        ["Macro F1", _number(metrics.get("macro_f1"), 4)],
        ["Weighted F1", _number(metrics.get("weighted_f1"), 4)],
        ["Selection basis", metrics.get("selection_basis", "not recorded")],
        ["Majority-class baseline macro F1", _number(metrics.get("baseline_macro_f1"), 4)],
    ]
    for label, value in per_class.items():
        rows.append(
            [
                f"Class '{label}'",
                f"precision {_number(value.get('precision'), 4)}, "
                f"recall {_number(value.get('recall'), 4)}, "
                f"f1 {_number(value.get('f1'), 4)}, support {value.get('support')}",
            ]
        )

    confusion = active.confusion_matrix or {}
    labels = confusion.get("labels") or []
    matrix = confusion.get("matrix") or []
    for index, actual in enumerate(labels):
        if index < len(matrix):
            rows.append([f"Confusion row (actual '{actual}')", str(matrix[index])])

    for candidate in metrics.get("candidates") or []:
        rows.append(
            [
                f"Candidate {candidate.get('algorithm')}",
                f"cv_macro_f1 {_number(candidate.get('cv_macro_f1'), 4)}, "
                f"test_macro_f1 {_number(candidate.get('test_macro_f1'), 4)}"
                + (" (baseline)" if candidate.get("is_baseline") else "")
                + (f", {candidate.get('detail')}" if candidate.get("detail") else ""),
            ]
        )

    features = (active.feature_schema or {}).get("features") or []
    rows.append(["Feature count", str(len(features))])
    rows.append(
        [
            "Leakage control",
            (active.feature_schema or {}).get("leakage_control", "not recorded"),
        ]
    )

    return ReportDataset(
        report_type="model_evaluation",
        title="AI / ML model evaluation",
        columns=["Field", "Value"],
        rows=rows,
        summary=[
            ("Version", active.version),
            ("Algorithm", active.algorithm),
            ("Macro F1", _number(metrics.get("macro_f1"), 4)),
            ("Baseline macro F1", _number(metrics.get("baseline_macro_f1"), 4)),
            ("Training data", active.dataset_kind),
        ],
        methodology=(
            "The model predicts the severity band of a risk's inherent score. Candidate algorithms "
            "(majority-class baseline, logistic regression, random forest and, when installed, XGBoost) "
            "are compared by cross-validated macro F1 on the training split; the winner is then scored "
            "once on the held-out split, and both numbers are reported. Likelihood and impact are "
            "excluded from the feature set because they define the target."
        ),
        limitations=(
            (active.limitations or "")
            + " "
            + MODEL_NOTICE
            + " Where the training data is synthetic, the metrics describe performance on synthetic "
            "data and are not evidence about real risk."
        ),
    )


def _scenario_comparison(
    db: Session, organization_id: int, filters: ReportFilters, currency: Optional[str]
) -> ReportDataset:
    risks = _filtered_risks(db, organization_id, filters)
    risk_by_id = {risk.id: risk for risk in risks}
    scenarios = _scenarios_for(db, organization_id, [risk.id for risk in risks] or None)

    calculated = []
    excluded: set[str] = set()
    for scenario in scenarios:
        if scenario.risk_id is not None and scenario.risk_id not in risk_by_id:
            continue
        breakdown = scenario_breakdown(scenario)
        if currency and breakdown.currency != currency:
            excluded.add(breakdown.currency)
            continue
        calculated.append((scenario, breakdown))

    calculated.sort(key=lambda item: item[1].expected_loss, reverse=True)
    total_expected = sum((breakdown.expected_loss for _, breakdown in calculated), Decimal("0.00"))

    rows: list[list[Any]] = []
    for scenario, breakdown in calculated:
        parent = risk_by_id.get(scenario.risk_id)
        share = float(breakdown.expected_loss / total_expected) if total_expected > 0 else 0.0
        rows.append(
            [
                scenario.name,
                scenario.scenario_type,
                parent.risk_ref if parent else "",
                breakdown.currency,
                _money(breakdown.expected_loss, breakdown.currency),
                f"{share * 100:.1f}%",
                _money(breakdown.expected_residual_loss, breakdown.currency),
                _money(breakdown.potential_avoided_loss, breakdown.currency),
                _percent(breakdown.return_on_mitigation) if breakdown.return_on_mitigation is not None else "not calculable",
                (scenario.assumptions or "").strip(),
            ]
        )

    summary: list[tuple[str, str]] = [("Scenarios compared", str(len(rows)))]
    if calculated:
        summary.append(("Largest expected loss", f"{rows[0][0]} at {rows[0][4]}"))
        summary.append(("Combined expected loss (reporting currency)", _money(total_expected, currency)))
    else:
        summary.append(("Combined expected loss", "no scenario in scope"))

    limitations = ESTIMATE_NOTICE
    if excluded:
        limitations += (
            " Scenarios in " + ", ".join(sorted(excluded)) + " were excluded from the comparison and "
            "from the combined total because no exchange rate is assumed."
        )

    return ReportDataset(
        report_type="scenario_comparison",
        title="Scenario comparison",
        columns=[
            "Scenario",
            "Type",
            "Risk",
            "Currency",
            "Expected loss",
            "Share of expected loss",
            "Expected residual loss",
            "Potentially avoided",
            "Return on mitigation",
            "Stated assumptions",
        ],
        rows=rows,
        summary=summary,
        methodology=(
            "Scenarios are ranked by expected loss, computed by the shared loss engine as "
            "probability x net loss. Shares are only comparable because every row in this table is in "
            "the same reporting currency. 'Return on mitigation' is "
            "(avoided loss - mitigation cost) / mitigation cost and is blank when no mitigation cost "
            "has been recorded."
        ),
        limitations=limitations,
    )


REPORT_TYPES: dict[str, ReportType] = {
    item.key: item
    for item in (
        ReportType(
            "executive_summary",
            "Executive summary",
            "Headline counts, severity mix, remediation status and modelled exposure.",
            _executive_summary,
        ),
        ReportType(
            "risk_register",
            "Risk register",
            "The full register with inherent and residual scores and ownership.",
            _risk_register,
        ),
        ReportType(
            "financial_exposure",
            "Financial exposure",
            "Per-scenario gross, net, expected and residual loss with the formulas applied.",
            _financial_exposure,
        ),
        ReportType(
            "vulnerability_assessment",
            "Vulnerability assessment",
            "Findings with the upstream CVSS values and this platform's own priority score.",
            _vulnerability_assessment,
        ),
        ReportType(
            "asset_risk",
            "Asset risk",
            "Per-asset criticality, exposure and modelled loss.",
            _asset_risk,
        ),
        ReportType(
            "mitigation_progress",
            "Mitigation progress",
            "Remediation actions with status, ownership and due dates.",
            _mitigation_progress,
        ),
        ReportType(
            "model_evaluation",
            "AI / ML model evaluation",
            "Active model version, metrics, per-class scores, confusion matrix and limitations.",
            _model_evaluation,
        ),
        ReportType(
            "scenario_comparison",
            "Scenario comparison",
            "Scenarios ranked by expected loss, in one currency.",
            _scenario_comparison,
        ),
    )
}


def report_catalog() -> list[dict[str, str]]:
    """Describe the available reports so the UI never hardcodes the list."""
    return [
        {"key": item.key, "title": item.title, "description": item.description}
        for item in REPORT_TYPES.values()
    ]


def build_report(
    db: Session,
    organization_id: int,
    report_type: str,
    *,
    filters: Optional[ReportFilters] = None,
    currency: Optional[str] = None,
) -> ReportDataset:
    """Build one report from persisted records.

    Raises :class:`KeyError` for an unknown report type so the caller can turn it
    into a 404 rather than silently returning an empty document.
    """
    definition = REPORT_TYPES.get(report_type)
    if definition is None:
        raise KeyError(report_type)
    return definition.builder(db, organization_id, filters or ReportFilters(), currency)


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def render_csv(dataset: ReportDataset) -> bytes:
    """Render the raw table as CSV (UTF-8 with BOM, so Excel opens it correctly)."""
    return csv_bytes(dataset.columns, dataset.rows)


_STYLES = getSampleStyleSheet()
_TITLE_STYLE = ParagraphStyle(
    "FinRiskTitle", parent=_STYLES["Title"], fontSize=18, leading=22, alignment=TA_LEFT, spaceAfter=4
)
_SUBTITLE_STYLE = ParagraphStyle("FinRiskSubtitle", parent=_STYLES["Normal"], fontSize=9.5, textColor=colors.HexColor("#475569"))
_SECTION_STYLE = ParagraphStyle(
    "FinRiskSection", parent=_STYLES["Heading2"], fontSize=11.5, leading=14, spaceBefore=10, spaceAfter=4
)
_BODY_STYLE = ParagraphStyle("FinRiskBody", parent=_STYLES["Normal"], fontSize=9, leading=12.5)
_CELL_STYLE = ParagraphStyle("FinRiskCell", parent=_STYLES["Normal"], fontSize=7.4, leading=9)
_CELL_HEAD_STYLE = ParagraphStyle(
    "FinRiskCellHead", parent=_STYLES["Normal"], fontSize=7.4, leading=9, textColor=colors.white
)


def render_pdf(dataset: ReportDataset, context: ReportContext) -> bytes:
    """Render a formatted PDF document (a real report, not a dashboard screenshot)."""
    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title=f"{dataset.title} - {context.organization_name}",
        author=context.generated_by,
        subject=f"FinRisk AI {dataset.title}",
    )

    story: list[Any] = []
    story.append(Paragraph(escape(dataset.title), _TITLE_STYLE))
    period = "all recorded data"
    if context.period_start or context.period_end:
        period = (
            f"{context.period_start.isoformat() if context.period_start else 'start'} to "
            f"{context.period_end.isoformat() if context.period_end else 'today'}"
        )
    story.append(
        Paragraph(
            escape(
                f"{context.organization_name} &nbsp;|&nbsp; Reporting currency: {context.currency} "
                f"&nbsp;|&nbsp; Period: {period}<br/>"
                f"Generated {context.generated_at.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} "
                f"by {context.generated_by}"
            ),
            _SUBTITLE_STYLE,
        )
    )
    if context.filters is not None and not context.filters.is_empty:
        story.append(
            Paragraph(escape(f"Filters applied: {context.filters.describe()}"), _SUBTITLE_STYLE)
        )
    story.append(Spacer(1, 8))

    if dataset.summary:
        story.append(Paragraph("Headline figures", _SECTION_STYLE))
        story.append(_summary_table(dataset.summary))

    story.append(Paragraph("Methodology", _SECTION_STYLE))
    story.append(Paragraph(escape(dataset.methodology or "Not documented."), _BODY_STYLE))

    story.append(PageBreak())
    story.append(Paragraph(f"Data ({dataset.row_count} row(s))", _SECTION_STYLE))
    if dataset.rows:
        rows = dataset.rows[:MAX_PDF_ROWS]
        story.append(_data_table(dataset.columns, rows))
        if dataset.row_count > MAX_PDF_ROWS:
            story.append(
                Paragraph(
                    escape(
                        f"This document shows the first {MAX_PDF_ROWS} of {dataset.row_count} rows. "
                        "Export the CSV for the complete table."
                    ),
                    _BODY_STYLE,
                )
            )
    else:
        story.append(
            Paragraph(
                escape(
                    "No records matched this report. An empty report means no matching record exists "
                    "in the database, not that the underlying risk is absent."
                ),
                _BODY_STYLE,
            )
        )

    story.append(Spacer(1, 10))
    story.append(Paragraph("Limitations", _SECTION_STYLE))
    story.append(Paragraph(escape(dataset.limitations or "Not documented."), _BODY_STYLE))

    document.build(story, onFirstPage=_footer(context), onLaterPages=_footer(context))
    return buffer.getvalue()


def _footer(context: ReportContext):
    def draw(canvas, doc):  # pragma: no cover - layout callback
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#64748B"))
        canvas.drawString(
            14 * mm,
            8 * mm,
            f"FinRisk AI - {context.organization_name} - generated "
            f"{context.generated_at.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} by "
            f"{context.generated_by}",
        )
        canvas.drawRightString(
            landscape(A4)[0] - 14 * mm, 8 * mm, f"Page {doc.page}"
        )
        canvas.restoreState()

    return draw


def _summary_table(summary: list[tuple[str, str]]) -> Table:
    data = [
        [Paragraph(escape(str(label)), _CELL_HEAD_STYLE), Paragraph(escape(str(value)), _CELL_STYLE)]
        for label, value in summary
    ]
    table = Table(data, colWidths=[80 * mm, 120 * mm], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#1E3A8A")),
                ("TEXTCOLOR", (0, 0), (0, -1), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
                ("ROWBACKGROUNDS", (1, 0), (1, -1), [colors.white, colors.HexColor("#F1F5F9")]),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return table


def _data_table(columns: list[str], rows: list[list[Any]]) -> Table:
    header = [Paragraph(escape(str(column)), _CELL_HEAD_STYLE) for column in columns]
    body = [
        [Paragraph(escape("" if value is None else str(value)), _CELL_STYLE) for value in row]
        for row in rows
    ]
    table = Table([header, *body], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A8A")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD5E1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ]
        )
    )
    return table


__all__ = [
    "ESTIMATE_NOTICE",
    "MAX_PDF_ROWS",
    "MODEL_NOTICE",
    "REPORT_TYPES",
    "ReportContext",
    "ReportDataset",
    "ReportFilters",
    "ReportType",
    "build_report",
    "render_csv",
    "render_pdf",
    "report_catalog",
]
