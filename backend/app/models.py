"""Relational schema for FinRisk AI.

The schema is normalised around an *organization* tenant boundary.  Every
tenant-owned row carries ``organization_id`` and every query in the API layer is
scoped by it, which is what makes cross-tenant isolation enforceable server side.

Money is stored as ``NUMERIC(18, 2)`` together with an explicit ISO-4217
currency code: amounts in different currencies are never summed implicitly.
All timestamps are stored in UTC.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

import sqlalchemy as sa
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from . import domain


def utcnow() -> datetime:
    """Timezone-aware UTC now (single definition used by every default)."""
    return datetime.now(timezone.utc)


def as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Normalise a stored timestamp for comparison against :func:`utcnow`.

    Values are written as UTC, but some backends (SQLite in particular) return
    them without tzinfo.  Treating a naive value as UTC is what makes a
    comparison against an aware timestamp safe instead of raising ``TypeError``.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class Base(DeclarativeBase):
    """Declarative base with a deterministic constraint naming convention."""

    metadata = sa.MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class DemoMixin:
    """Marks rows created by the demonstration-data seeder."""

    is_demo: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)


class IDMixin:
    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True, autoincrement=True)


# ---------------------------------------------------------------------------
# Tenancy and identity
# ---------------------------------------------------------------------------


class Organization(Base, IDMixin, TimestampMixin, DemoMixin):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    slug: Mapped[str] = mapped_column(sa.String(120), nullable=False, unique=True)
    currency: Mapped[str] = mapped_column(sa.String(3), default="USD", nullable=False)
    industry: Mapped[Optional[str]] = mapped_column(sa.String(120))
    reporting_period_label: Mapped[Optional[str]] = mapped_column(sa.String(60))
    is_active: Mapped[bool] = mapped_column(sa.Boolean, default=True, nullable=False)

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )


class User(Base, IDMixin, TimestampMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(sa.String(255), nullable=False, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))
    #: Bumped on password change so previously issued tokens stop working.
    token_version: Mapped[int] = mapped_column(sa.Integer, default=0, nullable=False)

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Membership(Base, IDMixin, TimestampMixin):
    __tablename__ = "organization_memberships"
    __table_args__ = (
        sa.UniqueConstraint("user_id", "organization_id", name="uq_membership_user_org"),
    )

    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organization_id: Mapped[int] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(sa.String(30), default=domain.Role.VIEWER.value, nullable=False)
    job_title: Mapped[Optional[str]] = mapped_column(sa.String(120))

    user: Mapped["User"] = relationship(back_populates="memberships")
    organization: Mapped["Organization"] = relationship(back_populates="memberships")


# ---------------------------------------------------------------------------
# Asset registry
# ---------------------------------------------------------------------------


class Asset(Base, IDMixin, TimestampMixin, DemoMixin):
    __tablename__ = "assets"
    __table_args__ = (
        sa.UniqueConstraint("organization_id", "asset_ref", name="uq_asset_org_ref"),
        sa.Index("ix_asset_org_type", "organization_id", "asset_type"),
        sa.CheckConstraint("criticality BETWEEN 1 AND 5", name="criticality_range"),
        sa.CheckConstraint("data_sensitivity BETWEEN 1 AND 5", name="data_sensitivity_range"),
    )

    organization_id: Mapped[int] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_ref: Mapped[str] = mapped_column(sa.String(40), nullable=False)
    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(sa.Text)
    asset_type: Mapped[str] = mapped_column(sa.String(40), nullable=False)
    environment: Mapped[str] = mapped_column(sa.String(40), default=domain.Environment.PRODUCTION.value)
    business_unit: Mapped[Optional[str]] = mapped_column(sa.String(120), index=True)
    owner_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    criticality: Mapped[int] = mapped_column(sa.Integer, default=3, nullable=False)
    data_sensitivity: Mapped[int] = mapped_column(sa.Integer, default=3, nullable=False)
    internet_exposed: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    financial_importance: Mapped[Optional[Decimal]] = mapped_column(sa.Numeric(18, 2))
    currency: Mapped[str] = mapped_column(sa.String(3), default="USD", nullable=False)
    dependencies: Mapped[Optional[str]] = mapped_column(sa.Text)
    existing_controls: Mapped[Optional[str]] = mapped_column(sa.Text)
    last_assessed_at: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(sa.Boolean, default=True, nullable=False)

    risks: Mapped[list["Risk"]] = relationship(back_populates="asset")
    findings: Mapped[list["VulnerabilityFinding"]] = relationship(back_populates="asset")


# ---------------------------------------------------------------------------
# Risk register
# ---------------------------------------------------------------------------


class Risk(Base, IDMixin, TimestampMixin, DemoMixin):
    __tablename__ = "risks"
    __table_args__ = (
        sa.UniqueConstraint("organization_id", "risk_ref", name="uq_risk_org_ref"),
        sa.Index("ix_risk_org_status", "organization_id", "status"),
        sa.Index("ix_risk_org_category", "organization_id", "category"),
        sa.CheckConstraint("likelihood BETWEEN 1 AND 5", name="likelihood_range"),
        sa.CheckConstraint("impact BETWEEN 1 AND 5", name="impact_range"),
        sa.CheckConstraint(
            "residual_likelihood IS NULL OR residual_likelihood BETWEEN 1 AND 5",
            name="residual_likelihood_range",
        ),
        sa.CheckConstraint(
            "residual_impact IS NULL OR residual_impact BETWEEN 1 AND 5",
            name="residual_impact_range",
        ),
    )

    organization_id: Mapped[int] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    risk_ref: Mapped[str] = mapped_column(sa.String(40), nullable=False)
    title: Mapped[str] = mapped_column(sa.String(250), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(sa.Text)
    category: Mapped[str] = mapped_column(sa.String(40), nullable=False, index=True)
    source: Mapped[Optional[str]] = mapped_column(sa.String(120))
    asset_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("assets.id", ondelete="SET NULL"))
    business_unit: Mapped[Optional[str]] = mapped_column(sa.String(120), index=True)
    owner_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    threat_scenario: Mapped[Optional[str]] = mapped_column(sa.Text)

    likelihood: Mapped[int] = mapped_column(sa.Integer, default=3, nullable=False)
    impact: Mapped[int] = mapped_column(sa.Integer, default=3, nullable=False)
    financial_impact_assumptions: Mapped[Optional[str]] = mapped_column(sa.Text)
    existing_controls: Mapped[Optional[str]] = mapped_column(sa.Text)
    mitigation_plan: Mapped[Optional[str]] = mapped_column(sa.Text)

    residual_likelihood: Mapped[Optional[int]] = mapped_column(sa.Integer)
    residual_impact: Mapped[Optional[int]] = mapped_column(sa.Integer)

    status: Mapped[str] = mapped_column(
        sa.String(30), default=domain.RiskStatus.IDENTIFIED.value, nullable=False, index=True
    )
    evidence_quality: Mapped[str] = mapped_column(
        sa.String(20), default=domain.EvidenceQuality.MEDIUM.value, nullable=False
    )
    due_date: Mapped[Optional[date]] = mapped_column(sa.Date, index=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))

    @property
    def inherent_score(self) -> int:
        return domain.risk_score(self.likelihood, self.impact)

    @property
    def residual_score(self) -> Optional[int]:
        if self.residual_likelihood is None or self.residual_impact is None:
            return None
        return domain.risk_score(self.residual_likelihood, self.residual_impact)

    @property
    def severity(self) -> str:
        return domain.severity_from_score(self.inherent_score)

    @property
    def residual_severity(self) -> Optional[str]:
        score = self.residual_score
        return domain.severity_from_score(score) if score is not None else None

    asset: Mapped[Optional["Asset"]] = relationship(back_populates="risks")
    owner: Mapped[Optional["User"]] = relationship()
    assessments: Mapped[list["RiskAssessment"]] = relationship(
        back_populates="risk", cascade="all, delete-orphan"
    )
    evidence: Mapped[list["EvidenceRecord"]] = relationship(
        back_populates="risk", cascade="all, delete-orphan"
    )
    mitigations: Mapped[list["Mitigation"]] = relationship(
        back_populates="risk", cascade="all, delete-orphan"
    )
    scenarios: Mapped[list["FinancialScenario"]] = relationship(
        back_populates="risk", cascade="all, delete-orphan"
    )


class RiskAssessment(Base, IDMixin, TimestampMixin):
    """Immutable history of how a risk was scored over time."""

    __tablename__ = "risk_assessments"
    __table_args__ = (sa.Index("ix_assessment_risk_time", "risk_id", "assessed_at"),)

    organization_id: Mapped[int] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    risk_id: Mapped[int] = mapped_column(
        sa.ForeignKey("risks.id", ondelete="CASCADE"), nullable=False
    )
    assessor_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    assessed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), default=utcnow, nullable=False)

    method: Mapped[str] = mapped_column(sa.String(20), default=domain.AssessmentMethod.RULES.value)
    likelihood: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    impact: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    inherent_score: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    residual_likelihood: Mapped[Optional[int]] = mapped_column(sa.Integer)
    residual_impact: Mapped[Optional[int]] = mapped_column(sa.Integer)
    residual_score: Mapped[Optional[int]] = mapped_column(sa.Integer)
    confidence: Mapped[Optional[float]] = mapped_column(sa.Float)
    expected_loss: Mapped[Optional[Decimal]] = mapped_column(sa.Numeric(18, 2))
    currency: Mapped[Optional[str]] = mapped_column(sa.String(3))
    notes: Mapped[Optional[str]] = mapped_column(sa.Text)
    model_version: Mapped[Optional[str]] = mapped_column(sa.String(40))

    risk: Mapped["Risk"] = relationship(back_populates="assessments")


class EvidenceRecord(Base, IDMixin, TimestampMixin, DemoMixin):
    __tablename__ = "evidence_records"

    organization_id: Mapped[int] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    risk_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("risks.id", ondelete="CASCADE"), index=True)
    asset_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("assets.id", ondelete="SET NULL"))
    created_by_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))

    title: Mapped[str] = mapped_column(sa.String(250), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(sa.Text)
    evidence_type: Mapped[str] = mapped_column(sa.String(40), default="document")
    source_url: Mapped[Optional[str]] = mapped_column(sa.String(500))
    quality: Mapped[str] = mapped_column(
        sa.String(20), default=domain.EvidenceQuality.MEDIUM.value, nullable=False
    )
    collected_at: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))

    risk: Mapped[Optional["Risk"]] = relationship(back_populates="evidence")


# ---------------------------------------------------------------------------
# Financial exposure
# ---------------------------------------------------------------------------


class FinancialScenario(Base, IDMixin, TimestampMixin, DemoMixin):
    """A documented loss scenario.

    Every monetary column is paired with the scenario ``currency``.  Undefined
    amounts must be left as ``NULL`` rather than ``0`` so that the engine can
    distinguish "no revenue loss expected" from "not estimated".
    """

    __tablename__ = "financial_scenarios"
    __table_args__ = (sa.Index("ix_scenario_org_risk", "organization_id", "risk_id"),)

    organization_id: Mapped[int] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    risk_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("risks.id", ondelete="CASCADE"), index=True)
    asset_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("assets.id", ondelete="SET NULL"))
    created_by_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))

    name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    scenario_type: Mapped[str] = mapped_column(
        sa.String(20), default=domain.ScenarioType.BASE_CASE.value, nullable=False
    )
    description: Mapped[Optional[str]] = mapped_column(sa.Text)
    assumptions: Mapped[Optional[str]] = mapped_column(sa.Text)

    currency: Mapped[str] = mapped_column(sa.String(3), default="USD", nullable=False)
    time_horizon_months: Mapped[int] = mapped_column(sa.Integer, default=12, nullable=False)
    #: Annualised probability of the scenario occurring, 0-1.
    probability: Mapped[float] = mapped_column(sa.Float, default=0.1, nullable=False)
    #: Share of the scenario probability that survives once mitigation is applied, 0-1.
    residual_probability: Mapped[Optional[float]] = mapped_column(sa.Float)

    direct_loss: Mapped[Optional[Decimal]] = mapped_column(sa.Numeric(18, 2))
    revenue_loss: Mapped[Optional[Decimal]] = mapped_column(sa.Numeric(18, 2))
    downtime_hours: Mapped[Optional[float]] = mapped_column(sa.Float)
    downtime_cost_per_hour: Mapped[Optional[Decimal]] = mapped_column(sa.Numeric(18, 2))
    recovery_cost: Mapped[Optional[Decimal]] = mapped_column(sa.Numeric(18, 2))
    incident_response_cost: Mapped[Optional[Decimal]] = mapped_column(sa.Numeric(18, 2))
    regulatory_cost: Mapped[Optional[Decimal]] = mapped_column(sa.Numeric(18, 2))
    other_cost: Mapped[Optional[Decimal]] = mapped_column(sa.Numeric(18, 2))
    insurance_recovery: Mapped[Optional[Decimal]] = mapped_column(sa.Numeric(18, 2))
    mitigation_cost: Mapped[Optional[Decimal]] = mapped_column(sa.Numeric(18, 2))

    risk: Mapped[Optional["Risk"]] = relationship(back_populates="scenarios")


# ---------------------------------------------------------------------------
# Cybersecurity intelligence
# ---------------------------------------------------------------------------


class Vulnerability(Base, IDMixin, TimestampMixin):
    """Cached upstream CVE record (NVD / CISA KEV). Never fabricated locally."""

    __tablename__ = "vulnerabilities"

    cve_id: Mapped[str] = mapped_column(sa.String(30), nullable=False, unique=True, index=True)
    description: Mapped[Optional[str]] = mapped_column(sa.Text)
    published_at: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))
    last_modified_at: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))
    cvss_score: Mapped[Optional[float]] = mapped_column(sa.Float)
    cvss_severity: Mapped[Optional[str]] = mapped_column(sa.String(20))
    cvss_vector: Mapped[Optional[str]] = mapped_column(sa.String(120))
    epss_score: Mapped[Optional[float]] = mapped_column(sa.Float)
    epss_percentile: Mapped[Optional[float]] = mapped_column(sa.Float)
    kev_listed: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    kev_due_date: Mapped[Optional[date]] = mapped_column(sa.Date)
    kev_required_action: Mapped[Optional[str]] = mapped_column(sa.Text)
    references: Mapped[Optional[list[Any]]] = mapped_column(sa.JSON)
    weaknesses: Mapped[Optional[list[Any]]] = mapped_column(sa.JSON)
    affected_products: Mapped[Optional[list[Any]]] = mapped_column(sa.JSON)
    source: Mapped[str] = mapped_column(sa.String(40), default="nvd", nullable=False)
    fetched_at: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))


class VulnerabilityFinding(Base, IDMixin, TimestampMixin, DemoMixin):
    """A CVE observed on one of *our* assets (the actionable record)."""

    __tablename__ = "vulnerability_findings"
    __table_args__ = (
        sa.Index("ix_finding_org_status", "organization_id", "remediation_status"),
        sa.Index("ix_finding_org_asset", "organization_id", "asset_id"),
    )

    organization_id: Mapped[int] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    vulnerability_id: Mapped[Optional[int]] = mapped_column(
        sa.ForeignKey("vulnerabilities.id", ondelete="SET NULL")
    )
    asset_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("assets.id", ondelete="SET NULL"), index=True)
    created_by_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))

    cve_id: Mapped[Optional[str]] = mapped_column(sa.String(30), index=True)
    title: Mapped[str] = mapped_column(sa.String(300), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(sa.Text)
    cvss_score: Mapped[Optional[float]] = mapped_column(sa.Float)
    cvss_severity: Mapped[Optional[str]] = mapped_column(sa.String(20))
    detected_at: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))
    vulnerability_age_days: Mapped[Optional[int]] = mapped_column(sa.Integer)
    exploit_evidence: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    internet_exposed: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    remediation_status: Mapped[str] = mapped_column(
        sa.String(30), default=domain.RemediationStatus.OPEN.value, nullable=False
    )
    remediation_reference: Mapped[Optional[str]] = mapped_column(sa.String(500))
    remediation_due_date: Mapped[Optional[date]] = mapped_column(sa.Date)
    compensating_controls: Mapped[Optional[str]] = mapped_column(sa.Text)
    #: Deterministic context-aware score (documented in docs/RISK_MATRIX_ALGORITHM.txt).
    priority_score: Mapped[Optional[float]] = mapped_column(sa.Float)
    priority_band: Mapped[Optional[str]] = mapped_column(sa.String(20))
    priority_factors: Mapped[Optional[dict[str, Any]]] = mapped_column(sa.JSON)
    notes: Mapped[Optional[str]] = mapped_column(sa.Text)

    asset: Mapped[Optional["Asset"]] = relationship(back_populates="findings")
    vulnerability: Mapped[Optional["Vulnerability"]] = relationship()


class ImportBatch(Base, IDMixin, TimestampMixin):
    """Audit trail for scanner/report imports (CSV)."""

    __tablename__ = "import_batches"

    organization_id: Mapped[int] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploaded_by_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    filename: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    rows_total: Mapped[int] = mapped_column(sa.Integer, default=0, nullable=False)
    rows_created: Mapped[int] = mapped_column(sa.Integer, default=0, nullable=False)
    rows_failed: Mapped[int] = mapped_column(sa.Integer, default=0, nullable=False)
    errors: Mapped[Optional[list[Any]]] = mapped_column(sa.JSON)


# ---------------------------------------------------------------------------
# Mitigation management
# ---------------------------------------------------------------------------


class Mitigation(Base, IDMixin, TimestampMixin, DemoMixin):
    __tablename__ = "mitigations"
    __table_args__ = (sa.Index("ix_mitigation_org_status", "organization_id", "status"),)

    organization_id: Mapped[int] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    risk_id: Mapped[int] = mapped_column(sa.ForeignKey("risks.id", ondelete="CASCADE"), nullable=False, index=True)
    action_ref: Mapped[str] = mapped_column(sa.String(40), nullable=False)
    description: Mapped[str] = mapped_column(sa.Text, nullable=False)
    priority: Mapped[str] = mapped_column(sa.String(20), default=domain.Severity.MEDIUM.value, nullable=False)
    assigned_user_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    due_date: Mapped[Optional[date]] = mapped_column(sa.Date, index=True)
    estimated_cost: Mapped[Optional[Decimal]] = mapped_column(sa.Numeric(18, 2))
    currency: Mapped[str] = mapped_column(sa.String(3), default="USD", nullable=False)
    status: Mapped[str] = mapped_column(
        sa.String(20), default=domain.MitigationStatus.PLANNED.value, nullable=False
    )
    #: Expected reduction of the inherent score, expressed as a share 0-1.
    expected_risk_reduction: Mapped[Optional[float]] = mapped_column(sa.Float)
    evidence: Mapped[Optional[str]] = mapped_column(sa.Text)
    completion_notes: Mapped[Optional[str]] = mapped_column(sa.Text)
    completed_at: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))

    risk: Mapped["Risk"] = relationship(back_populates="mitigations")
    assigned_user: Mapped[Optional["User"]] = relationship()


# ---------------------------------------------------------------------------
# AI / ML bookkeeping
# ---------------------------------------------------------------------------


class ModelVersion(Base, IDMixin, TimestampMixin):
    __tablename__ = "model_versions"

    version: Mapped[str] = mapped_column(sa.String(40), nullable=False, unique=True)
    algorithm: Mapped[str] = mapped_column(sa.String(60), nullable=False)
    target_label: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    dataset_kind: Mapped[str] = mapped_column(
        sa.String(30), default=domain.DatasetKind.SYNTHETIC_DEMO.value, nullable=False
    )
    dataset_rows: Mapped[int] = mapped_column(sa.Integer, default=0, nullable=False)
    split_strategy: Mapped[Optional[str]] = mapped_column(sa.String(120))
    feature_schema: Mapped[Optional[dict[str, Any]]] = mapped_column(sa.JSON)
    class_labels: Mapped[Optional[list[Any]]] = mapped_column(sa.JSON)
    metrics: Mapped[Optional[dict[str, Any]]] = mapped_column(sa.JSON)
    confusion_matrix: Mapped[Optional[dict[str, Any]]] = mapped_column(sa.JSON)
    artifact_path: Mapped[Optional[str]] = mapped_column(sa.String(500))
    is_active: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    is_fallback: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    trained_at: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))
    limitations: Mapped[Optional[str]] = mapped_column(sa.Text)
    notes: Mapped[Optional[str]] = mapped_column(sa.Text)


class ModelPrediction(Base, IDMixin, TimestampMixin):
    __tablename__ = "model_predictions"
    __table_args__ = (sa.Index("ix_prediction_org_risk", "organization_id", "risk_id"),)

    organization_id: Mapped[int] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    risk_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("risks.id", ondelete="CASCADE"))
    model_version_id: Mapped[Optional[int]] = mapped_column(
        sa.ForeignKey("model_versions.id", ondelete="SET NULL")
    )
    requested_by_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))

    predicted_class: Mapped[str] = mapped_column(sa.String(20), nullable=False)
    rule_based_class: Mapped[Optional[str]] = mapped_column(sa.String(20))
    used_fallback: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    confidence: Mapped[Optional[float]] = mapped_column(sa.Float)
    class_probabilities: Mapped[Optional[dict[str, Any]]] = mapped_column(sa.JSON)
    explanation: Mapped[Optional[dict[str, Any]]] = mapped_column(sa.JSON)
    feature_values: Mapped[Optional[dict[str, Any]]] = mapped_column(sa.JSON)
    recommendations: Mapped[Optional[list[Any]]] = mapped_column(sa.JSON)
    warnings: Mapped[Optional[list[Any]]] = mapped_column(sa.JSON)

    model_version: Mapped[Optional["ModelVersion"]] = relationship()


# ---------------------------------------------------------------------------
# Collaboration, reporting and auditability
# ---------------------------------------------------------------------------


class Notification(Base, IDMixin, TimestampMixin):
    __tablename__ = "notifications"
    __table_args__ = (sa.Index("ix_notification_org_read", "organization_id", "is_read"),)

    organization_id: Mapped[int] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(sa.String(250), nullable=False)
    body: Mapped[Optional[str]] = mapped_column(sa.Text)
    level: Mapped[str] = mapped_column(sa.String(20), default="info", nullable=False)
    link: Mapped[Optional[str]] = mapped_column(sa.String(300))
    is_read: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)


class AuditLog(Base, IDMixin):
    __tablename__ = "audit_logs"
    __table_args__ = (sa.Index("ix_audit_org_time", "organization_id", "created_at"),)

    organization_id: Mapped[Optional[int]] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    user_email: Mapped[Optional[str]] = mapped_column(sa.String(255))
    action: Mapped[str] = mapped_column(sa.String(60), nullable=False, index=True)
    entity_type: Mapped[Optional[str]] = mapped_column(sa.String(60))
    entity_id: Mapped[Optional[str]] = mapped_column(sa.String(60))
    detail: Mapped[Optional[dict[str, Any]]] = mapped_column(sa.JSON)
    ip_address: Mapped[Optional[str]] = mapped_column(sa.String(64))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )


class GeneratedReport(Base, IDMixin, TimestampMixin):
    """Metadata for a report that was rendered from persisted records."""

    __tablename__ = "generated_reports"

    organization_id: Mapped[int] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    generated_by_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    report_type: Mapped[str] = mapped_column(sa.String(60), nullable=False)
    format: Mapped[str] = mapped_column(sa.String(10), nullable=False)
    title: Mapped[str] = mapped_column(sa.String(250), nullable=False)
    reporting_period_start: Mapped[Optional[date]] = mapped_column(sa.Date)
    reporting_period_end: Mapped[Optional[date]] = mapped_column(sa.Date)
    parameters: Mapped[Optional[dict[str, Any]]] = mapped_column(sa.JSON)
    row_count: Mapped[int] = mapped_column(sa.Integer, default=0, nullable=False)
    methodology: Mapped[Optional[str]] = mapped_column(sa.Text)
    limitations: Mapped[Optional[str]] = mapped_column(sa.Text)


# ---------------------------------------------------------------------------
# Preserved TILT third-party assessment module
# ---------------------------------------------------------------------------


class QuestionnaireTemplate(Base, IDMixin, TimestampMixin):
    """Question / criterion definitions for the two TILT questionnaires."""

    __tablename__ = "questionnaire_templates"
    __table_args__ = (
        sa.UniqueConstraint("kind", "position", name="uq_template_kind_position"),
    )

    kind: Mapped[str] = mapped_column(sa.String(20), nullable=False, index=True)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(sa.String(120))
    nist_control: Mapped[Optional[str]] = mapped_column(sa.String(120))
    policy_ref: Mapped[Optional[str]] = mapped_column(sa.String(120))
    text: Mapped[str] = mapped_column(sa.Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(sa.Text)
    weight: Mapped[Optional[str]] = mapped_column(sa.String(20))
    criticality: Mapped[Optional[str]] = mapped_column(sa.String(20))
    points: Mapped[Optional[int]] = mapped_column(sa.Integer)
    osint_source: Mapped[Optional[str]] = mapped_column(sa.String(120))
    maturity_levels: Mapped[Optional[dict[str, Any]]] = mapped_column(sa.JSON)
    notes: Mapped[Optional[str]] = mapped_column(sa.Text)


class VendorAssessment(Base, IDMixin, TimestampMixin, DemoMixin):
    """A TILT assessment for one third-party vendor / cloud service."""

    __tablename__ = "vendor_assessments"
    __table_args__ = (sa.Index("ix_vendor_org_status", "organization_id", "status"),)

    organization_id: Mapped[int] = mapped_column(
        sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("assets.id", ondelete="SET NULL"))
    created_by_id: Mapped[Optional[int]] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))

    vendor_name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    primary_domain: Mapped[Optional[str]] = mapped_column(sa.String(255))
    status: Mapped[str] = mapped_column(sa.String(30), default="Pending", nullable=False)
    assessment_type: Mapped[str] = mapped_column(sa.String(20), default=domain.TemplateKind.STANDARD.value)
    data_classification: Mapped[Optional[int]] = mapped_column(sa.Integer)

    answers: Mapped[Optional[dict[str, Any]]] = mapped_column(sa.JSON)
    cloud_scores: Mapped[Optional[dict[str, Any]]] = mapped_column(sa.JSON)
    impact: Mapped[Optional[float]] = mapped_column(sa.Float)
    likelihood: Mapped[Optional[float]] = mapped_column(sa.Float)
    vulnerability: Mapped[Optional[float]] = mapped_column(sa.Float)
    inherent_score: Mapped[Optional[int]] = mapped_column(sa.Integer)
    score: Mapped[Optional[float]] = mapped_column(sa.Float)
    max_score: Mapped[Optional[float]] = mapped_column(sa.Float)
    verdict: Mapped[Optional[str]] = mapped_column(sa.String(120))
    weakness: Mapped[Optional[str]] = mapped_column(sa.Text)
    strength: Mapped[Optional[str]] = mapped_column(sa.Text)

    osint_warnings: Mapped[Optional[list[Any]]] = mapped_column(sa.JSON)
    osint_urls: Mapped[Optional[dict[str, Any]]] = mapped_column(sa.JSON)
    osint_acknowledged: Mapped[bool] = mapped_column(sa.Boolean, default=False, nullable=False)
    last_scanned_at: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))


class SchemaMigration(Base, IDMixin):
    """Applied migration marker (see ``db.run_migrations``)."""

    __tablename__ = "schema_migrations"

    revision: Mapped[str] = mapped_column(sa.String(60), nullable=False, unique=True)
    applied_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), default=utcnow, nullable=False
    )
    note: Mapped[Optional[str]] = mapped_column(sa.String(255))
