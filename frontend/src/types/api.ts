/**
 * Types mirroring the FastAPI response schemas.
 *
 * Hand-written rather than generated: the surface is small enough to keep in
 * step by hand, and a hand-written file can carry the comments that explain
 * *why* a field is nullable (most of them are nullable because the backend
 * refuses to invent a value it does not have).
 *
 * Money is always transported as a decimal *string* with a separate ISO-4217
 * currency code, so it is typed as `string | null` and never parsed into a
 * float by accident.
 */

// ---------------------------------------------------------------------------
// Enumerations (see backend app/domain.py)
// ---------------------------------------------------------------------------

export type Role = 'admin' | 'risk_manager' | 'analyst' | 'viewer';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type RiskCategory =
  | 'cybersecurity'
  | 'financial'
  | 'operational'
  | 'third_party'
  | 'regulatory'
  | 'business_continuity'
  | 'technology';
export type RiskStatus =
  | 'identified'
  | 'under_assessment'
  | 'mitigation_planned'
  | 'in_progress'
  | 'accepted'
  | 'resolved'
  | 'closed';
export type EvidenceQuality = 'none' | 'low' | 'medium' | 'high' | 'verified';
export type AssetType =
  | 'application'
  | 'database'
  | 'network'
  | 'endpoint'
  | 'cloud_service'
  | 'third_party_service'
  | 'business_process'
  | 'facility'
  | 'identity'
  | 'data_store';
export type Environment =
  | 'production'
  | 'staging'
  | 'development'
  | 'disaster_recovery'
  | 'corporate';
export type MitigationStatus =
  | 'planned'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'cancelled';
export type RemediationStatus =
  | 'open'
  | 'in_progress'
  | 'remediated'
  | 'accepted_risk'
  | 'false_positive';
export type ScenarioType = 'best_case' | 'base_case' | 'worst_case';
export type TemplateKind = 'standard' | 'cloud';
export type NotificationLevel = 'info' | 'success' | 'warning' | 'critical';
export type ReportTypeKey =
  | 'executive_summary'
  | 'risk_register'
  | 'financial_exposure'
  | 'vulnerability_assessment'
  | 'asset_risk'
  | 'mitigation_progress'
  | 'model_evaluation'
  | 'scenario_comparison';

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface Message {
  message: string;
  detail?: string | null;
}

