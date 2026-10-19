"""Feature definitions and extraction for the priority-classification model.

Documented target
-----------------
``priority_class`` = the severity band of the risk register's inherent score
(``likelihood x impact``, banded by :data:`app.domain.SEVERITY_BANDS`).

Leakage control
---------------
``likelihood`` and ``impact`` are **not** features.  Every feature below is
contextual information that exists independently of the analyst's judgement of
likelihood and impact, so the model learns "what kind of risk is this / how well
is it supported / where does it live" rather than being handed the answer.
"""

from __future__ import annotations

from typing import Any, Optional

from .. import domain
from ..models import Asset, Risk, as_utc, utcnow

TARGET_LABEL = "inherent_priority_class"
TARGET_DESCRIPTION = (
    "Severity band of the risk register's inherent score (likelihood x impact): "
    "critical, high, medium or low."
)

#: Canonical class order (most to least severe).
CLASS_LABELS: tuple[str, ...] = (
    domain.Severity.CRITICAL.value,
    domain.Severity.HIGH.value,
    domain.Severity.MEDIUM.value,
    domain.Severity.LOW.value,
)

#: Feature schema persisted with every trained model so an artifact can always
#: be interpreted, even after the code evolves.
FEATURE_SCHEMA: list[dict[str, str]] = [
    {
        "key": "asset_criticality",
        "label": "Asset criticality",
        "type": "number",
        "description": "Business criticality of the linked asset (1-5; 3 when unknown).",
    },
    {
        "key": "asset_data_sensitivity",
        "label": "Asset data sensitivity",
        "type": "number",
        "description": "Sensitivity of the data on the linked asset (1-5; 3 when unknown).",
    },
    {
        "key": "asset_internet_exposed",
        "label": "Asset internet exposure",
        "type": "number",
        "description": "1 when the linked asset is reachable from the internet.",
    },
    {
        "key": "asset_type_code",
        "label": "Asset type",
        "type": "category",
        "description": "Ordinal position of the asset type in the platform's vocabulary.",
    },
    {
        "key": "category_code",
        "label": "Risk category",
        "type": "category",
        "description": "Ordinal position of the risk category in the platform's vocabulary.",
    },
    {
        "key": "evidence_confidence",
        "label": "Evidence confidence",
        "type": "number",
        "description": "Confidence multiplier implied by the recorded evidence quality (0.6-1.0).",
    },
    {
        "key": "has_owner",
        "label": "Has an owner",
        "type": "number",
        "description": "1 when the risk has an accountable owner.",
    },
    {
        "key": "has_asset",
        "label": "Linked to an asset",
        "type": "number",
        "description": "1 when the risk is linked to a registered asset.",
    },
    {
        "key": "has_threat_scenario",
        "label": "Threat scenario documented",
        "type": "number",
        "description": "1 when a threat scenario has been written down.",
    },
    {
        "key": "has_existing_controls",
        "label": "Existing controls documented",
        "type": "number",
        "description": "1 when current controls have been described.",
    },
    {
        "key": "has_mitigation_plan",
        "label": "Mitigation plan documented",
        "type": "number",
        "description": "1 when a mitigation plan has been described.",
    },
    {
        "key": "open_findings_on_asset",
        "label": "Open vulnerability findings",
        "type": "number",
        "description": "Number of open findings on the linked asset, capped at 20.",
    },
    {
        "key": "days_open",
        "label": "Days since creation",
        "type": "number",
        "description": "Age of the risk record in days, capped at 730.",
    },
    {
        "key": "mitigation_coverage",
        "label": "Mitigation completion",
        "type": "number",
        "description": "Share of the risk's mitigations that are completed (0-1).",
    },
]

FEATURE_KEYS: list[str] = [item["key"] for item in FEATURE_SCHEMA]
FEATURE_LABELS: dict[str, str] = {item["key"]: item["label"] for item in FEATURE_SCHEMA}

_ASSET_TYPE_CODES = {item.value: index for index, item in enumerate(domain.AssetType)}
_CATEGORY_CODES = {item.value: index for index, item in enumerate(domain.RiskCategory)}


def _bounded(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def risk_feature_vector(
    risk: Risk,
    asset: Optional[Asset] = None,
    *,
    open_findings: int = 0,
    mitigation_total: int = 0,
    mitigation_completed: int = 0,
) -> dict[str, float]:
    """Extract the documented feature vector for one risk register entry."""
    evidence = risk.evidence_quality or domain.EvidenceQuality.MEDIUM.value
    days_open = 0.0
    created_at = as_utc(risk.created_at)
    if created_at is not None:
        days_open = max(0.0, (utcnow() - created_at).days)

    coverage = (mitigation_completed / mitigation_total) if mitigation_total else 0.0

    return {
        "asset_criticality": float(asset.criticality if asset else 3),
        "asset_data_sensitivity": float(asset.data_sensitivity if asset else 3),
        "asset_internet_exposed": float(1 if asset and asset.internet_exposed else 0),
        "asset_type_code": float(_ASSET_TYPE_CODES.get(asset.asset_type, 0) if asset else 0),
        "category_code": float(_CATEGORY_CODES.get(risk.category, 0)),
        "evidence_confidence": float(
            domain.EVIDENCE_CONFIDENCE.get(evidence, 0.9)
        ),
        "has_owner": float(1 if risk.owner_id else 0),
        "has_asset": float(1 if risk.asset_id else 0),
        "has_threat_scenario": float(1 if (risk.threat_scenario or "").strip() else 0),
        "has_existing_controls": float(1 if (risk.existing_controls or "").strip() else 0),
        "has_mitigation_plan": float(1 if (risk.mitigation_plan or "").strip() else 0),
        "open_findings_on_asset": float(_bounded(open_findings, 0, 20)),
        "days_open": float(_bounded(days_open, 0, 730)),
        "mitigation_coverage": float(_bounded(coverage, 0.0, 1.0)),
    }


def target_class(likelihood: Optional[int], impact: Optional[int]) -> str:
    """The documented label: severity band of the inherent register score."""
    return domain.severity_from_score(domain.risk_score(likelihood, impact))


def vector_to_row(vector: dict[str, Any]) -> list[float]:
    return [float(vector.get(key, 0.0) or 0.0) for key in FEATURE_KEYS]
