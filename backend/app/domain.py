"""Domain vocabulary shared by the ORM models, the API schemas and the scoring
engines.  Keeping the enums and the score bands in one place guarantees that the
database, the API and the UI agree on what "High" means.
"""

from __future__ import annotations

from enum import Enum


class StrEnum(str, Enum):
    """String enum whose value is used for storage and transport."""

    def __str__(self) -> str:  # pragma: no cover - convenience only
        return self.value


class Role(StrEnum):
    ADMIN = "admin"
    RISK_MANAGER = "risk_manager"
    ANALYST = "analyst"
    VIEWER = "viewer"


#: Ordered from most to least privileged.
ROLE_RANK: dict[str, int] = {
    Role.ADMIN.value: 4,
    Role.RISK_MANAGER.value: 3,
    Role.ANALYST.value: 2,
    Role.VIEWER.value: 1,
}


class Severity(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class RiskCategory(StrEnum):
    CYBERSECURITY = "cybersecurity"
    FINANCIAL = "financial"
    OPERATIONAL = "operational"
    THIRD_PARTY = "third_party"
    REGULATORY = "regulatory"
    BUSINESS_CONTINUITY = "business_continuity"
    TECHNOLOGY = "technology"


class RiskStatus(StrEnum):
    IDENTIFIED = "identified"
    UNDER_ASSESSMENT = "under_assessment"
    MITIGATION_PLANNED = "mitigation_planned"
    IN_PROGRESS = "in_progress"
    ACCEPTED = "accepted"
    RESOLVED = "resolved"
    CLOSED = "closed"


#: Statuses that are still counted as "open" exposure.
OPEN_RISK_STATUSES: tuple[str, ...] = (
    RiskStatus.IDENTIFIED.value,
    RiskStatus.UNDER_ASSESSMENT.value,
    RiskStatus.MITIGATION_PLANNED.value,
    RiskStatus.IN_PROGRESS.value,
)


class EvidenceQuality(StrEnum):
    """How trustworthy the supporting evidence for a record is."""

    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    VERIFIED = "verified"


#: Multiplier applied to a raw risk score when ranking by "confidence-adjusted"
#: priority.  Weak evidence lowers the effective priority, it never raises it.
EVIDENCE_CONFIDENCE: dict[str, float] = {
    EvidenceQuality.NONE.value: 0.60,
    EvidenceQuality.LOW.value: 0.75,
    EvidenceQuality.MEDIUM.value: 0.90,
    EvidenceQuality.HIGH.value: 1.00,
    EvidenceQuality.VERIFIED.value: 1.00,
}


class AssetType(StrEnum):
    APPLICATION = "application"
    DATABASE = "database"
    NETWORK = "network"
    ENDPOINT = "endpoint"
    CLOUD_SERVICE = "cloud_service"
    THIRD_PARTY_SERVICE = "third_party_service"
    BUSINESS_PROCESS = "business_process"
    FACILITY = "facility"
    IDENTITY = "identity"
    DATA_STORE = "data_store"


class Environment(StrEnum):
    PRODUCTION = "production"
    STAGING = "staging"
    DEVELOPMENT = "development"
    DISASTER_RECOVERY = "disaster_recovery"
    CORPORATE = "corporate"


class MitigationStatus(StrEnum):
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class RemediationStatus(StrEnum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    REMEDIATED = "remediated"
    ACCEPTED_RISK = "accepted_risk"
    FALSE_POSITIVE = "false_positive"


#: Remediation states that still represent live, unremediated exposure.
OPEN_REMEDIATION_STATUSES: tuple[str, ...] = (
    RemediationStatus.OPEN.value,
    RemediationStatus.IN_PROGRESS.value,
)


class ScenarioType(StrEnum):
    BEST_CASE = "best_case"
    BASE_CASE = "base_case"
    WORST_CASE = "worst_case"


class AssessmentMethod(StrEnum):
    RULES = "rules"
    ML = "ml"
    HYBRID = "hybrid"


class DatasetKind(StrEnum):
    SYNTHETIC_DEMO = "synthetic_demo"
    CURATED_REAL = "curated_real"
    MIXED = "mixed"


class TemplateKind(StrEnum):
    """Legacy TILT questionnaire kinds preserved by the upgrade."""

    STANDARD = "standard"
    CLOUD = "cloud"


class AuditAction(StrEnum):
    LOGIN_SUCCEEDED = "auth.login_succeeded"
    LOGIN_FAILED = "auth.login_failed"
    LOGOUT = "auth.logout"
    USER_REGISTERED = "auth.user_registered"
    PASSWORD_CHANGED = "auth.password_changed"
    ORGANIZATION_CREATED = "organization.created"
    MEMBER_INVITED = "organization.member_added"
    MEMBER_ROLE_CHANGED = "organization.member_role_changed"
    ASSET_CREATED = "asset.created"
    ASSET_UPDATED = "asset.updated"
    ASSET_DELETED = "asset.deleted"
    RISK_CREATED = "risk.created"
    RISK_UPDATED = "risk.updated"
    RISK_STATUS_CHANGED = "risk.status_changed"
    RISK_DELETED = "risk.deleted"
    MITIGATION_CREATED = "mitigation.created"
    MITIGATION_UPDATED = "mitigation.updated"
    MITIGATION_DELETED = "mitigation.deleted"
    SCENARIO_CREATED = "financial_scenario.created"
    SCENARIO_UPDATED = "financial_scenario.updated"
    SCENARIO_DELETED = "financial_scenario.deleted"
    FINDING_CREATED = "vulnerability_finding.created"
    FINDING_IMPORTED = "vulnerability_finding.imported"
    FINDING_UPDATED = "vulnerability_finding.updated"
    FINDING_DELETED = "vulnerability_finding.deleted"
    PREDICTION_REQUESTED = "ai.prediction_requested"
    MODEL_TRAINED = "ai.model_trained"
    REPORT_GENERATED = "report.generated"
    DATA_EXPORTED = "data.exported"
    DEMO_DATA_SEEDED = "demo_data.seeded"


# ---------------------------------------------------------------------------
# Scoring bands
# ---------------------------------------------------------------------------

#: Risk score = likelihood (1-5) x impact (1-5), i.e. 1..25.
RISK_SCORE_MIN = 1
RISK_SCORE_MAX = 25

#: Lower bound (inclusive) of each severity band.
SEVERITY_BANDS: tuple[tuple[int, str], ...] = (
    (20, Severity.CRITICAL.value),
    (12, Severity.HIGH.value),
    (5, Severity.MEDIUM.value),
    (RISK_SCORE_MIN, Severity.LOW.value),
)

SEVERITY_ORDER: dict[str, int] = {
    Severity.CRITICAL.value: 4,
    Severity.HIGH.value: 3,
    Severity.MEDIUM.value: 2,
    Severity.LOW.value: 1,
}

#: Inclusive ``(minimum, maximum)`` inherent score for each severity band.
#: Derived from :data:`SEVERITY_BANDS` so the two can never drift apart.
SEVERITY_SCORE_RANGES: dict[str, tuple[int, int]] = {
    band: (threshold, SEVERITY_BANDS[index - 1][0] - 1 if index else RISK_SCORE_MAX)
    for index, (threshold, band) in enumerate(SEVERITY_BANDS)
}


def clamp(value: float, low: float, high: float) -> float:
    """Clamp ``value`` into the inclusive range ``[low, high]``."""
    return max(low, min(high, value))


def severity_from_score(score: float | int | None) -> str:
    """Map a 1-25 risk score to a severity band."""
    if score is None:
        return Severity.LOW.value
    numeric = float(score)
    for threshold, severity in SEVERITY_BANDS:
        if numeric >= threshold:
            return severity
    return Severity.LOW.value


def risk_score(likelihood: float | int | None, impact: float | int | None) -> int:
    """Deterministic 1-25 inherent risk score."""
    likelihood_value = clamp(float(likelihood or 1), 1, 5)
    impact_value = clamp(float(impact or 1), 1, 5)
    return int(round(likelihood_value * impact_value))


def confidence_adjusted_score(score: float | int, evidence_quality: str | None) -> float:
    """Return the score discounted by the confidence of its supporting evidence."""
    factor = EVIDENCE_CONFIDENCE.get((evidence_quality or EvidenceQuality.MEDIUM.value), 0.90)
    return round(float(score) * factor, 2)


#: Capability strings returned to the client so the UI can hide actions the
#: backend would reject anyway.  Authorisation is *always* re-enforced server
#: side; this list exists purely for presentation.
_ROLE_PERMISSIONS: dict[str, tuple[str, ...]] = {
    Role.ADMIN.value: (
        "risk:read",
        "risk:write",
        "asset:read",
        "asset:write",
        "financial:read",
        "financial:write",
        "vulnerability:read",
        "vulnerability:write",
        "mitigation:read",
        "mitigation:write",
        "ai:read",
        "ai:train",
        "report:read",
        "report:export",
        "audit:read",
        "org:manage",
        "user:manage",
    ),
    Role.RISK_MANAGER.value: (
        "risk:read",
        "risk:write",
        "asset:read",
        "asset:write",
        "financial:read",
        "financial:write",
        "vulnerability:read",
        "vulnerability:write",
        "mitigation:read",
        "mitigation:write",
        "ai:read",
        "ai:train",
        "report:read",
        "report:export",
        "org:manage",
        "user:manage",
    ),
    Role.ANALYST.value: (
        "risk:read",
        "risk:write",
        "asset:read",
        "asset:write",
        "financial:read",
        "financial:write",
        "vulnerability:read",
        "vulnerability:write",
        "mitigation:read",
        "mitigation:write",
        "ai:read",
        "report:read",
        "report:export",
    ),
    Role.VIEWER.value: (
        "risk:read",
        "asset:read",
        "financial:read",
        "vulnerability:read",
        "mitigation:read",
        "ai:read",
        "report:read",
    ),
}


def permissions_for(role: str | None) -> list[str]:
    """Return the presentation-level capability list for a role."""
    return list(_ROLE_PERMISSIONS.get(role or "", ()))
