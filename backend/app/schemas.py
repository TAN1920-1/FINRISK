"""Pydantic request/response contracts.

Every response model is explicit: nothing is returned to the client that is not
declared here, which keeps password hashes and other internals out of payloads.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Any, Generic, Literal, Optional, TypeVar

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    PlainSerializer,
    field_validator,
    model_validator,
)

from . import domain


def _to_utc(value: datetime) -> datetime:
    """Treat naive database timestamps as UTC and always serialise with offset."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


UtcDatetime = Annotated[datetime, PlainSerializer(lambda v: _to_utc(v).isoformat(), return_type=str)]

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """Envelope used by every list endpoint."""

    model_config = ConfigDict(from_attributes=True)

    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


class Message(BaseModel):
    message: str
    detail: Optional[str] = None


Money = Annotated[Optional[Decimal], Field(default=None, ge=0, max_digits=18, decimal_places=2)]
Share = Annotated[float, Field(ge=0, le=1)]
Scale15 = Annotated[int, Field(ge=1, le=5)]


# ---------------------------------------------------------------------------
# Authentication and tenancy
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    full_name: str = Field(min_length=2, max_length=200)
    organization_name: str = Field(min_length=2, max_length=200)
    organization_slug: Optional[str] = Field(default=None, max_length=120)


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    slug: Optional[str] = Field(default=None, max_length=120)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    industry: Optional[str] = Field(default=None, max_length=120)


class OrganizationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    industry: Optional[str] = Field(default=None, max_length=120)
    reporting_period_label: Optional[str] = Field(default=None, max_length=60)


class OrganizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    currency: str
    industry: Optional[str] = None
    reporting_period_label: Optional[str] = None
    is_demo: bool = False
    created_at: UtcDatetime
    role: Optional[str] = None
    member_count: Optional[int] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    full_name: str
    is_active: bool
    last_login_at: Optional[UtcDatetime] = None
    created_at: UtcDatetime


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    email: EmailStr
    full_name: str
    role: str
    job_title: Optional[str] = None
    created_at: UtcDatetime


class MemberRoleUpdate(BaseModel):
    role: domain.Role


class MemberCreate(BaseModel):
    """Add a colleague to the active organization and give them a role.

    The administrator sets the initial password; there is no mail delivery in
    this build, so the credential is communicated out of band.
    """

    email: EmailStr
    full_name: str = Field(min_length=2, max_length=200)
    password: str = Field(min_length=1, max_length=256)
    role: domain.Role = domain.Role.VIEWER
    job_title: Optional[str] = Field(default=None, max_length=120)


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: datetime
    user: UserOut
    organizations: list[OrganizationOut]
    active_organization_id: Optional[int] = None
    role: Optional[str] = None
    # Sent here as well as from /api/auth/me: the frontend shell drives every
    # permission-gated control off this list, so omitting it would hide those
    # controls until the session was re-read on a page refresh.
    permissions: list[str] = Field(default_factory=list)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


class SessionContext(BaseModel):
    """Everything the frontend shell needs after login or on refresh."""

    user: UserOut
    organizations: list[OrganizationOut]
    active_organization_id: Optional[int] = None
    role: Optional[str] = None
    permissions: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------