/** Query params accepted by every list endpoint that uses Paging. */
export interface Paging {
  page?: number;
  page_size?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface FilterOption {
  value: string;
  label: string;
}

/** Shape of a validation error raised by FastAPI. */
export interface ApiErrorBody {
  detail?:
    | string
    | Array<{ loc: (string | number)[]; msg: string; type: string }>;
}

// ---------------------------------------------------------------------------
// Identity and tenancy
// ---------------------------------------------------------------------------

export interface UserOut {
  id: number;
  email: string;
  full_name: string;
  is_active: boolean;
  last_login_at?: string | null;
  created_at: string;
}

export interface OrganizationOut {
  id: number;
  name: string;
  slug: string;
  currency: string;
  industry?: string | null;
  reporting_period_label?: string | null;
  is_demo?: boolean;
  created_at: string;
  role?: string | null;
  member_count?: number | null;
}

export interface SessionContext {
  user: UserOut;
  organizations: OrganizationOut[];
  active_organization_id?: number | null;
  role?: string | null;
  permissions?: string[];
}

export interface TokenResponse extends SessionContext {
  access_token: string;
  token_type: string;
  expires_at: string;
}

export interface MemberOut {
  id: number;
  user_id: number;
  email: string;
  full_name: string;
  role: Role;
  job_title?: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface Asset {
  id: number;
  organization_id: number;
  asset_ref: string;
  name: string;
  description?: string | null;
  asset_type: AssetType;
  environment: Environment;
  business_unit?: string | null;
  owner_id?: number | null;
  owner_name?: string | null;
  criticality: number;
  data_sensitivity: number;
  internet_exposed: boolean;
  /** Decimal string; null means "not valued", which is not the same as zero. */
  financial_importance?: string | null;
  currency: string;
  dependencies?: string | null;
  existing_controls?: string | null;
  last_assessed_at?: string | null;
  is_active: boolean;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  open_risks?: number;
  open_findings?: number;
  severity?: Severity | null;
}

// ---------------------------------------------------------------------------
// Risks
// ---------------------------------------------------------------------------

export interface Risk {
  id: number;
  organization_id: number;
  risk_ref: string;
  title: string;
  description?: string | null;
  category: RiskCategory;
  source?: string | null;
  asset_id?: number | null;
  asset_name?: string | null;
  business_unit?: string | null;
  owner_id?: number | null;
  owner_name?: string | null;
  threat_scenario?: string | null;
  likelihood: number;
  impact: number;
  /** Deterministic likelihood x impact, 1..25. */
  inherent_score: number;
  severity: Severity;
  /** Null until somebody records a post-treatment assessment. */
  residual_likelihood?: number | null;
  residual_impact?: number | null;
  residual_score?: number | null;
  residual_severity?: Severity | null;
  financial_impact_assumptions?: string | null;
  existing_controls?: string | null;
  mitigation_plan?: string | null;
  status: RiskStatus;
  evidence_quality: EvidenceQuality;
  due_date?: string | null;
  closed_at?: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  mitigation_count?: number;
  completed_mitigation_count?: number;
  expected_gross_exposure?: string | null;
  expected_residual_exposure?: string | null;
  currency?: string | null;
}

export interface EvidenceRecord {
  id: number;
  risk_id?: number | null;
  asset_id?: number | null;
  title: string;
  description?: string | null;
  evidence_type: string;
  source_url?: string | null;
  quality: EvidenceQuality;
  collected_at?: string | null;
  created_at: string;
}

export interface RiskAssessmentOut {
  id: number;
  risk_id: number;
  assessed_at: string;
  method: string;
  likelihood: number;
  impact: number;
  inherent_score: number;
  residual_likelihood?: number | null;
  residual_impact?: number | null;
  residual_score?: number | null;
  confidence?: number | null;
  expected_loss?: string | null;
  currency?: string | null;
  notes?: string | null;
  model_version?: string | null;
}

export interface RiskDetail extends Risk {
  evidence?: EvidenceRecord[];
  assessments?: RiskAssessmentOut[];
  mitigations?: Mitigation[];
}

/**
 * `/api/risks/meta` vocabularies.
 *
 * The backend returns bare enum values rather than `{value,label}` pairs, so a
 * screen turns them into select options with `toOptions()` and lets `humanise`
 * produce the label. Only business units are organization-specific.
 */
export interface RiskMeta {
  categories: string[];
  statuses: string[];
  severities: string[];
  evidence_quality: string[];
  open_statuses: string[];
  /** Inclusive `[low, high]` score bounds, keyed by severity. */
  severity_bands: Record<string, [number, number]>;
  business_units: string[];
}

// ---------------------------------------------------------------------------
// Mitigations
// ---------------------------------------------------------------------------

export interface Mitigation {
  id: number;
  organization_id: number;
  risk_id: number;
  risk_ref?: string | null;
  risk_title?: string | null;
  action_ref: string;
  description: string;
  priority: Severity;
  assigned_user_id?: number | null;
  assigned_user_name?: string | null;
  due_date?: string | null;
  estimated_cost?: string | null;
  currency: string;
  status: MitigationStatus;
  expected_risk_reduction?: number | null;
  evidence?: string | null;
  completion_notes?: string | null;
  completed_at?: string | null;
  is_demo: boolean;
  is_overdue?: boolean;
  created_at: string;
  updated_at: string;
}

export interface MitigationStatusResult {
  mitigation: Mitigation;
  risk_residual_score?: number | null;
  residual_severity?: Severity | null;
  /** The backend's own wording of why completing work is not the same as removing risk. */
  note: string;
}

export interface MitigationMeta {
  statuses: string[];
  priorities: string[];
  /** Statuses that close an action and therefore trigger the residual-score check. */
  final_statuses: string[];
}

/** Row shape of `/api/risks/options`, reused wherever a risk must be picked. */
export interface RiskOption {
  id: number;
  risk_ref: string;
  title: string;
}

/** Row shape of `/api/assets/options`. */
export interface AssetOption {
  id: number;
  asset_ref: string;
  name: string;
  criticality?: number;
}

// ---------------------------------------------------------------------------
// Financial scenarios
// ---------------------------------------------------------------------------

export interface LossComponent {
  label: string;
  amount: string;
  note?: string | null;
}

export interface LossBreakdown {
  currency: string;
  time_horizon_months: number;
  probability: number;
  residual_probability?: number | null;
  components: LossComponent[];
  gross_loss: string;
  total_recoveries: string;
  net_loss: string;
  expected_loss: string;
  expected_residual_loss: string;
  potential_avoided_loss: string;
  return_on_mitigation?: number | null;
  mitigation_cost: string;
  notes?: string[];
}

export interface SensitivityPoint {
  label: string;
  probability: number;
  net_loss: string;
  expected_loss: string;
}

export interface SensitivityAnalysis {
  currency: string;
  baseline_probability: number;
  baseline_expected_loss: string;
  probability_sweep: SensitivityPoint[];
  net_loss_sweep: SensitivityPoint[];
  break_even_probability?: number | null;
}

export interface ScenarioCalculation {
  breakdown: LossBreakdown;
  sensitivity: SensitivityAnalysis;
}

export interface FinancialScenario {
  id: number;
  organization_id: number;
  name: string;
  scenario_type: ScenarioType;
  risk_id?: number | null;
  risk_ref?: string | null;
  risk_title?: string | null;
  asset_id?: number | null;
  asset_name?: string | null;
  description?: string | null;
  assumptions?: string | null;
  currency: string;
  time_horizon_months: number;
  probability: number;
  residual_probability?: number | null;
  direct_loss?: string | null;
  revenue_loss?: string | null;
  downtime_hours?: number | null;
  downtime_cost_per_hour?: string | null;
  recovery_cost?: string | null;
  incident_response_cost?: string | null;
  regulatory_cost?: string | null;
  other_cost?: string | null;
  insurance_recovery?: string | null;
  mitigation_cost?: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  calculation?: LossBreakdown | null;
}

/** Every money field is optional: an unestimated input must stay unestimated. */
export interface ScenarioInputs {
  currency?: string;
  time_horizon_months?: number;
  probability?: number;
  residual_probability?: number | null;
  direct_loss?: string | number | null;
  revenue_loss?: string | number | null;
  downtime_hours?: number | null;
  downtime_cost_per_hour?: string | number | null;
  recovery_cost?: string | number | null;
  incident_response_cost?: string | number | null;
  regulatory_cost?: string | number | null;
  other_cost?: string | number | null;
  insurance_recovery?: string | number | null;
  mitigation_cost?: string | number | null;
}

export interface ScenarioCreate extends ScenarioInputs {
  name: string;
  scenario_type?: ScenarioType;
  risk_id?: number | null;
  asset_id?: number | null;
  description?: string | null;
  assumptions?: string | null;
}

export interface ScenarioMeta {
  scenario_types: string[];
  organization_currency: string;
  /** Plain-language loss formula, supplied by the backend so the UI cannot rewrite it. */
  formula: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Vulnerability findings
// ---------------------------------------------------------------------------

export interface PriorityFactor {
  key: string;
  label: string;
  weight: number;
  contribution: number;
  detail: string;
}

export interface Finding {
  id: number;
  organization_id: number;
  asset_id?: number | null;
  asset_name?: string | null;
  cve_id?: string | null;
  title: string;
  description?: string | null;
  cvss_score?: number | null;
  cvss_severity?: string | null;
  detected_at?: string | null;
  vulnerability_age_days?: number | null;
  exploit_evidence: boolean;
  internet_exposed: boolean;
  remediation_status: RemediationStatus;
  remediation_reference?: string | null;
  remediation_due_date?: string | null;
  compensating_controls?: string | null;
  /** The platform's own priority score. Deliberately never presented as CVSS. */
  priority_score?: number | null;
  priority_band?: Severity | null;
  priority_factors?: PriorityFactor[];
  notes?: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface CveLookup {
  cve_id: string;
  source: string;
  cached: boolean;
  description?: string | null;
  published_at?: string | null;
  cvss_score?: number | null;
  cvss_severity?: string | null;
  cvss_vector?: string | null;
  epss_score?: number | null;
  kev_listed?: boolean;
  kev_due_date?: string | null;
  kev_required_action?: string | null;
  references?: Array<Record<string, unknown>>;
  weaknesses?: Array<Record<string, unknown>>;
  warnings?: string[];
}

export interface ImportErrorRow {
  row: number;
  error: string;
}

export interface ImportResult {
  batch_id: number;
  filename: string;
  rows_total: number;
  rows_created: number;
  rows_failed: number;
  errors?: ImportErrorRow[];
}

export interface ImportBatch {
  id: number;
  filename: string;
  source: string;
  rows_total: number;
  rows_created: number;
  rows_failed: number;
  created_at: string;
}

export interface FindingMeta {
  priority_bands: string[];
  remediation_statuses: string[];
  /** Per-factor weights used by the context-aware priority score. */
  weights: Record<string, number>;
  compensating_control_penalty: number;
  methodology: string;
  /** The backend's own wording about this not being a CVSS score. */
  disclaimer: string;
  nvd_configured: boolean;
  /** Columns the scanner-import endpoint accepts. */
  import_columns: string[];
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface KpiValue {
  key: string;
  label: string;
  value: number;
  unit?: string | null;
  currency?: string | null;
  trend?: number | null;
  is_estimate?: boolean;
  help_text?: string | null;
}

export interface SeriesPoint {
  label: string;
  value: number;
  secondary?: number | null;
}

export interface NamedSeries {
  name: string;
  points: SeriesPoint[];
}

/** One row of the dashboard activity feed. The timestamp key is `at`. */
export interface RecentActivity {
  id: number;
  action: string;
  user_email?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  at: string;
}

export interface Dashboard {
  organization: OrganizationOut;
  generated_at: string;
  filters: Record<string, unknown>;
  kpis: KpiValue[];
  risks_created_vs_resolved: NamedSeries;
  risks_by_category: SeriesPoint[];
  risks_by_severity: SeriesPoint[];
  exposure_by_business_unit: SeriesPoint[];
  assets_by_criticality: SeriesPoint[];
  top_risks: Risk[];
  recent_activity: RecentActivity[];
  upcoming_mitigations: Mitigation[];
  /** `empty` means the organization has no records yet - not "no risk". */
  data_state: 'empty' | 'demo_only' | 'populated';
  notes?: string[];
}

// ---------------------------------------------------------------------------
// AI / ML
// ---------------------------------------------------------------------------

export interface FeatureContribution {
  key: string;
  label: string;
  value?: unknown;
  contribution: number;
  direction: 'increases_risk' | 'reduces_risk' | 'neutral';
}

export interface Prediction {
  predicted_class: Severity;
  rule_based_class: Severity;
  agrees_with_rules: boolean;
  used_fallback: boolean;
  confidence?: number | null;
  /** Always false today: the platform never claims calibrated probabilities. */
  confidence_is_calibrated?: boolean;
  class_probabilities?: Record<string, number>;
  model_version: string;
  algorithm: string;
  dataset_kind: string;
  contributions?: FeatureContribution[];
  increasing_factors?: string[];
  reducing_factors?: string[];
  recommendations?: string[];
  warnings?: string[];
  feature_values?: Record<string, unknown>;
  risk_id?: number | null;
}

export interface ModelVersion {
  id: number;
  version: string;
  algorithm: string;
  target_label: string;
  dataset_kind: string;
  dataset_rows: number;
  split_strategy?: string | null;
  feature_schema?: Record<string, unknown> | null;
  class_labels?: unknown[] | null;
  metrics?: Record<string, number | Record<string, number> | unknown> | null;
  confusion_matrix?: Record<string, Record<string, number>> | null;
  is_active: boolean;
  is_fallback: boolean;
  trained_at?: string | null;
  limitations?: string | null;
  notes?: string | null;
  created_at: string;
}

/** One column of the model's feature vector, as persisted with the artifact. */
export interface ModelFeature {
  key: string;
  label: string;
  type?: string;
  description?: string;
}

export interface ModelStatus {
  available: boolean;
  detail: string;
  active_model?: ModelVersion | null;
  /** Which optional accelerators (xgboost, shap) are importable in this deployment. */
  optional_runtime?: Record<string, boolean>;
  feature_schema?: ModelFeature[];
  target_label: string;
  target_description: string;
  limitations: string;
  minimum_training_rows: number;
  stored_rows_available: number;
}

export interface TrainingResult {
  model: ModelVersion;
  comparison?: Array<Record<string, unknown>>;
  summary: string;
}

export interface Insight {
  key: string;
  title: string;
  summary: string;
  severity: Severity;
  metric?: string | null;
  items?: Array<Record<string, unknown>>;
  basis: string;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportCatalogEntry {
  key: ReportTypeKey;
  title: string;
  description: string;
}

export interface ReportFigure {
  label: string;
  value: string;
}

export interface ReportDataset {
  report_type: string;
  title: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  figures?: ReportFigure[];
  methodology: string;
  limitations: string;
  row_count: number;
  currency: string;
  organization_id: number;
  generated_at: string;
  filters?: Record<string, unknown>;
}

export interface GeneratedReport {
  id: number;
  report_type: string;
  format: string;
  title: string;
  reporting_period_start?: string | null;
  reporting_period_end?: string | null;
  row_count: number;
  methodology?: string | null;
  limitations?: string | null;
  created_at: string;
}

export interface ReportRequest {
  report_type: ReportTypeKey;
  format?: 'csv' | 'pdf' | 'json';
  start_date?: string | null;
  end_date?: string | null;
  category?: RiskCategory | null;
  severity?: Severity | null;
  business_unit?: string | null;
}

// ---------------------------------------------------------------------------
// Audit log and notifications
// ---------------------------------------------------------------------------

export interface AuditLog {
  id: number;
  user_id?: number | null;
  user_email?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  detail?: Record<string, unknown> | null;
  ip_address?: string | null;
  created_at: string;
}

export interface Notification {
  id: number;
  title: string;
  body?: string | null;
  level: NotificationLevel;
  link?: string | null;
  is_read: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Preserved TILT vendor assessments
// ---------------------------------------------------------------------------

export interface VendorAssessment {
  id: number;
  organization_id: number;
  vendor_name: string;
  primary_domain?: string | null;
  status: string;
  assessment_type: TemplateKind;
  data_classification?: number | null;
  answers?: Record<string, unknown> | null;
  cloud_scores?: Record<string, unknown> | null;
  impact?: number | null;
  likelihood?: number | null;
  vulnerability?: number | null;
  inherent_score?: number | null;
  severity?: Severity | null;
  score?: number | null;
  max_score?: number | null;
  verdict?: string | null;
  weakness?: string | null;
  strength?: string | null;
  osint_warnings?: Array<Record<string, unknown>> | null;
  osint_urls?: Record<string, unknown> | null;
  osint_acknowledged: boolean;
  last_scanned_at?: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuestionnaireTemplate {
  id: number;
  kind: TemplateKind;
  position: number;
  category?: string | null;
  nist_control?: string | null;
  policy_ref?: string | null;
  text: string;
  description?: string | null;
  weight?: string | null;
  criticality?: string | null;
  points?: number | null;
  osint_source?: string | null;
  maturity_levels?: Record<string, unknown> | null;
  notes?: string | null;
}

export interface OsintScanResult {
  vendor: VendorAssessment;
  warnings?: Array<Record<string, unknown>>;
  osint_results?: Record<string, unknown>;
  live_checks_enabled: boolean;
  notes?: string[];
}
