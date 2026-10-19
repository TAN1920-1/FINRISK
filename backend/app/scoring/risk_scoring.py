"""Deterministic risk scoring rules.

Two independent scores live here:

1. :func:`rule_based_priority_class` - the 5x5 likelihood/impact register score,
   optionally discounted by how good the supporting evidence is.  This is the
   baseline the machine-learning model is compared against.
2. :func:`compute_finding_priority` - a *context-aware* vulnerability priority.
   It is explicitly **not** a CVSS score; CVSS is one input among several.  The
   weights are fixed constants so any score can be reproduced by hand.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Optional

from .. import domain
from ..schemas import PriorityFactor

#: Weight budget for the context-aware finding score (sums to 100).
FINDING_WEIGHTS: dict[str, float] = {
    "cvss": 35.0,
    "exploitation": 25.0,
    "exposure": 15.0,
    "asset_criticality": 10.0,
    "data_sensitivity": 5.0,
    "vulnerability_age": 5.0,
}

#: Maximum penalty applied when a compensating control is documented.
COMPENSATING_CONTROL_PENALTY = 10.0

#: Lower bounds (inclusive) of the context-aware priority bands.
FINDING_BANDS: tuple[tuple[float, str], ...] = (
    (75.0, domain.Severity.CRITICAL.value),
    (55.0, domain.Severity.HIGH.value),
    (35.0, domain.Severity.MEDIUM.value),
    (0.0, domain.Severity.LOW.value),
)

#: Reference period used to normalise vulnerability age.
AGE_REFERENCE_DAYS = 365


@dataclass
class FindingPriority:
    score: float
    band: str
    factors: list[PriorityFactor] = field(default_factory=list)
    factors_map: dict[str, Any] = field(default_factory=dict)


def band_from_score(score: float) -> str:
    for threshold, band in FINDING_BANDS:
        if score >= threshold:
            return band
    return domain.Severity.LOW.value


def rule_based_priority_class(
    likelihood: Optional[float],
    impact: Optional[float],
    evidence_quality: Optional[str] = None,
) -> str:
    """Classify a register risk using the documented 5x5 matrix.

    Returns the *unadjusted* severity band; evidence quality is handled
    separately by :func:`confidence_adjusted_score` so the two concerns stay
    visible in the UI.
    """
    return domain.severity_from_score(domain.risk_score(likelihood, impact))


def compute_finding_priority(
    *,
    cvss_score: Optional[float] = None,
    exploit_evidence: bool = False,
    kev_listed: bool = False,
    epss_score: Optional[float] = None,
    internet_exposed: bool = False,
    asset_criticality: Optional[int] = None,
    asset_data_sensitivity: Optional[int] = None,
    vulnerability_age_days: Optional[int] = None,
    has_compensating_controls: bool = False,
) -> FindingPriority:
    """Compute the 0-100 context-aware priority for a vulnerability finding.

    Every factor contributes a fraction of its weight budget; the factors list is
    returned alongside the score so the UI can show exactly how it was reached.
    """
    factors: list[PriorityFactor] = []
    factors_map: dict[str, Any] = {}

    # 1. Technical severity (CVSS base score, 0-10).
    if cvss_score is None:
        cvss_component = 0.0
        cvss_detail = "No CVSS base score recorded."
    else:
        normalised = max(0.0, min(10.0, float(cvss_score))) / 10.0
        cvss_component = normalised * FINDING_WEIGHTS["cvss"]
        cvss_detail = f"CVSS {cvss_score:g}/10 contributes {cvss_component:.1f}."
    factors_map["cvss_score"] = cvss_score
    factors.append(
        PriorityFactor(
            key="cvss",
            label="Technical severity (CVSS)",
            weight=FINDING_WEIGHTS["cvss"],
            contribution=round(cvss_component, 2),
            detail=cvss_detail,
        )
    )

    # 2. Evidence of exploitation (KEV listing outranks a local flag outranks EPSS).
    if kev_listed:
        exploitation_component = FINDING_WEIGHTS["exploitation"]
        exploitation_detail = "Listed in the CISA Known Exploited Vulnerabilities catalogue."
    elif exploit_evidence:
        exploitation_component = FINDING_WEIGHTS["exploitation"] * 0.8
        exploitation_detail = "Exploitation evidence recorded by the assessment team."
    elif epss_score is not None:
        exploitation_component = max(0.0, min(1.0, float(epss_score))) * FINDING_WEIGHTS["exploitation"]
        exploitation_detail = f"EPSS score {epss_score:.3f} scaled into the weight budget."
    else:
        exploitation_component = 0.0
        exploitation_detail = "No exploitation evidence or EPSS score available."
    factors_map["kev_listed"] = kev_listed
    factors_map["exploit_evidence"] = exploit_evidence
    factors_map["epss_score"] = epss_score
    factors.append(
        PriorityFactor(
            key="exploitation",
            label="Evidence of exploitation",
            weight=FINDING_WEIGHTS["exploitation"],
            contribution=round(exploitation_component, 2),
            detail=exploitation_detail,
        )
    )

    # 3. Internet exposure of the affected asset.
    exposure_component = FINDING_WEIGHTS["exposure"] if internet_exposed else 0.0
    factors_map["internet_exposed"] = internet_exposed
    factors.append(
        PriorityFactor(
            key="exposure",
            label="Internet exposure",
            weight=FINDING_WEIGHTS["exposure"],
            contribution=round(exposure_component, 2),
            detail="Asset is reachable from the internet." if internet_exposed else "Asset is not internet facing.",
        )
    )

    # 4. Asset criticality.
    if asset_criticality is None:
        criticality_component = FINDING_WEIGHTS["asset_criticality"] * 0.6
        criticality_detail = "Asset criticality unknown; a neutral share was applied."
    else:
        normalised = max(1, min(5, int(asset_criticality))) / 5.0
        criticality_component = normalised * FINDING_WEIGHTS["asset_criticality"]
        criticality_detail = f"Asset criticality {asset_criticality}/5."
    factors_map["asset_criticality"] = asset_criticality
    factors.append(
        PriorityFactor(
            key="asset_criticality",
            label="Asset criticality",
            weight=FINDING_WEIGHTS["asset_criticality"],
            contribution=round(criticality_component, 2),
            detail=criticality_detail,
        )
    )

    # 5. Data sensitivity.
    if asset_data_sensitivity is None:
        sensitivity_component = FINDING_WEIGHTS["data_sensitivity"] * 0.6
        sensitivity_detail = "Data sensitivity unknown; a neutral share was applied."
    else:
        normalised = max(1, min(5, int(asset_data_sensitivity))) / 5.0
        sensitivity_component = normalised * FINDING_WEIGHTS["data_sensitivity"]
        sensitivity_detail = f"Data sensitivity {asset_data_sensitivity}/5."
    factors_map["asset_data_sensitivity"] = asset_data_sensitivity
    factors.append(
        PriorityFactor(
            key="data_sensitivity",
            label="Data sensitivity",
            weight=FINDING_WEIGHTS["data_sensitivity"],
            contribution=round(sensitivity_component, 2),
            detail=sensitivity_detail,
        )
    )

    # 6. Age of the finding (older unpatched findings are riskier, up to one year).
    if vulnerability_age_days is None:
        age_component = 0.0
        age_detail = "Finding age unknown."
    else:
        normalised = min(max(0, int(vulnerability_age_days)), AGE_REFERENCE_DAYS) / AGE_REFERENCE_DAYS
        age_component = normalised * FINDING_WEIGHTS["vulnerability_age"]
        age_detail = f"{int(vulnerability_age_days)} days since detection (capped at {AGE_REFERENCE_DAYS})."
    factors_map["vulnerability_age_days"] = vulnerability_age_days
    factors.append(
        PriorityFactor(
            key="vulnerability_age",
            label="Vulnerability age",
            weight=FINDING_WEIGHTS["vulnerability_age"],
            contribution=round(age_component, 2),
            detail=age_detail,
        )
    )

    # 7. Compensating controls reduce, but never zero, the priority.
    penalty = -COMPENSATING_CONTROL_PENALTY if has_compensating_controls else 0.0
    factors_map["has_compensating_controls"] = has_compensating_controls
    factors.append(
        PriorityFactor(
            key="compensating_controls",
            label="Compensating controls",
            weight=COMPENSATING_CONTROL_PENALTY,
            contribution=round(penalty, 2),
            detail=(
                "Documented compensating controls reduce the priority."
                if has_compensating_controls
                else "No compensating controls documented."
            ),
        )
    )

    raw = sum(factor.contribution for factor in factors)
    score = round(max(0.0, min(100.0, raw)), 2)

    return FindingPriority(score=score, band=band_from_score(score), factors=factors, factors_map=factors_map)


def expected_exposure_from_scenarios(scenarios, *, residual: bool = False) -> tuple[Decimal, Optional[str]]:
    """Sum expected losses of same-currency scenarios.

    Returns ``(total, currency)``.  Scenarios in more than one currency are not
    added together: only the dominant (organization) currency is totalled and the
    caller is expected to surface that limitation in the UI.
    """
    from .financial import LossInputs, compute_losses

    totals: dict[str, Decimal] = {}
    for scenario in scenarios:
        result = compute_losses(
            LossInputs(
                currency=scenario.currency,
                time_horizon_months=scenario.time_horizon_months,
                probability=scenario.probability,
                residual_probability=scenario.residual_probability if residual else None,
                direct_loss=scenario.direct_loss,
                revenue_loss=scenario.revenue_loss,
                downtime_hours=scenario.downtime_hours,
                downtime_cost_per_hour=scenario.downtime_cost_per_hour,
                recovery_cost=scenario.recovery_cost,
                incident_response_cost=scenario.incident_response_cost,
                regulatory_cost=scenario.regulatory_cost,
                other_cost=scenario.other_cost,
                insurance_recovery=scenario.insurance_recovery,
                mitigation_cost=scenario.mitigation_cost,
            )
        )
        currency = scenario.currency or "USD"
        totals[currency] = totals.get(currency, Decimal("0.00")) + (
            result.expected_residual_loss if residual else result.expected_loss
        )

    if not totals:
        return Decimal("0.00"), None

    currency, total = max(totals.items(), key=lambda item: item[1])
    return total, currency