class AssetBase(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    description: Optional[str] = None
    asset_type: domain.AssetType
    environment: domain.Environment = domain.Environment.PRODUCTION
    business_unit: Optional[str] = Field(default=None, max_length=120)
    owner_id: Optional[int] = None
    criticality: Scale15 = 3
    data_sensitivity: Scale15 = 3
    internet_exposed: bool = False
    financial_importance: Money = None
    currency: str = Field(default="USD", min_length=3, max_length=3)
    dependencies: Optional[str] = None
    existing_controls: Optional[str] = None
    last_assessed_at: Optional[datetime] = None
    is_active: bool = True


class AssetCreate(AssetBase):
    asset_ref: Optional[str] = Field(default=None, max_length=40)


class AssetUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    description: Optional[str] = None
    asset_type: Optional[domain.AssetType] = None
    environment: Optional[domain.Environment] = None
    business_unit: Optional[str] = Field(default=None, max_length=120)
    owner_id: Optional[int] = None
    criticality: Optional[Scale15] = None
    data_sensitivity: Optional[Scale15] = None
    internet_exposed: Optional[bool] = None
    financial_importance: Money = None
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    dependencies: Optional[str] = None
    existing_controls: Optional[str] = None
    last_assessed_at: Optional[datetime] = None
    is_active: Optional[bool] = None


class AssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    organization_id: int
    asset_ref: str
    name: str
    description: Optional[str] = None
    asset_type: str
    environment: str
    business_unit: Optional[str] = None
    owner_id: Optional[int] = None
    owner_name: Optional[str] = None
    criticality: int
    data_sensitivity: int
    internet_exposed: bool
    financial_importance: Optional[Decimal] = None
    currency: str
    dependencies: Optional[str] = None
    existing_controls: Optional[str] = None
    last_assessed_at: Optional[UtcDatetime] = None
    is_active: bool
    is_demo: bool
    created_at: UtcDatetime
    updated_at: UtcDatetime
    open_risks: int = 0
    open_findings: int = 0
    severity: Optional[str] = None


# ---------------------------------------------------------------------------
# Risks
# ---------------------------------------------------------------------------


class RiskBase(BaseModel):
    title: str = Field(min_length=3, max_length=250)
    description: Optional[str] = None
    category: domain.RiskCategory
    source: Optional[str] = Field(default=None, max_length=120)
    asset_id: Optional[int] = None
    business_unit: Optional[str] = Field(default=None, max_length=120)
    owner_id: Optional[int] = None
    threat_scenario: Optional[str] = None
    likelihood: Scale15 = 3
    impact: Scale15 = 3
    financial_impact_assumptions: Optional[str] = None
    existing_controls: Optional[str] = None
    mitigation_plan: Optional[str] = None
    residual_likelihood: Optional[Scale15] = None
    residual_impact: Optional[Scale15] = None
    status: domain.RiskStatus = domain.RiskStatus.IDENTIFIED
    evidence_quality: domain.EvidenceQuality = domain.EvidenceQuality.MEDIUM
    due_date: Optional[date] = None

    @model_validator(mode="after")
    def _require_residual_pair(self) -> "RiskBase":
        if (self.residual_likelihood is None) != (self.residual_impact is None):
            raise ValueError(
                "residual_likelihood and residual_impact must be supplied together."
            )
        return self


class RiskCreate(RiskBase):
    risk_ref: Optional[str] = Field(default=None, max_length=40)


class RiskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=250)
    description: Optional[str] = None
    category: Optional[domain.RiskCategory] = None
    source: Optional[str] = Field(default=None, max_length=120)
    asset_id: Optional[int] = None
    business_unit: Optional[str] = Field(default=None, max_length=120)
    owner_id: Optional[int] = None
    threat_scenario: Optional[str] = None
    likelihood: Optional[Scale15] = None
    impact: Optional[Scale15] = None
    financial_impact_assumptions: Optional[str] = None
    existing_controls: Optional[str] = None
    mitigation_plan: Optional[str] = None
    residual_likelihood: Optional[Scale15] = None
    residual_impact: Optional[Scale15] = None
    status: Optional[domain.RiskStatus] = None
    evidence_quality: Optional[domain.EvidenceQuality] = None
    due_date: Optional[date] = None
    clear_residual: bool = False


class RiskStatusUpdate(BaseModel):
    status: domain.RiskStatus
    note: Optional[str] = Field(default=None, max_length=500)


class RiskOwnerUpdate(BaseModel):
    owner_id: Optional[int] = None


class RiskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    organization_id: int
    risk_ref: str
    title: str
    description: Optional[str] = None
    category: str
    source: Optional[str] = None
    asset_id: Optional[int] = None
    asset_name: Optional[str] = None
    business_unit: Optional[str] = None
    owner_id: Optional[int] = None
    owner_name: Optional[str] = None
    threat_scenario: Optional[str] = None
    likelihood: int
    impact: int
    inherent_score: int
    severity: str
    residual_likelihood: Optional[int] = None
    residual_impact: Optional[int] = None
    residual_score: Optional[int] = None
    residual_severity: Optional[str] = None
    financial_impact_assumptions: Optional[str] = None
    existing_controls: Optional[str] = None
    mitigation_plan: Optional[str] = None
    status: str
    evidence_quality: str
    due_date: Optional[date] = None
    closed_at: Optional[UtcDatetime] = None
    is_demo: bool
    created_at: UtcDatetime
    updated_at: UtcDatetime
    mitigation_count: int = 0
    completed_mitigation_count: int = 0
    expected_gross_exposure: Optional[Decimal] = None
    expected_residual_exposure: Optional[Decimal] = None
    currency: Optional[str] = None


