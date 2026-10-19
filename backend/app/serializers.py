"""ORM -> API response mapping.

Routers stay free of payload plumbing by funnelling every conversion through
these helpers, which also guarantees that optional joined information (owner
name, asset name, rollup counts) is set consistently.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Optional

from .models import (
    Asset,
    EvidenceRecord,
    FinancialScenario,
    Mitigation,
    Risk,
    RiskAssessment,
    User,
    VendorAssessment,
    VulnerabilityFinding,
)
from .schemas import (
    AssetOut,
    EvidenceOut,
    FinancialScenarioOut,
    FindingOut,
    LossBreakdown,
    MitigationOut,
    PriorityFactor,
    RiskAssessmentOut,
    RiskOut,
    VendorAssessmentOut,
)
from . import domain


def asset_out(
    asset: Asset,
    *,
    owner_name: Optional[str] = None,
    open_risks: int = 0,
    open_findings: int = 0,
    severity: Optional[str] = None,
) -> AssetOut:
    payload = AssetOut.model_validate(asset)
    return payload.model_copy(
        update={
            "owner_name": owner_name,
            "open_risks": open_risks,
            "open_findings": open_findings,
            "severity": severity,
        }
    )


def risk_out(
    risk: Risk,
    *,
    asset_name: Optional[str] = None,
    owner_name: Optional[str] = None,
    mitigation_count: int = 0,
    completed_mitigation_count: int = 0,
    expected_gross_exposure: Optional[Decimal] = None,
    expected_residual_exposure: Optional[Decimal] = None,
    currency: Optional[str] = None,
) -> RiskOut:
    payload = RiskOut.model_validate(risk)
    return payload.model_copy(
        update={
            "asset_name": asset_name,
            "owner_name": owner_name,
            "mitigation_count": mitigation_count,
            "completed_mitigation_count": completed_mitigation_count,
            "expected_gross_exposure": expected_gross_exposure,
            "expected_residual_exposure": expected_residual_exposure,
            "currency": currency,
        }
    )


def evidence_out(record: EvidenceRecord) -> EvidenceOut:
    return EvidenceOut.model_validate(record)


def assessment_out(record: RiskAssessment) -> RiskAssessmentOut:
    return RiskAssessmentOut.model_validate(record)


def mitigation_out(mitigation: Mitigation, *, risk: Optional[Risk] = None, assignee: Optional[User] = None) -> MitigationOut:
    payload = MitigationOut.model_validate(mitigation)
    return payload.model_copy(
        update={
            "risk_ref": risk.risk_ref if risk else None,
            "risk_title": risk.title if risk else None,
            "assigned_user_name": assignee.full_name if assignee else None,
        }
    )


def scenario_out(
    scenario: FinancialScenario,
    *,
    risk: Optional[Risk] = None,
    asset: Optional[Asset] = None,
    calculation: Optional[LossBreakdown] = None,
) -> FinancialScenarioOut:
    payload = FinancialScenarioOut.model_validate(scenario)
    return payload.model_copy(
        update={
            "risk_ref": risk.risk_ref if risk else None,
            "risk_title": risk.title if risk else None,
            "asset_name": asset.name if asset else None,
            "calculation": calculation,
        }
    )


def finding_out(finding: VulnerabilityFinding, *, asset: Optional[Asset] = None) -> FindingOut:
    payload = FindingOut.model_validate(finding)
    factors: list[PriorityFactor] = []
    for raw in (finding.priority_factors or []):
        try:
            factors.append(PriorityFactor.model_validate(raw))
        except Exception:  # pragma: no cover - defensive against legacy rows
            continue
    return payload.model_copy(
        update={
            "asset_name": asset.name if asset else None,
            "priority_factors": factors,
        }
    )


def vendor_out(vendor: VendorAssessment) -> VendorAssessmentOut:
    payload = VendorAssessmentOut.model_validate(vendor)
    score = None
    if vendor.likelihood is not None and vendor.impact is not None:
        score = domain.risk_score(vendor.likelihood, vendor.impact)
    return payload.model_copy(
        update={
            "inherent_score": score,
            "severity": domain.severity_from_score(score) if score is not None else None,
        }
    )


def user_summary(user: Optional[User]) -> dict[str, Any]:
    if user is None:
        return {}
    return {"id": user.id, "full_name": user.full_name, "email": user.email}
