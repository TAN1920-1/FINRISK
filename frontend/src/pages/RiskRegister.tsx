import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Download, Plus, Upload } from 'lucide-react';
import { ApiError, api, getForFile } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDate, humanise, toOptions } from '@/lib/format';
import { sortStateOf, useListState } from '@/hooks/useListState';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type { AssetOption, MemberOut, Page, Risk, RiskMeta } from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge, RiskScore, StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { ActiveFilters, FilterBar, FilterSelect, SearchInput } from '@/components/ui/Filters';
import { NoticeBanner } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { CSVImportDialog } from '@/components/ui/CSVImportDialog';
import { MethodologyPanel } from '@/components/ui/Methodology';

/**
 * Risk register.
 *
 * The register is the spine of the platform, so this screen follows one rule:
 * nothing is scored in the browser. The inherent score, the severity band and
 * the exposure figures all arrive from the API, and the residual columns stay
 * empty until somebody has actually assessed the risk after treatment.
 */

const SCALE_OPTIONS = [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) }));

export function RiskRegisterPage() {
  const { can } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [values, setValues] = useState<RiskFormValues>(EMPTY_RISK_FORM);
  const [errors, setErrors] = useState<RiskFormErrors>({});
  const [exporting, setExporting] = useState(false);

  const list = useListState({
    filterKeys: [
      'status',
      'category',
      'severity',
      'business_unit',
      'evidence_quality',
      'overdue_only',
      'open_only',
    ] as const,
    defaultSort: 'score',
  });

  const meta = useQuery({
    queryKey: queryKeys.riskMeta,
    queryFn: () => api.get<RiskMeta>('/api/risks/meta'),
    staleTime: 5 * 60_000,
  });

  const risks = useQuery({
    queryKey: queryKeys.risks(list.query),
    queryFn: () => api.get<Page<Risk>>('/api/risks', { query: list.query }),
  });

  const assets = useQuery({
    queryKey: queryKeys.assetOptions,
    queryFn: () => api.get<AssetOption[]>('/api/assets/options'),
    enabled: can('risk:write'),
  });

  const members = useQuery({
    queryKey: queryKeys.members,
    queryFn: () => api.get<MemberOut[]>('/api/auth/members'),
    enabled: can('risk:write'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<Risk>('/api/risks', payload),
    onSuccess: async (risk) => {
      setFormOpen(false);
      setValues(EMPTY_RISK_FORM);
      push({
        tone: 'success',
        title: 'Risk added to the register',
        description: `${risk.risk_ref} was created with severity ${humanise(risk.severity)}.`,
      });
      await queryClient.invalidateQueries({ queryKey: ['risks'] });
      navigate(`/risks/${risk.id}`);
    },
  });

  const openCreate = () => {
    setValues(EMPTY_RISK_FORM);
    setErrors({});
    setFormOpen(true);
  };

  const submit = () => {
    const validation = validateRiskForm(values);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    createMutation.mutate(buildRiskPayload(values, 'create'));
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const filename = await getForFile(
        '/api/risks/export',
        {
          status: list.state.filters.status ?? '',
          category: list.state.filters.category ?? '',
          severity: list.state.filters.severity ?? '',
          business_unit: list.state.filters.business_unit ?? '',
        },
        'risk-register.csv',
      );
      push({ tone: 'success', title: 'Export downloaded', description: filename });
    } catch (error) {
      push({ tone: 'error', title: 'The export failed', description: errorMessage(error) });
    } finally {
      setExporting(false);
    }
  };

  const openStatuses = meta.data?.open_statuses ?? [];
  const bands = useMemo(() => describeBands(meta.data?.severity_bands), [meta.data?.severity_bands]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Risk Intelligence"
        description="The organization's risk register. Scores follow the documented likelihood x impact matrix and are computed by the API, never in the browser."
        meta={
          risks.data ? (
            <span className="text-2xs text-muted">
              {risks.data.total} risk{risks.data.total === 1 ? '' : 's'} in scope
            </span>
          ) : null
        }
        actions={
          <>
            <Button
              variant="outline"
              icon={<Download className="h-3.5 w-3.5" aria-hidden />}
              loading={exporting}
              onClick={() => void exportCsv()}
            >
              Export CSV
            </Button>
            {can('risk:write') ? (
              <>
                <Button
                  variant="outline"
                  icon={<Upload className="h-3.5 w-3.5" aria-hidden />}
                  onClick={() => setImportOpen(true)}
                >
                  Import CSV
                </Button>
                <Button
                  variant="primary"
                  icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
                  onClick={openCreate}
                >
                  New risk
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {meta.data ? (
        <NoticeBanner tone="info" title="How a risk is scored">
          Inherent score = likelihood × impact on a 5 × 5 grid (1–25). Severity bands: {bands}.
          Residual scoring is recorded only after someone assesses the risk again; until then the
          residual column stays empty rather than repeating the inherent value.
        </NoticeBanner>
      ) : null}

      <Card>
        <FilterBar>
          <SearchInput
            value={list.state.search}
            onChange={list.setSearch}
            placeholder="Search title, reference or description…"
            label="Search risks"
          />
          <FilterSelect
            label="Status"
            value={list.state.filters.status ?? ''}
            onChange={(value) => list.setFilter('status', value)}
            options={toOptions(meta.data?.statuses)}
          />
          <FilterSelect
            label="Category"
            value={list.state.filters.category ?? ''}
            onChange={(value) => list.setFilter('category', value)}
            options={toOptions(meta.data?.categories)}
          />
          <FilterSelect
            label="Severity"
            value={list.state.filters.severity ?? ''}
            onChange={(value) => list.setFilter('severity', value)}
            options={toOptions(meta.data?.severities)}
          />
          <FilterSelect
            label="Evidence"
            value={list.state.filters.evidence_quality ?? ''}
            onChange={(value) => list.setFilter('evidence_quality', value)}
            options={toOptions(meta.data?.evidence_quality)}
          />
          <FilterSelect
            label="Business unit"
            value={list.state.filters.business_unit ?? ''}
            onChange={(value) => list.setFilter('business_unit', value)}
            options={(meta.data?.business_units ?? []).map((unit) => ({ value: unit, label: unit }))}
          />
          <div className="flex flex-col gap-1.5 pb-1">
            <Checkbox
              label="Open only"
              checked={list.state.filters.open_only === 'true'}
              onChange={(event) => list.setFilter('open_only', event.target.checked ? 'true' : '')}
            />
            <Checkbox
              label="Overdue only"
              checked={list.state.filters.overdue_only === 'true'}
              onChange={(event) => list.setFilter('overdue_only', event.target.checked ? 'true' : '')}
            />
          </div>
        </FilterBar>

        <div className="px-4 py-3">
          <ActiveFilters
            filters={[
              list.state.filters.status
                ? {
                    key: 'status',
                    label: `Status: ${humanise(list.state.filters.status)}`,
                    onClear: () => list.setFilter('status', ''),
                  }
                : null,
              list.state.filters.category
                ? {
                    key: 'category',
                    label: `Category: ${humanise(list.state.filters.category)}`,
                    onClear: () => list.setFilter('category', ''),
                  }
                : null,
              list.state.filters.severity
                ? {
                    key: 'severity',
                    label: `Severity: ${humanise(list.state.filters.severity)}`,
                    onClear: () => list.setFilter('severity', ''),
                  }
                : null,
              list.state.filters.evidence_quality
                ? {
                    key: 'evidence_quality',
                    label: `Evidence: ${humanise(list.state.filters.evidence_quality)}`,
                    onClear: () => list.setFilter('evidence_quality', ''),
                  }
                : null,
              list.state.filters.business_unit
                ? {
                    key: 'business_unit',
                    label: `Business unit: ${list.state.filters.business_unit}`,
                    onClear: () => list.setFilter('business_unit', ''),
                  }
                : null,
              list.state.filters.open_only === 'true'
                ? {
                    key: 'open_only',
                    label: 'Open risks only',
                    onClear: () => list.setFilter('open_only', ''),
                  }
                : null,
              list.state.filters.overdue_only === 'true'
                ? {
                    key: 'overdue_only',
                    label: 'Overdue only',
                    onClear: () => list.setFilter('overdue_only', ''),
                  }
                : null,
              list.state.search
                ? {
                    key: 'q',
                    label: `Search: “${list.state.search}”`,
                    onClear: () => list.setSearch(''),
                  }
                : null,
            ]}
            onClearAll={() => list.clearFilters()}
          />
        </div>

        <DataTable<Risk>
          caption="Risk register"
          columns={riskColumns(navigate, openStatuses)}
          rows={risks.data?.items ?? []}
          rowKey={(risk) => risk.id}
          loading={risks.isPending}
          error={risks.isError ? risks.error : undefined}
          onRetry={() => void risks.refetch()}
          sort={sortStateOf(list.state)}
          onSortChange={({ sort, order }) => list.setSort(sort, order)}
          onRowClick={(risk) => navigate(`/risks/${risk.id}`)}
          filtered={list.hasFilters}
          emptyTitle="No risks recorded yet"
          emptyDescription="An empty register is not a low-risk posture. Add the first entry to start scoring."
          emptyAction={
            can('risk:write') ? (
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={openCreate}>
                New risk
              </Button>
            ) : undefined
          }
          footer={
            risks.data ? (
              <Pagination
                page={risks.data.page}
                pageSize={risks.data.page_size}
                total={risks.data.total}
                pages={risks.data.pages}
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
                itemLabel="risks"
              />
            ) : null
          }
        />
      </Card>

      <MethodologyPanel
        title="How the register is scored"
        methodology={
          meta.data
            ? `Inherent score = likelihood × impact, each on a 1–5 scale, so the score ranges from 1 to 25. The severity band is read from the documented ranges: ${bands}. Residual likelihood and impact are recorded separately and are left blank until somebody assesses the risk after treatment.`
            : 'Risk scoring follows a documented 5 x 5 likelihood x impact matrix.'
        }
        formula="inherent_score = likelihood × impact   (1 ≤ likelihood, impact ≤ 5)"
        limitations="Severity bands are an analyst convention, not an objective property of the risk. A score is only as good as the likelihood and impact that were entered, which is why every risk also carries an evidence-quality rating."
      />

      {can('risk:write') ? (
        <Dialog
          open={formOpen}
          onClose={() => setFormOpen(false)}
          title="Add a risk to the register"
          description="Only the title, category and the two scoring scales are required. Everything else can be filled in later."
          size="lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={createMutation.isPending}>
                Cancel
              </Button>
              <Button variant="primary" loading={createMutation.isPending} onClick={submit}>
                Add risk
              </Button>
            </>
          }
        >
          {meta.data ? (
            <RiskForm
              values={values}
              errors={errors}
              onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
              meta={meta.data}
              members={members.data ?? []}
              assets={assets.data ?? []}
              showReference
            />
          ) : null}
          {createMutation.isError ? (
            <NoticeBanner tone="danger" title="The risk could not be saved" className="mt-3">
              {errorMessage(createMutation.error)}
            </NoticeBanner>
          ) : null}
        </Dialog>
      ) : null}

      {can('risk:write') ? (
        <CSVImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          endpoint="/api/risks/import"
          queryKey={['risks']}
          invalidateKeys={[['scenarios'], ['dashboard'], ['ai']]}
          title="Import risks from a CSV file"
          description="Required columns: title and category. Optional: risk_ref, description, asset_ref, likelihood (1–5), impact (1–5), status, business_unit and owner_email. Fill in any loss-scenario column (probability, direct_loss, revenue_loss, downtime_hours, downtime_cost_per_hour, recovery_cost, incident_response_cost, regulatory_cost, other_cost, insurance_recovery, mitigation_cost) to create the linked financial scenario as well."
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function riskColumns(
  navigate: (to: string) => void,
  openStatuses: readonly string[],
): Array<Column<Risk>> {
  return [
    {
      key: 'ref',
      header: 'Reference',
      sortKey: 'risk_ref',
      cell: (risk) => (
        <button
          type="button"
          className="rounded font-medium text-primary hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/risks/${risk.id}`);
          }}
        >
          {risk.risk_ref}
        </button>
      ),
    },
    {
      key: 'title',
      header: 'Risk',
      sortKey: 'title',
      cell: (risk) => (
        <span className="block max-w-md">
          <span className="block truncate text-xs font-medium text-foreground">{risk.title}</span>
          <span className="block truncate text-2xs text-muted">
            {humanise(risk.category)}
            {risk.business_unit ? ` · ${risk.business_unit}` : ''}
            {risk.asset_name ? ` · ${risk.asset_name}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'inherent',
      header: 'Inherent',
      sortKey: 'score',
      align: 'right',
      headerTitle: 'Likelihood × impact, 1–25, before treatment.',
      cell: (risk) => <RiskScore score={risk.inherent_score} severity={risk.severity} size="sm" />,
    },
    {
      key: 'residual',
      header: 'Residual',
      align: 'right',
      hideOnMobile: true,
      headerTitle: 'Recorded after treatment; blank until somebody assesses the risk again.',
      cell: (risk) =>
        risk.residual_score === null || risk.residual_score === undefined ? (
          <span className="text-xs text-muted">—</span>
        ) : (
          <RiskScore score={risk.residual_score} severity={risk.residual_severity} size="sm" />
        ),
    },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (risk) => <StatusBadge status={risk.status} />,
    },
    {
      key: 'owner',
      header: 'Owner',
      hideOnMobile: true,
      cell: (risk) => <span className="text-xs">{risk.owner_name ?? '—'}</span>,
    },
    {
      key: 'due',
      header: 'Due',
      sortKey: 'due_date',
      hideOnMobile: true,
      cell: (risk) =>
        risk.due_date ? (
          <span className="flex flex-col items-start gap-1">
            <span className="text-xs tabular-nums">{formatDate(risk.due_date)}</span>
            {isOverdue(risk, openStatuses) ? <Badge tone="critical">Overdue</Badge> : null}
          </span>
        ) : (
          <span className="text-xs text-muted">—</span>
        ),
    },
    {
      key: 'mitigations',
      header: 'Actions',
      align: 'right',
      hideOnMobile: true,
      headerTitle: 'Mitigation actions linked to this risk (completed in brackets).',
      cell: (risk) => (
        <span className="text-xs tabular-nums">
          {risk.mitigation_count ?? 0}
          {risk.completed_mitigation_count ? ` (${risk.completed_mitigation_count})` : ''}
        </span>
      ),
    },
  ];
}

export function isOverdue(risk: Pick<Risk, 'due_date' | 'status'>, openStatuses: readonly string[]): boolean {
  if (!risk.due_date) return false;
  if (openStatuses.length && !openStatuses.includes(risk.status)) return false;
  return risk.due_date < new Date().toISOString().slice(0, 10);
}

function describeBands(bands: RiskMeta['severity_bands'] | undefined): string {
  if (!bands) return 'not loaded';
  const order = ['critical', 'high', 'medium', 'low'];
  return order
    .filter((key) => bands[key])
    .map((key) => `${humanise(key)} ${bands[key][0]}–${bands[key][1]}`)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Shared risk form (also used by the detail page's edit dialog)
// ---------------------------------------------------------------------------

export interface RiskFormValues {
  risk_ref: string;
  title: string;
  category: string;
  source: string;
  asset_id: string;
  business_unit: string;
  owner_id: string;
  threat_scenario: string;
  likelihood: string;
  impact: string;
  residual_likelihood: string;
  residual_impact: string;
  status: string;
  evidence_quality: string;
  due_date: string;
  description: string;
  financial_impact_assumptions: string;
  existing_controls: string;
  mitigation_plan: string;
}

export const EMPTY_RISK_FORM: RiskFormValues = {
  risk_ref: '',
  title: '',
  category: '',
  source: '',
  asset_id: '',
  business_unit: '',
  owner_id: '',
  threat_scenario: '',
  likelihood: '3',
  impact: '3',
  residual_likelihood: '',
  residual_impact: '',
  status: 'identified',
  evidence_quality: 'medium',
  due_date: '',
  description: '',
  financial_impact_assumptions: '',
  existing_controls: '',
  mitigation_plan: '',
};

export function formFromRisk(risk: Risk): RiskFormValues {
  return {
    risk_ref: risk.risk_ref,
    title: risk.title,
    category: risk.category,
    source: risk.source ?? '',
    asset_id: risk.asset_id ? String(risk.asset_id) : '',
    business_unit: risk.business_unit ?? '',
    owner_id: risk.owner_id ? String(risk.owner_id) : '',
    threat_scenario: risk.threat_scenario ?? '',
    likelihood: String(risk.likelihood),
    impact: String(risk.impact),
    residual_likelihood: risk.residual_likelihood ? String(risk.residual_likelihood) : '',
    residual_impact: risk.residual_impact ? String(risk.residual_impact) : '',
    status: risk.status,
    evidence_quality: risk.evidence_quality,
    due_date: risk.due_date ? risk.due_date.slice(0, 10) : '',
    description: risk.description ?? '',
    financial_impact_assumptions: risk.financial_impact_assumptions ?? '',
    existing_controls: risk.existing_controls ?? '',
    mitigation_plan: risk.mitigation_plan ?? '',
  };
}

export interface RiskFormErrors {
  title?: string;
  category?: string;
  likelihood?: string;
  impact?: string;
  residual?: string;
}

export function validateRiskForm(values: RiskFormValues): RiskFormErrors {
  const errors: RiskFormErrors = {};
  if (values.title.trim().length < 3) errors.title = 'Enter at least three characters.';
  if (!values.category) errors.category = 'Choose a category.';

  const likelihood = Number(values.likelihood);
  const impact = Number(values.impact);
  if (!(likelihood >= 1 && likelihood <= 5)) errors.likelihood = 'Likelihood must be between 1 and 5.';
  if (!(impact >= 1 && impact <= 5)) errors.impact = 'Impact must be between 1 and 5.';

  const hasResidualLikelihood = values.residual_likelihood !== '';
  const hasResidualImpact = values.residual_impact !== '';
  if (hasResidualLikelihood !== hasResidualImpact) {
    errors.residual = 'Record both the residual likelihood and the residual impact, or neither.';
  }
  return errors;
}

/**
 * Build the request body. On `update` an empty residual pair is sent as an
 * explicit `clear_residual` so removing a post-treatment score is possible
 * rather than being silently ignored.
 */
export function buildRiskPayload(
  values: RiskFormValues,
  mode: 'create' | 'update',
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: values.title.trim(),
    description: values.description.trim() || null,
    category: values.category,
    source: values.source.trim() || null,
    asset_id: values.asset_id ? Number(values.asset_id) : null,
    business_unit: values.business_unit.trim() || null,
    owner_id: values.owner_id ? Number(values.owner_id) : null,
    threat_scenario: values.threat_scenario.trim() || null,
    likelihood: Number(values.likelihood),
    impact: Number(values.impact),
    financial_impact_assumptions: values.financial_impact_assumptions.trim() || null,
    existing_controls: values.existing_controls.trim() || null,
    mitigation_plan: values.mitigation_plan.trim() || null,
    status: values.status,
    evidence_quality: values.evidence_quality,
    due_date: values.due_date || null,
  };

  if (values.residual_likelihood && values.residual_impact) {
    payload.residual_likelihood = Number(values.residual_likelihood);
    payload.residual_impact = Number(values.residual_impact);
  } else if (mode === 'update') {
    payload.clear_residual = true;
  }

  if (mode === 'create' && values.risk_ref.trim()) {
    payload.risk_ref = values.risk_ref.trim();
  }
  return payload;
}

export function RiskForm({
  values,
  errors,
  onChange,
  meta,
  members,
  assets,
  showReference = false,
}: {
  values: RiskFormValues;
  errors: RiskFormErrors;
  onChange: (patch: Partial<RiskFormValues>) => void;
  meta: RiskMeta;
  members: MemberOut[];
  assets: AssetOption[];
  showReference?: boolean;
}) {
  const ownerOptions = members.map((member) => ({
    value: String(member.user_id),
    label: `${member.full_name} · ${humanise(member.role)}`,
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Title"
          required
          htmlFor="risk-title"
          error={errors.title}
          className="sm:col-span-2"
        >
          <Input
            id="risk-title"
            value={values.title}
            invalid={Boolean(errors.title)}
            placeholder="Short, specific description of the risk"
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </Field>

        {showReference ? (
          <Field
            label="Reference"
            htmlFor="risk-ref"
            hint="Leave blank to allocate the next reference automatically."
          >
            <Input
              id="risk-ref"
              value={values.risk_ref}
              onChange={(event) => onChange({ risk_ref: event.target.value })}
            />
          </Field>
        ) : null}

        <Field label="Category" required htmlFor="risk-category" error={errors.category}>
          <Select
            id="risk-category"
            value={values.category}
            invalid={Boolean(errors.category)}
            placeholder="Choose a category…"
            options={toOptions(meta.categories)}
            onChange={(event) => onChange({ category: event.target.value })}
          />
        </Field>

        <Field label="Status" htmlFor="risk-status">
          <Select
            id="risk-status"
            value={values.status}
            options={toOptions(meta.statuses)}
            onChange={(event) => onChange({ status: event.target.value })}
          />
        </Field>

        <Field
          label="Likelihood"
          required
          htmlFor="risk-likelihood"
          error={errors.likelihood}
          aside="1 = rare · 5 = almost certain"
        >
          <Select
            id="risk-likelihood"
            value={values.likelihood}
            invalid={Boolean(errors.likelihood)}
            options={SCALE_OPTIONS}
            onChange={(event) => onChange({ likelihood: event.target.value })}
          />
        </Field>

        <Field
          label="Impact"
          required
          htmlFor="risk-impact"
          error={errors.impact}
          aside="1 = negligible · 5 = severe"
        >
          <Select
            id="risk-impact"
            value={values.impact}
            invalid={Boolean(errors.impact)}
            options={SCALE_OPTIONS}
            onChange={(event) => onChange({ impact: event.target.value })}
          />
        </Field>

        <Field
          label="Residual likelihood"
          htmlFor="risk-residual-likelihood"
          error={errors.residual}
          hint="Leave both residual fields blank until the risk has been reassessed."
        >
          <Select
            id="risk-residual-likelihood"
            value={values.residual_likelihood}
            invalid={Boolean(errors.residual)}
            placeholder="Not assessed"
            options={SCALE_OPTIONS}
            onChange={(event) => onChange({ residual_likelihood: event.target.value })}
          />
        </Field>

        <Field label="Residual impact" htmlFor="risk-residual-impact">
          <Select
            id="risk-residual-impact"
            value={values.residual_impact}
            invalid={Boolean(errors.residual)}
            placeholder="Not assessed"
            options={SCALE_OPTIONS}
            onChange={(event) => onChange({ residual_impact: event.target.value })}
          />
        </Field>

        <Field label="Evidence quality" htmlFor="risk-evidence">
          <Select
            id="risk-evidence"
            value={values.evidence_quality}
            options={toOptions(meta.evidence_quality)}
            onChange={(event) => onChange({ evidence_quality: event.target.value })}
          />
        </Field>

        <Field label="Due date" htmlFor="risk-due">
          <Input
            id="risk-due"
            type="date"
            value={values.due_date}
            onChange={(event) => onChange({ due_date: event.target.value })}
          />
        </Field>

        <Field label="Asset" htmlFor="risk-asset" hint={assets.length ? undefined : 'No assets registered yet.'}>
          <Select
            id="risk-asset"
            value={values.asset_id}
            placeholder="No asset linked"
            options={assets.map((asset) => ({
              value: String(asset.id),
              label: `${asset.asset_ref} · ${asset.name}`,
            }))}
            onChange={(event) => onChange({ asset_id: event.target.value })}
          />
        </Field>

        <Field label="Owner" htmlFor="risk-owner" hint={ownerOptions.length ? undefined : 'No other members to assign.'}>
          <Select
            id="risk-owner"
            value={values.owner_id}
            placeholder="Unassigned"
            options={ownerOptions}
            onChange={(event) => onChange({ owner_id: event.target.value })}
          />
        </Field>

        <Field label="Business unit" htmlFor="risk-business-unit">
          <Input
            id="risk-business-unit"
            value={values.business_unit}
            list="risk-business-unit-options"
            onChange={(event) => onChange({ business_unit: event.target.value })}
          />
          <datalist id="risk-business-unit-options">
            {meta.business_units.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
        </Field>

        <Field label="Source" htmlFor="risk-source">
          <Input
            id="risk-source"
            value={values.source}
            onChange={(event) => onChange({ source: event.target.value })}
          />
        </Field>

        <Field label="Description" htmlFor="risk-description" className="sm:col-span-2">
          <Textarea
            id="risk-description"
            value={values.description}
            rows={3}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </Field>

        <Field label="Threat scenario" htmlFor="risk-threat" className="sm:col-span-2">
          <Textarea
            id="risk-threat"
            value={values.threat_scenario}
            rows={2}
            onChange={(event) => onChange({ threat_scenario: event.target.value })}
          />
        </Field>

        <Field label="Existing controls" htmlFor="risk-controls">
          <Textarea
            id="risk-controls"
            value={values.existing_controls}
            rows={3}
            onChange={(event) => onChange({ existing_controls: event.target.value })}
          />
        </Field>

        <Field
          label="Financial impact assumptions"
          htmlFor="risk-financial"
          hint="Free text. Money estimates belong in the scenario models, not here."
        >
          <Textarea
            id="risk-financial"
            value={values.financial_impact_assumptions}
            rows={3}
            onChange={(event) => onChange({ financial_impact_assumptions: event.target.value })}
          />
        </Field>

        <Field label="Mitigation plan" htmlFor="risk-plan" className="sm:col-span-2">
          <Textarea
            id="risk-plan"
            value={values.mitigation_plan}
            rows={3}
            onChange={(event) => onChange({ mitigation_plan: event.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}

export { errorMessage as riskErrorMessage };