class EvidenceCreate(BaseModel):
    title: str = Field(min_length=2, max_length=250)
    description: Optional[str] = None
    evidence_type: str = Field(default="document", max_length=40)
    source_url: Optional[str] = Field(default=None, max_length=500)
    quality: domain.EvidenceQuality = domain.EvidenceQuality.MEDIUM
    collected_at: Optional[datetime] = None


class EvidenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    risk_id: Optional[int] = None
    asset_id: Optional[int] = None
    title: str
    description: Optional[str] = None
    evidence_type: str
    source_url: Optional[str] = None
    quality: str
    collected_at: Optional[UtcDatetime] = None
    created_at: UtcDatetime


class RiskAssessmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    risk_id: int
    assessed_at: UtcDatetime
    method: str
    likelihood: int
    impact: int
    inherent_score: int
    residual_likelihood: Optional[int] = None
    residual_impact: Optional[int] = None
    residual_score: Optional[int] = None
    confidence: Optional[float] = None
    expected_loss: Optional[Decimal] = None
    currency: Optional[str] = None
    notes: Optional[str] = None
    model_version: Optional[str] = None


class RiskDetailOut(RiskOut):
    evidence: list[EvidenceOut] = Field(default_factory=list)
    assessments: list[RiskAssessmentOut] = Field(default_factory=list)
    mitigations: list["MitigationOut"] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Mitigations
# ---------------------------------------------------------------------------


class MitigationBase(BaseModel):
    description: str = Field(min_length=3)
    priority: domain.Severity = domain.Severity.MEDIUM
    assigned_user_id: Optional[int] = None
    due_date: Optional[date] = None
    estimated_cost: Money = None
    currency: str = Field(default="USD", min_length=3, max_length=3)
    status: domain.MitigationStatus = domain.MitigationStatus.PLANNED
    expected_risk_reduction: Optional[Share] = None
    evidence: Optional[str] = None
    completion_notes: Optional[str] = None


class MitigationCreate(MitigationBase):
    risk_id: int
    action_ref: Optional[str] = Field(default=None, max_length=40)


class MitigationUpdate(BaseModel):
    description: Optional[str] = Field(default=None, min_length=3)
    priority: Optional[domain.Severity] = None
    assigned_user_id: Optional[int] = None
    due_date: Optional[date] = None
    estimated_cost: Money = None
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    status: Optional[domain.MitigationStatus] = None
    expected_risk_reduction: Optional[Share] = None
    evidence: Optional[str] = None
    completion_notes: Optional[str] = None


class MitigationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    organization_id: int
    risk_id: int
    risk_ref: Optional[str] = None
    risk_title: Optional[str] = None
    action_ref: str
    description: str
    priority: str
    assigned_user_id: Optional[int] = None
    assigned_user_name: Optional[str] = None
    due_date: Optional[date] = None
    estimated_cost: Optional[Decimal] = None
    currency: str
    status: str
    expected_risk_reduction: Optional[float] = None
    evidence: Optional[str] = None
    completion_notes: Optional[str] = None
    completed_at: Optional[UtcDatetime] = None
    is_demo: bool
    is_overdue: bool = False
    created_at: UtcDatetime
    updated_at: UtcDatetime


class MitigationStatusUpdate(BaseModel):
    status: domain.MitigationStatus
    note: Optional[str] = Field(default=None, max_length=1000)


class MitigationStatusOut(BaseModel):
    """Result of a mitigation status change.

    Completing an action does **not** change the risk's residual score: the
    residual is only updated when an analyst records explicit post-mitigation
    likelihood/impact values.  The response states this so the UI never implies
    that closing a task removed the risk.
    """

    mitigation: MitigationOut
    risk_residual_score: Optional[int] = None
    residual_severity: Optional[str] = None
    note: str


# ---------------------------------------------------------------------------
# Financial scenarios
# ---------------------------------------------------------------------------


class ScenarioInputs(BaseModel):
    """Inputs of the loss-estimation engine (all amounts in ``currency``)."""

    currency: str = Field(default="USD", min_length=3, max_length=3)
    time_horizon_months: int = Field(default=12, ge=1, le=120)
    probability: Share = 0.1
    residual_probability: Optional[Share] = None

    direct_loss: Money = None
    revenue_loss: Money = None
    downtime_hours: Optional[float] = Field(default=None, ge=0)
    downtime_cost_per_hour: Money = None
    recovery_cost: Money = None
    incident_response_cost: Money = None
    regulatory_cost: Money = None
    other_cost: Money = None
    insurance_recovery: Money = None
    mitigation_cost: Money = None


class FinancialScenarioCreate(ScenarioInputs):
    name: str = Field(min_length=2, max_length=200)
    scenario_type: domain.ScenarioType = domain.ScenarioType.BASE_CASE
    risk_id: Optional[int] = None
    asset_id: Optional[int] = None
    description: Optional[str] = None
    assumptions: Optional[str] = None


class FinancialScenarioUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    scenario_type: Optional[domain.ScenarioType] = None
    risk_id: Optional[int] = None
    asset_id: Optional[int] = None
    description: Optional[str] = None
    assumptions: Optional[str] = None
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    time_horizon_months: Optional[int] = Field(default=None, ge=1, le=120)
    probability: Optional[Share] = None
    residual_probability: Optional[Share] = None
    direct_loss: Money = None
    revenue_loss: Money = None
    downtime_hours: Optional[float] = Field(default=None, ge=0)
    downtime_cost_per_hour: Money = None
    recovery_cost: Money = None
    incident_response_cost: Money = None
    regulatory_cost: Money = None
    other_cost: Money = None
    insurance_recovery: Money = None
    mitigation_cost: Money = None


class LossComponent(BaseModel):
    label: str
    amount: Decimal
    note: Optional[str] = None


class LossBreakdown(BaseModel):
    """Transparent, auditable output of :mod:`app.scoring.financial`."""

    currency: str
    time_horizon_months: int
    probability: float
    residual_probability: Optional[float] = None
    components: list[LossComponent]
    gross_loss: Decimal
    total_recoveries: Decimal
    net_loss: Decimal
    expected_loss: Decimal
    expected_residual_loss: Decimal
    potential_avoided_loss: Decimal
    return_on_mitigation: Optional[float] = None
    mitigation_cost: Decimal
    notes: list[str] = Field(default_factory=list)


class SensitivityPoint(BaseModel):
    label: str
    probability: float
    net_loss: Decimal
    expected_loss: Decimal


class SensitivityAnalysis(BaseModel):
    currency: str
    baseline_probability: float
    baseline_expected_loss: Decimal
    probability_sweep: list[SensitivityPoint]
    net_loss_sweep: list[SensitivityPoint]
    break_even_probability: Optional[float] = None


class ScenarioCalculationOut(BaseModel):
    breakdown: LossBreakdown
    sensitivity: SensitivityAnalysis


class FinancialScenarioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    organization_id: int
    name: str
    scenario_type: str
    risk_id: Optional[int] = None
    risk_ref: Optional[str] = None
    risk_title: Optional[str] = None
    asset_id: Optional[int] = None
    asset_name: Optional[str] = None
    description: Optional[str] = None
    assumptions: Optional[str] = None
    currency: str
    time_horizon_months: int
    probability: float
    residual_probability: Optional[float] = None
    direct_loss: Optional[Decimal] = None
    revenue_loss: Optional[Decimal] = None
    downtime_hours: Optional[float] = None
    downtime_cost_per_hour: Optional[Decimal] = None
    recovery_cost: Optional[Decimal] = None
    incident_response_cost: Optional[Decimal] = None
    regulatory_cost: Optional[Decimal] = None
    other_cost: Optional[Decimal] = None
    insurance_recovery: Optional[Decimal] = None
    mitigation_cost: Optional[Decimal] = None
    is_demo: bool
    created_at: UtcDatetime
    updated_at: UtcDatetime
    calculation: Optional[LossBreakdown] = None


# ---------------------------------------------------------------------------
# Cybersecurity intelligence
# ---------------------------------------------------------------------------


class CveLookupOut(BaseModel):
    cve_id: str
    source: str
    cached: bool
    description: Optional[str] = None
    published_at: Optional[UtcDatetime] = None
    cvss_score: Optional[float] = None
    cvss_severity: Optional[str] = None
    cvss_vector: Optional[str] = None
    epss_score: Optional[float] = None
    kev_listed: bool = False
    kev_due_date: Optional[date] = None
    kev_required_action: Optional[str] = None
    references: list[Any] = Field(default_factory=list)
    weaknesses: list[Any] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class FindingCreate(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    cve_id: Optional[str] = Field(default=None, max_length=30)
    asset_id: Optional[int] = None
    description: Optional[str] = None
    cvss_score: Optional[float] = Field(default=None, ge=0, le=10)
    cvss_severity: Optional[str] = Field(default=None, max_length=20)
    detected_at: Optional[datetime] = None
    vulnerability_age_days: Optional[int] = Field(default=None, ge=0)
    exploit_evidence: bool = False
    internet_exposed: bool = False
    remediation_status: domain.RemediationStatus = domain.RemediationStatus.OPEN
    remediation_reference: Optional[str] = Field(default=None, max_length=500)
    remediation_due_date: Optional[date] = None
    compensating_controls: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("cve_id")
    @classmethod
    def _normalise_cve(cls, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        return value.strip().upper()


class FindingUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=300)
    asset_id: Optional[int] = None
    description: Optional[str] = None
    cvss_score: Optional[float] = Field(default=None, ge=0, le=10)
    cvss_severity: Optional[str] = Field(default=None, max_length=20)
    detected_at: Optional[datetime] = None
    vulnerability_age_days: Optional[int] = Field(default=None, ge=0)
    exploit_evidence: Optional[bool] = None
    internet_exposed: Optional[bool] = None
    remediation_status: Optional[domain.RemediationStatus] = None
    remediation_reference: Optional[str] = Field(default=None, max_length=500)
    remediation_due_date: Optional[date] = None
    compensating_controls: Optional[str] = None
    notes: Optional[str] = None


class PriorityFactor(BaseModel):
    key: str
    label: str
    weight: float
    contribution: float
    detail: str


class FindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    organization_id: int
    asset_id: Optional[int] = None
    asset_name: Optional[str] = None
    cve_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    cvss_score: Optional[float] = None
    cvss_severity: Optional[str] = None
    detected_at: Optional[UtcDatetime] = None
    vulnerability_age_days: Optional[int] = None
    exploit_evidence: bool
    internet_exposed: bool
    remediation_status: str
    remediation_reference: Optional[str] = None
    remediation_due_date: Optional[date] = None
    compensating_controls: Optional[str] = None
    priority_score: Optional[float] = None
    priority_band: Optional[str] = None
    priority_factors: list[PriorityFactor] = Field(default_factory=list)
    notes: Optional[str] = None
    is_demo: bool
    created_at: UtcDatetime
    updated_at: UtcDatetime


class ImportErrorRow(BaseModel):
    row: int
    error: str


class ImportResultOut(BaseModel):
    batch_id: int
    filename: str
    rows_total: int
    rows_created: int
    rows_failed: int
    errors: list[ImportErrorRow] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# AI / ML
# ---------------------------------------------------------------------------


class FeatureContribution(BaseModel):
    key: str
    label: str
    value: Any = None
    contribution: float
    direction: Literal["increases_risk", "reduces_risk", "neutral"]


class PredictionOut(BaseModel):
    predicted_class: str
    rule_based_class: str
    agrees_with_rules: bool
    used_fallback: bool
    confidence: Optional[float] = None
    confidence_is_calibrated: bool = False
    class_probabilities: dict[str, float] = Field(default_factory=dict)
    model_version: str
    algorithm: str
    dataset_kind: str
    contributions: list[FeatureContribution] = Field(default_factory=list)
    increasing_factors: list[str] = Field(default_factory=list)
    reducing_factors: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    feature_values: dict[str, Any] = Field(default_factory=dict)
    risk_id: Optional[int] = None


class ModelVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    version: str
    algorithm: str
    target_label: str
    dataset_kind: str
    dataset_rows: int
    split_strategy: Optional[str] = None
    feature_schema: Optional[dict[str, Any]] = None
    class_labels: Optional[list[Any]] = None
    metrics: Optional[dict[str, Any]] = None
    confusion_matrix: Optional[dict[str, Any]] = None
    is_active: bool
    is_fallback: bool
    trained_at: Optional[UtcDatetime] = None
    limitations: Optional[str] = None
    notes: Optional[str] = None
    created_at: UtcDatetime


class TrainingRequest(BaseModel):
    """Retrain the priority-classification model from persisted risk history."""

    dataset: Literal["synthetic", "stored"] = "stored"
    activate: bool = True
    synthetic_rows: Optional[int] = Field(
        default=None,
        ge=40,
        le=5000,
        description="Row count for the synthetic dataset; ignored when dataset is 'stored'.",
    )


class TrainingOut(BaseModel):
    model: ModelVersionOut
    comparison: list[dict[str, Any]] = Field(default_factory=list)
    summary: str


class PredictRequest(BaseModel):
    """Ask the active model to classify one risk register entry."""

    risk_id: int = Field(gt=0, description="Risk register entry to classify.")
    persist: bool = Field(
        default=True,
        description="Record the prediction (and its explanation) in the audit trail.",
    )


class ModelStatusOut(BaseModel):
    """What the AI wall can honestly claim right now."""

    available: bool
    detail: str
    active_model: Optional[ModelVersionOut] = None
    optional_runtime: dict[str, bool] = Field(default_factory=dict)
    feature_schema: list[dict[str, Any]] = Field(default_factory=list)
    target_label: str
    target_description: str
    limitations: str
    minimum_training_rows: int
    stored_rows_available: int


# ---------------------------------------------------------------------------
# Insights, dashboard, reports, audit
# ---------------------------------------------------------------------------


class Insight(BaseModel):
    key: str
    title: str
    summary: str
    severity: str = domain.Severity.MEDIUM.value
    metric: Optional[str] = None
    items: list[dict[str, Any]] = Field(default_factory=list)
    basis: str = "deterministic"


class DashboardFilters(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    category: Optional[domain.RiskCategory] = None
    severity: Optional[domain.Severity] = None
    business_unit: Optional[str] = None
    asset_id: Optional[int] = None


class KpiValue(BaseModel):
    key: str
    label: str
    value: float
    unit: Optional[str] = None
    currency: Optional[str] = None
    trend: Optional[float] = None
    is_estimate: bool = False
    help_text: Optional[str] = None


class SeriesPoint(BaseModel):
    label: str
    value: float
    secondary: Optional[float] = None


class NamedSeries(BaseModel):
    name: str
    points: list[SeriesPoint]


class DashboardOut(BaseModel):
    organization: OrganizationOut
    generated_at: datetime
    filters: DashboardFilters
    kpis: list[KpiValue]
    risks_created_vs_resolved: NamedSeries
    risks_by_category: list[SeriesPoint]
    risks_by_severity: list[SeriesPoint]
    exposure_by_business_unit: list[SeriesPoint]
    assets_by_criticality: list[SeriesPoint]
    top_risks: list[RiskOut]
    recent_activity: list[dict[str, Any]]
    upcoming_mitigations: list[MitigationOut]
    data_state: Literal["empty", "demo_only", "populated"]
    notes: list[str] = Field(default_factory=list)


class ReportRequest(BaseModel):
    report_type: Literal[
        "executive_summary",
        "risk_register",
        "financial_exposure",
        "vulnerability_assessment",
        "asset_risk",
        "mitigation_progress",
        "model_evaluation",
        "scenario_comparison",
    ]
    format: Literal["csv", "pdf", "json"] = "pdf"
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    category: Optional[domain.RiskCategory] = None
    severity: Optional[domain.Severity] = None
    business_unit: Optional[str] = None


class ReportFigure(BaseModel):
    """One headline figure shown above a report table."""

    label: str
    value: str


class ReportCatalogEntry(BaseModel):
    """Describes an available report so the UI never hardcodes the list."""

    key: str
    title: str
    description: str


class ReportDatasetOut(BaseModel):
    """A report as data, for on-screen rendering before it is exported."""

    report_type: str
    title: str
    columns: list[str]
    rows: list[list[Any]]
    figures: list[ReportFigure] = Field(default_factory=list)
    methodology: str
    limitations: str
    row_count: int
    currency: str
    organization_id: int
    generated_at: UtcDatetime
    filters: dict[str, Any] = Field(default_factory=dict)


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    report_type: str
    format: str
    title: str
    reporting_period_start: Optional[date] = None
    reporting_period_end: Optional[date] = None
    row_count: int
    methodology: Optional[str] = None
    limitations: Optional[str] = None
    created_at: UtcDatetime


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: Optional[int] = None
    user_email: Optional[str] = None
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    detail: Optional[dict[str, Any]] = None
    ip_address: Optional[str] = None
    created_at: UtcDatetime


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    body: Optional[str] = None
    level: str
    link: Optional[str] = None
    is_read: bool
    created_at: UtcDatetime


# ---------------------------------------------------------------------------
# Preserved TILT third-party module
# ---------------------------------------------------------------------------


class QuestionnaireTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    position: int
    category: Optional[str] = None
    nist_control: Optional[str] = None
    policy_ref: Optional[str] = None
    text: str
    description: Optional[str] = None
    weight: Optional[str] = None
    criticality: Optional[str] = None
    points: Optional[int] = None
    osint_source: Optional[str] = None
    maturity_levels: Optional[dict[str, Any]] = None
    notes: Optional[str] = None


class QuestionnaireTemplateUpsert(BaseModel):
    position: int
    category: Optional[str] = None
    nist_control: Optional[str] = None
    policy_ref: Optional[str] = None
    text: str
    description: Optional[str] = None
    weight: Optional[str] = None
    criticality: Optional[str] = None
    points: Optional[int] = None
    osint_source: Optional[str] = None
    maturity_levels: Optional[dict[str, Any]] = None
    notes: Optional[str] = None


class VendorAssessmentBase(BaseModel):
    vendor_name: str = Field(min_length=2, max_length=200)
    primary_domain: Optional[str] = Field(default=None, max_length=255)
    status: str = Field(default="Pending", max_length=30)
    assessment_type: domain.TemplateKind = domain.TemplateKind.STANDARD
    data_classification: Optional[Scale15] = None
    answers: Optional[dict[str, Any]] = None
    cloud_scores: Optional[dict[str, Any]] = None
    weakness: Optional[str] = None
    strength: Optional[str] = None
    osint_urls: Optional[dict[str, Any]] = None


class VendorAssessmentCreate(VendorAssessmentBase):
    pass


class VendorAssessmentUpdate(BaseModel):
    vendor_name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    primary_domain: Optional[str] = Field(default=None, max_length=255)
    status: Optional[str] = Field(default=None, max_length=30)
    assessment_type: Optional[domain.TemplateKind] = None
    data_classification: Optional[Scale15] = None
    answers: Optional[dict[str, Any]] = None
    cloud_scores: Optional[dict[str, Any]] = None
    weakness: Optional[str] = None
    strength: Optional[str] = None
    osint_urls: Optional[dict[str, Any]] = None
    osint_acknowledged: Optional[bool] = None


class VendorAssessmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    organization_id: int
    vendor_name: str
    primary_domain: Optional[str] = None
    status: str
    assessment_type: str
    data_classification: Optional[int] = None
    answers: Optional[dict[str, Any]] = None
    cloud_scores: Optional[dict[str, Any]] = None
    impact: Optional[float] = None
    likelihood: Optional[float] = None
    vulnerability: Optional[float] = None
    inherent_score: Optional[int] = None
    severity: Optional[str] = None
    score: Optional[float] = None
    max_score: Optional[float] = None
    verdict: Optional[str] = None
    weakness: Optional[str] = None
    strength: Optional[str] = None
    osint_warnings: Optional[list[Any]] = None
    osint_urls: Optional[dict[str, Any]] = None
    osint_acknowledged: bool
    last_scanned_at: Optional[UtcDatetime] = None
    is_demo: bool
    created_at: UtcDatetime
    updated_at: UtcDatetime


class OsintScanOut(BaseModel):
    vendor: VendorAssessmentOut
    warnings: list[dict[str, Any]] = Field(default_factory=list)
    osint_results: dict[str, Any] = Field(default_factory=dict)
    live_checks_enabled: bool
    notes: list[str] = Field(default_factory=list)


RiskDetailOut.model_rebuild()
