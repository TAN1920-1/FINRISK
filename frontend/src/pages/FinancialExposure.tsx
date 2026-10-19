import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError, api, getForFile } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDateTime, formatMoney, formatPercent, humanise, toOptions } from '@/lib/format';
import { sortStateOf, useListState } from '@/hooks/useListState';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type {
  AssetOption,
  FinancialScenario,
  LossBreakdown,
  Message,
  Page,
  RiskOption,
  ScenarioCalculation,
  ScenarioInputs,
  ScenarioMeta,
  SeriesPoint,
} from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, DescriptionList } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { BadgeTone } from '@/components/ui/Badge';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { ActiveFilters, FilterBar, FilterSelect, SearchInput } from '@/components/ui/Filters';
import { NoticeBanner, Spinner } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { MethodologyPanel } from '@/components/ui/Methodology';
import { ChartCard, TrendLineChart } from '@/components/ui/Charts';

/**
 * Financial exposure.
 *
 * Every figure on this screen is produced by the documented loss engine in the
 * API. The page never adds two amounts together itself, and it refuses to
 * display a total in more than one currency: each row is formatted with the
 * currency the scenario was stored in.
 */

const SCENARIO_TONE: Record<string, BadgeTone> = {
  best_case: 'low',
  base_case: 'medium',
  worst_case: 'high',
};

export function FinancialExposurePage() {
  const { can, hasRole } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FinancialScenario | null>(null);
  const [values, setValues] = useState<ScenarioFormValues>(EMPTY_SCENARIO_FORM);
  const [errors, setErrors] = useState<ScenarioFormErrors>({});
  const [detail, setDetail] = useState<FinancialScenario | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FinancialScenario | null>(null);
  const [exporting, setExporting] = useState(false);

  const list = useListState({
    filterKeys: ['scenario_type', 'risk_id', 'asset_id'] as const,
    defaultSort: 'created_at',
  });

  const meta = useQuery({
    queryKey: queryKeys.scenarioMeta,
    queryFn: () => api.get<ScenarioMeta>('/api/financial-scenarios/meta'),
    staleTime: 5 * 60_000,
  });

  const scenarios = useQuery({
    queryKey: queryKeys.scenarios(list.query),
    queryFn: () =>
      api.get<Page<FinancialScenario>>('/api/financial-scenarios', { query: list.query }),
  });

  const riskOptions = useQuery({
    queryKey: queryKeys.riskOptions,
    queryFn: () => api.get<RiskOption[]>('/api/risks/options'),
    staleTime: 5 * 60_000,
  });

  const assetOptions = useQuery({
    queryKey: queryKeys.assetOptions,
    queryFn: () => api.get<AssetOption[]>('/api/assets/options'),
    staleTime: 5 * 60_000,
  });

  const previewMutation = useMutation({
    mutationFn: (inputs: ScenarioInputs) =>
      api.post<ScenarioCalculation>('/api/financial-scenarios/preview', inputs),
  });

  const saveMutation = useMutation({
    mutationFn: (input: { id: number | null; payload: Record<string, unknown> }) =>
      input.id === null
        ? api.post<FinancialScenario>('/api/financial-scenarios', input.payload)
        : api.patch<FinancialScenario>(`/api/financial-scenarios/${input.id}`, input.payload),
    onSuccess: async (scenario, input) => {
      setFormOpen(false);
      setEditing(null);
      setValues(EMPTY_SCENARIO_FORM);
      previewMutation.reset();
      push({
        tone: 'success',
        title: input.id === null ? 'Scenario saved' : 'Scenario updated',
        description:
          scenario.calculation
            ? `${scenario.name}: expected loss ${formatMoney(scenario.calculation.expected_loss, scenario.currency)}.`
            : scenario.name,
      });
      await queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      await queryClient.invalidateQueries({ queryKey: ['scenario'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete<Message>(`/api/financial-scenarios/${id}`),
    onSuccess: async () => {
      setDeleteTarget(null);
      push({ tone: 'success', title: 'Scenario deleted' });
      await queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    },
    onError: (error) => {
      push({ tone: 'error', title: 'The scenario was not deleted', description: scenarioErrorMessage(error) });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setValues({ ...EMPTY_SCENARIO_FORM, currency: meta.data?.organization_currency ?? 'USD' });
    setErrors({});
    previewMutation.reset();
    setFormOpen(true);
  };

  const openEdit = (scenario: FinancialScenario) => {
    setEditing(scenario);
    setValues(formFromScenario(scenario));
    setErrors({});
    previewMutation.reset();
    setFormOpen(true);
  };

  const submit = () => {
    const validation = validateScenarioForm(values, true);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    saveMutation.mutate({ id: editing?.id ?? null, payload: buildScenarioPayload(values) });
  };

  const runPreview = () => {
    const validation = validateScenarioForm(values, false);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    previewMutation.mutate(buildScenarioInputs(values));
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const filename = await getForFile(
        '/api/financial-scenarios/export',
        {
          scenario_type: list.state.filters.scenario_type ?? '',
          risk_id: list.state.filters.risk_id ?? '',
        },
        'finrisk-financial-scenarios.csv',
      );
      push({ tone: 'success', title: 'Export downloaded', description: filename });
    } catch (error) {
      push({ tone: 'error', title: 'The export failed', description: scenarioErrorMessage(error) });
    } finally {
      setExporting(false);
    }
  };

  const rows = scenarios.data?.items ?? [];
  const hasDemo = rows.some((scenario) => scenario.is_demo);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Financial Exposure"
        description="Scenario-based loss estimates. Each figure is produced by the documented loss engine from the inputs you record; nothing is extrapolated or converted between currencies."
        meta={
          scenarios.data ? (
            <span className="text-2xs text-muted">
              {scenarios.data.total} scenario{scenarios.data.total === 1 ? '' : 's'} in scope
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
            {can('financial:read') && can('risk:write') ? (
              <Button
                variant="primary"
                icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
                onClick={openCreate}
              >
                New scenario
              </Button>
            ) : null}
          </>
        }
      />

      <NoticeBanner tone="info" title="These are estimates, not forecasts">
        Each scenario applies the documented loss model to the amounts you enter. An input you leave
        blank is reported as “not estimated” and contributes nothing to the gross loss — it is never
        treated as zero loss. Amounts are expressed in the scenario's own currency and are never
        converted.
      </NoticeBanner>

      {hasDemo ? (
        <NoticeBanner tone="warning" title="This register contains demonstration data">
          Some scenarios were generated as illustrative examples rather than from a real assessment.
          Treat their figures as placeholders and replace them before reporting.
        </NoticeBanner>
      ) : null}

      <Card>
        <FilterBar>
          <SearchInput
            value={list.state.search}
            onChange={list.setSearch}
            placeholder="Search scenario name or description…"
            label="Search scenarios"
          />
          <FilterSelect
            label="Type"
            value={list.state.filters.scenario_type ?? ''}
            onChange={(value) => list.setFilter('scenario_type', value)}
            options={toOptions(meta.data?.scenario_types)}
          />
          <FilterSelect
            label="Risk"
            value={list.state.filters.risk_id ?? ''}
            onChange={(value) => list.setFilter('risk_id', value)}
            options={(riskOptions.data ?? []).map((risk) => ({
              value: String(risk.id),
              label: `${risk.risk_ref} · ${risk.title}`,
            }))}
          />
          <FilterSelect
            label="Asset"
            value={list.state.filters.asset_id ?? ''}
            onChange={(value) => list.setFilter('asset_id', value)}
            options={(assetOptions.data ?? []).map((asset) => ({
              value: String(asset.id),
              label: `${asset.asset_ref} · ${asset.name}`,
            }))}
          />
        </FilterBar>

        <div className="px-4 py-3">
          <ActiveFilters
            filters={[
              list.state.filters.scenario_type
                ? {
                    key: 'scenario_type',
                    label: `Type: ${humanise(list.state.filters.scenario_type)}`,
                    onClear: () => list.setFilter('scenario_type', ''),
                  }
                : null,
              list.state.filters.risk_id
                ? {
                    key: 'risk_id',
                    label: `Risk: ${riskLabel(riskOptions.data, list.state.filters.risk_id)}`,
                    onClear: () => list.setFilter('risk_id', ''),
                  }
                : null,
              list.state.filters.asset_id
                ? {
                    key: 'asset_id',
                    label: `Asset: ${assetLabel(assetOptions.data, list.state.filters.asset_id)}`,
                    onClear: () => list.setFilter('asset_id', ''),
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

        <DataTable<FinancialScenario>
          caption="Financial scenarios"
          columns={scenarioColumns({
            onOpen: setDetail,
            onEdit: openEdit,
            onDelete: setDeleteTarget,
            canWrite: can('risk:write'),
            canDelete: hasRole('risk_manager'),
          })}
          rows={rows}
          rowKey={(scenario) => scenario.id}
          loading={scenarios.isPending}
          error={scenarios.isError ? scenarios.error : undefined}
          onRetry={() => void scenarios.refetch()}
          sort={sortStateOf(list.state)}
          onSortChange={({ sort, order }) => list.setSort(sort, order)}
          onRowClick={(scenario) => setDetail(scenario)}
          filtered={list.hasFilters}
          emptyTitle="No scenarios modelled yet"
          emptyDescription="Nothing recorded is not the same as no exposure. Model a scenario to quantify what a defined event would cost."
          emptyAction={
            can('risk:write') ? (
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={openCreate}>
                New scenario
              </Button>
            ) : undefined
          }
          footer={
            scenarios.data ? (
              <Pagination
                page={scenarios.data.page}
                pageSize={scenarios.data.page_size}
                total={scenarios.data.total}
                pages={scenarios.data.pages}
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
                itemLabel="scenarios"
              />
            ) : null
          }
        />
      </Card>

      <MethodologyPanel
        title="How exposure is calculated"
        methodology={meta.data?.formula ? 'The API applies the following chain to the inputs of each scenario:' : 'The API applies a documented loss model to the inputs of each scenario.'}
        formula={formulaText(meta.data?.formula)}
        limitations="A scenario is only as good as its inputs. An unestimated component reduces the gross loss rather than being guessed, so a scenario that is missing inputs understates exposure. Return on mitigation compares the avoided expected loss against the mitigation cost and ignores the residual risk that remains, which is why the residual exposure is always shown next to it."
      />

      {detail ? (
        <ScenarioDetailDialog
          scenario={detail}
          formula={meta.data?.formula}
          onClose={() => setDetail(null)}
          onEdit={
            can('risk:write')
              ? () => {
                  const target = detail;
                  setDetail(null);
                  openEdit(target);
                }
              : undefined
          }
        />
      ) : null}

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit “${editing.name}”` : 'Model a financial scenario'}
        description="Record what a defined event would cost. Leave a component blank when it has not been estimated; the engine reports it as not estimated rather than as zero."
        size="xl"
        footer={
          <>
            <Button
              variant="outline"
              icon={<Calculator className="h-3.5 w-3.5" aria-hidden />}
              loading={previewMutation.isPending}
              onClick={runPreview}
            >
              Preview calculation
            </Button>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button variant="primary" loading={saveMutation.isPending} onClick={submit}>
              {editing ? 'Save changes' : 'Save scenario'}
            </Button>
          </>
        }
      >
        <ScenarioForm
          values={values}
          errors={errors}
          onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
          scenarioTypes={meta.data?.scenario_types ?? []}
          risks={riskOptions.data ?? []}
          assets={assetOptions.data ?? []}
          organizationCurrency={meta.data?.organization_currency ?? 'USD'}
        />

        {previewMutation.isError ? (
          <NoticeBanner tone="danger" title="The preview could not be calculated" className="mt-4">
            {scenarioErrorMessage(previewMutation.error)}
          </NoticeBanner>
        ) : null}

        {previewMutation.data ? (
          <div className="mt-4 space-y-3">
            <LossBreakdownPanel
              breakdown={previewMutation.data.breakdown}
              title="Preview — unsaved inputs"
              footnote="This preview is not stored. Nothing is recorded until you save the scenario."
            />
            <SensitivityPanel calculation={previewMutation.data} />
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this scenario?"
        message={
          deleteTarget
            ? `“${deleteTarget.name}” and its recorded inputs will be removed. Reports already generated are unaffected.`
            : ''
        }
        confirmLabel="Delete scenario"
        pending={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function scenarioColumns(handlers: {
  onOpen: (scenario: FinancialScenario) => void;
  onEdit: (scenario: FinancialScenario) => void;
  onDelete: (scenario: FinancialScenario) => void;
  canWrite: boolean;
  canDelete: boolean;
}): Array<Column<FinancialScenario>> {
  const columns: Array<Column<FinancialScenario>> = [
    {
      key: 'name',
      header: 'Scenario',
      sortKey: 'name',
      cell: (scenario) => (
        <span className="block max-w-md">
          <span className="block truncate text-xs font-medium text-foreground">{scenario.name}</span>
          <span className="block truncate text-2xs text-muted">
            {scenario.risk_ref
              ? `${scenario.risk_ref} · ${scenario.risk_title ?? 'linked risk'}`
              : scenario.asset_name
                ? `Asset · ${scenario.asset_name}`
                : 'Not linked to a risk or asset'}
          </span>
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortKey: 'scenario_type',
      cell: (scenario) => (
        <Badge tone={SCENARIO_TONE[scenario.scenario_type] ?? 'neutral'}>
          {humanise(scenario.scenario_type)}
        </Badge>
      ),
    },
    {
      key: 'probability',
      header: 'Probability',
      sortKey: 'probability',
      align: 'right',
      headerTitle: 'Likelihood that the scenario occurs within its time horizon.',
      cell: (scenario) => (
        <span className="text-xs tabular-nums">{formatPercent(scenario.probability, 1)}</span>
      ),
    },
    {
      key: 'horizon',
      header: 'Horizon',
      sortKey: 'time_horizon_months',
      align: 'right',
      hideOnMobile: true,
      cell: (scenario) => (
        <span className="text-xs tabular-nums">{scenario.time_horizon_months} mo</span>
      ),
    },
    {
      key: 'gross',
      header: 'Gross loss',
      align: 'right',
      hideOnMobile: true,
      headerTitle: 'Sum of the estimated loss components before recoveries.',
      cell: (scenario) => (
        <span className="text-xs tabular-nums text-muted">
          {scenario.calculation ? formatMoney(scenario.calculation.gross_loss, scenario.currency) : '—'}
        </span>
      ),
    },
    {
      key: 'net',
      header: 'Net loss',
      align: 'right',
      hideOnMobile: true,
      headerTitle: 'Gross loss less recoveries (insurance, capped at the gross loss).',
      cell: (scenario) => (
        <span className="text-xs tabular-nums">
          {scenario.calculation ? formatMoney(scenario.calculation.net_loss, scenario.currency) : '—'}
        </span>
      ),
    },
    {
      key: 'expected',
      header: 'Expected loss',
      align: 'right',
      headerTitle: 'Probability x net loss — the probability-weighted exposure.',
      cell: (scenario) => (
        <span className="text-xs font-medium tabular-nums text-foreground">
          {scenario.calculation ? formatMoney(scenario.calculation.expected_loss, scenario.currency) : '—'}
        </span>
      ),
    },
    {
      key: 'residual',
      header: 'Residual',
      align: 'right',
      hideOnMobile: true,
      headerTitle:
        'Post-mitigation exposure. Equals the expected loss when no residual probability has been recorded.',
      cell: (scenario) => (
        <span className="text-xs tabular-nums">
          {scenario.calculation
            ? formatMoney(scenario.calculation.expected_residual_loss, scenario.currency)
            : '—'}
        </span>
      ),
    },
    {
      key: 'avoided',
      header: 'Avoided',
      align: 'right',
      hideOnMobile: true,
      headerTitle: 'Expected loss minus the residual exposure — the value the mitigation is modelled to remove.',
      cell: (scenario) => (
        <span className="text-xs tabular-nums">
          {scenario.calculation
            ? formatMoney(scenario.calculation.potential_avoided_loss, scenario.currency)
            : '—'}
        </span>
      ),
    },
  ];

  if (handlers.canWrite || handlers.canDelete) {
    columns.push({
      key: 'actions',
      header: '',
      align: 'right',
      cell: (scenario) => (
        <span className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`View ${scenario.name}`}
            onClick={(event) => {
              event.stopPropagation();
              handlers.onOpen(scenario);
            }}
          >
            View
          </Button>
          {handlers.canWrite ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Edit ${scenario.name}`}
              icon={<Pencil className="h-3.5 w-3.5" aria-hidden />}
              onClick={(event) => {
                event.stopPropagation();
                handlers.onEdit(scenario);
              }}
            />
          ) : null}
          {handlers.canDelete ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete ${scenario.name}`}
              icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
              onClick={(event) => {
                event.stopPropagation();
                handlers.onDelete(scenario);
              }}
            />
          ) : null}
        </span>
      ),
    });
  }

  return columns;
}

function riskLabel(options: RiskOption[] | undefined, id: string): string {
  const match = (options ?? []).find((option) => String(option.id) === id);
  return match ? match.risk_ref : id;
}

function assetLabel(options: AssetOption[] | undefined, id: string): string {
  const match = (options ?? []).find((option) => String(option.id) === id);
  return match ? match.name : id;
}

// ---------------------------------------------------------------------------
// Detail dialog
// ---------------------------------------------------------------------------

function ScenarioDetailDialog({
  scenario,
  formula,
  onClose,
  onEdit,
}: {
  scenario: FinancialScenario;
  formula: Record<string, string> | undefined;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const calculation = useQuery({
    queryKey: ['scenario', scenario.id, 'calculation'] as const,
    queryFn: () => api.post<ScenarioCalculation>(`/api/financial-scenarios/${scenario.id}/calculate`),
  });

  const breakdown = calculation.data?.breakdown ?? scenario.calculation ?? null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={scenario.name}
      description={`${humanise(scenario.scenario_type)} · ${scenario.currency} over ${scenario.time_horizon_months} months`}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {onEdit ? (
            <Button variant="primary" icon={<Pencil className="h-3.5 w-3.5" aria-hidden />} onClick={onEdit}>
              Edit scenario
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-5">
        {scenario.is_demo ? (
          <NoticeBanner tone="warning" title="Demonstration scenario">
            This scenario was generated as an illustrative example, not from a real assessment.
          </NoticeBanner>
        ) : null}

        <DescriptionList
          columns={3}
          items={[
            { label: 'Type', value: humanise(scenario.scenario_type) },
            { label: 'Currency', value: scenario.currency },
            { label: 'Time horizon', value: `${scenario.time_horizon_months} months` },
            { label: 'Probability', value: formatPercent(scenario.probability, 1) },
            {
              label: 'Residual probability',
              value:
                scenario.residual_probability === null || scenario.residual_probability === undefined
                  ? 'Not recorded'
                  : formatPercent(scenario.residual_probability, 1),
            },
            {
              label: 'Linked risk',
              value: scenario.risk_ref
                ? `${scenario.risk_ref} · ${scenario.risk_title ?? ''}`
                : 'Not linked',
            },
            { label: 'Asset', value: scenario.asset_name ?? 'Not linked' },
            { label: 'Created', value: formatDateTime(scenario.created_at) },
            { label: 'Updated', value: formatDateTime(scenario.updated_at) },
            { label: 'Description', value: scenario.description ?? 'Not recorded.', span: true },
            { label: 'Assumptions', value: scenario.assumptions ?? 'Not recorded.', span: true },
          ]}
        />

        {breakdown ? (
          <LossBreakdownPanel breakdown={breakdown} />
        ) : (
          <Spinner label="Loading the loss calculation…" />
        )}

        {calculation.isError ? (
          <NoticeBanner tone="danger" title="The full calculation could not be loaded">
            {scenarioErrorMessage(calculation.error)}
          </NoticeBanner>
        ) : null}

        {calculation.data ? <SensitivityPanel calculation={calculation.data} /> : null}

        <MethodologyPanel
          title="How this scenario is calculated"
          methodology="The stored inputs are passed through the documented loss engine; the figures above are its output."
          formula={formulaText(formula)}
          limitations="Return on mitigation assumes the modelled residual probability is achieved. It ignores knock-on effects, second-order losses and any change in the scenario's own probability."
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Loss breakdown and sensitivity
// ---------------------------------------------------------------------------

export function LossBreakdownPanel({
  breakdown,
  title = 'Loss model output',
  footnote,
}: {
  breakdown: LossBreakdown;
  title?: string;
  footnote?: ReactNode;
}) {
  const currency = breakdown.currency;

  return (
    <Card>
      <CardHeader
        title={title}
        description={`All amounts in ${currency}. Components that were not estimated are labelled as such and add nothing to the total.`}
      />
      <div className="space-y-4 px-4 py-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Loss components and their amounts</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-2 py-1.5 text-left text-2xs font-semibold uppercase tracking-wide text-muted">
                  Component
                </th>
                <th scope="col" className="px-2 py-1.5 text-left text-2xs font-semibold uppercase tracking-wide text-muted">
                  Basis
                </th>
                <th scope="col" className="px-2 py-1.5 text-right text-2xs font-semibold uppercase tracking-wide text-muted">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {breakdown.components.map((component) => (
                <tr key={component.label}>
                  <td className="px-2 py-1.5 text-xs text-foreground">{component.label}</td>
                  <td className="px-2 py-1.5 text-2xs text-muted">{component.note ?? '—'}</td>
                  <td
                    className={
                      component.note === 'Not estimated'
                        ? 'px-2 py-1.5 text-right text-xs text-muted'
                        : 'px-2 py-1.5 text-right text-xs tabular-nums text-foreground'
                    }
                  >
                    {component.note === 'Not estimated'
                      ? 'not estimated'
                      : formatMoney(component.amount, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DescriptionList
          columns={3}
          items={[
            { label: 'Probability', value: formatPercent(breakdown.probability, 1) },
            {
              label: 'Residual probability',
              value:
                breakdown.residual_probability === null || breakdown.residual_probability === undefined
                  ? 'Not recorded'
                  : formatPercent(breakdown.residual_probability, 1),
            },
            { label: 'Gross loss', value: formatMoney(breakdown.gross_loss, currency) },
            { label: 'Total recoveries', value: formatMoney(breakdown.total_recoveries, currency) },
            { label: 'Net loss', value: formatMoney(breakdown.net_loss, currency) },
            { label: 'Expected loss', value: formatMoney(breakdown.expected_loss, currency) },
            {
              label: 'Expected residual loss',
              value: formatMoney(breakdown.expected_residual_loss, currency),
            },
            {
              label: 'Potential avoided loss',
              value: formatMoney(breakdown.potential_avoided_loss, currency),
            },
            { label: 'Mitigation cost', value: formatMoney(breakdown.mitigation_cost, currency) },
            {
              label: 'Return on mitigation',
              value:
                breakdown.return_on_mitigation === null || breakdown.return_on_mitigation === undefined
                  ? 'Not available — no mitigation cost recorded'
                  : formatPercent(breakdown.return_on_mitigation, 1),
              span: true,
            },
          ]}
        />

        {breakdown.notes?.length ? (
          <div className="rounded border border-risk-medium/40 bg-risk-medium/10 p-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-muted">Model notes</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-foreground">
              {breakdown.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {footnote ? <p className="text-2xs text-muted">{footnote}</p> : null}
      </div>
    </Card>
  );
}

export function SensitivityPanel({ calculation }: { calculation: ScenarioCalculation }) {
  const sensitivity = calculation.sensitivity;
  const currency = sensitivity.currency;

  const probabilitySeries: SeriesPoint[] = sensitivity.probability_sweep.map((point) => ({
    label: point.label,
    value: Number(point.expected_loss),
  }));
  const netLossSeries: SeriesPoint[] = sensitivity.net_loss_sweep.map((point) => ({
    label: point.label,
    value: Number(point.expected_loss),
  }));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Sensitivity to probability"
          description={`Expected loss as the probability varies, holding the net loss at ${formatMoney(sensitivity.net_loss_sweep[0]?.net_loss ?? null, currency)}.`}
          empty={probabilitySeries.length === 0}
          emptyMessage="No probability sweep was returned for this scenario."
        >
          <TrendLineChart data={probabilitySeries} primaryLabel="Expected loss" currency={currency} />
        </ChartCard>
        <ChartCard
          title="Sensitivity to net loss"
          description={`Expected loss as the net loss varies, holding the probability at ${formatPercent(sensitivity.baseline_probability, 1)}.`}
          empty={netLossSeries.length === 0}
          emptyMessage="No net-loss sweep was returned for this scenario."
        >
          <TrendLineChart data={netLossSeries} primaryLabel="Expected loss" currency={currency} />
        </ChartCard>
      </div>

      <DescriptionList
        columns={2}
        items={[
          {
            label: 'Baseline expected loss',
            value: formatMoney(sensitivity.baseline_expected_loss, currency),
          },
          {
            label: 'Break-even probability',
            value:
              sensitivity.break_even_probability === null ||
              sensitivity.break_even_probability === undefined
                ? 'Not available — no mitigation cost recorded'
                : formatPercent(sensitivity.break_even_probability, 1),
          },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared scenario form (also used by the Risk Scenarios workbench)
// ---------------------------------------------------------------------------

export interface ScenarioFormValues {
  name: string;
  scenario_type: string;
  risk_id: string;
  asset_id: string;
  description: string;
  assumptions: string;
  currency: string;
  time_horizon_months: string;
  probability: string;
  residual_probability: string;
  direct_loss: string;
  revenue_loss: string;
  downtime_hours: string;
  downtime_cost_per_hour: string;
  recovery_cost: string;
  incident_response_cost: string;
  regulatory_cost: string;
  other_cost: string;
  insurance_recovery: string;
  mitigation_cost: string;
}

export const EMPTY_SCENARIO_FORM: ScenarioFormValues = {
  name: '',
  scenario_type: 'base_case',
  risk_id: '',
  asset_id: '',
  description: '',
  assumptions: '',
  currency: 'USD',
  time_horizon_months: '12',
  probability: '0.1',
  residual_probability: '',
  direct_loss: '',
  revenue_loss: '',
  downtime_hours: '',
  downtime_cost_per_hour: '',
  recovery_cost: '',
  incident_response_cost: '',
  regulatory_cost: '',
  other_cost: '',
  insurance_recovery: '',
  mitigation_cost: '',
};

export function formFromScenario(scenario: FinancialScenario): ScenarioFormValues {
  return {
    name: scenario.name,
    scenario_type: scenario.scenario_type,
    risk_id: scenario.risk_id ? String(scenario.risk_id) : '',
    asset_id: scenario.asset_id ? String(scenario.asset_id) : '',
    description: scenario.description ?? '',
    assumptions: scenario.assumptions ?? '',
    currency: scenario.currency,
    time_horizon_months: String(scenario.time_horizon_months),
    probability: String(scenario.probability),
    residual_probability:
      scenario.residual_probability === null || scenario.residual_probability === undefined
        ? ''
        : String(scenario.residual_probability),
    direct_loss: scenario.direct_loss ?? '',
    revenue_loss: scenario.revenue_loss ?? '',
    downtime_hours:
      scenario.downtime_hours === null || scenario.downtime_hours === undefined
        ? ''
        : String(scenario.downtime_hours),
    downtime_cost_per_hour: scenario.downtime_cost_per_hour ?? '',
    recovery_cost: scenario.recovery_cost ?? '',
    incident_response_cost: scenario.incident_response_cost ?? '',
    regulatory_cost: scenario.regulatory_cost ?? '',
    other_cost: scenario.other_cost ?? '',
    insurance_recovery: scenario.insurance_recovery ?? '',
    mitigation_cost: scenario.mitigation_cost ?? '',
  };
}

export interface ScenarioFormErrors {
  name?: string;
  time_horizon_months?: string;
  probability?: string;
  residual_probability?: string;
  money?: string;
  downtime_hours?: string;
}

type MoneyFieldKey =
  | 'direct_loss'
  | 'revenue_loss'
  | 'downtime_cost_per_hour'
  | 'recovery_cost'
  | 'incident_response_cost'
  | 'regulatory_cost'
  | 'other_cost'
  | 'insurance_recovery'
  | 'mitigation_cost';

const MONEY_FIELDS: Array<{ key: MoneyFieldKey; label: string; hint: string }> = [
  { key: 'direct_loss', label: 'Direct loss', hint: 'Property, theft, replacement' },
  { key: 'revenue_loss', label: 'Revenue loss', hint: 'Lost margin, not turnover' },
  { key: 'downtime_cost_per_hour', label: 'Downtime cost per hour', hint: 'Rates the interruption cost' },
  { key: 'recovery_cost', label: 'Recovery cost', hint: 'Restore service, rebuild data' },
  { key: 'incident_response_cost', label: 'Incident response cost', hint: 'Forensics, legal, comms' },
  { key: 'regulatory_cost', label: 'Regulatory / contractual exposure', hint: 'Fines, penalties, SLAs' },
  { key: 'other_cost', label: 'Other defined losses', hint: 'Anything else you can name' },
  { key: 'insurance_recovery', label: 'Insurance recovery', hint: 'Capped at the gross loss' },
  { key: 'mitigation_cost', label: 'Mitigation cost', hint: 'Drives return on mitigation' },
];

export function validateScenarioForm(
  values: ScenarioFormValues,
  requireName: boolean,
): ScenarioFormErrors {
  const errors: ScenarioFormErrors = {};

  if (requireName && values.name.trim().length < 2) {
    errors.name = 'Enter at least two characters.';
  }

  const horizon = Number(values.time_horizon_months);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 120) {
    errors.time_horizon_months = 'Enter a whole number of months between 1 and 120.';
  }

  const probability = Number(values.probability);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    errors.probability = 'Enter a probability between 0 and 1 (0.1 is a 10% chance).';
  }

  if (values.residual_probability.trim()) {
    const residual = Number(values.residual_probability);
    if (!Number.isFinite(residual) || residual < 0 || residual > 1) {
      errors.residual_probability = 'Enter a probability between 0 and 1, or leave it blank.';
    }
  }

  if (values.downtime_hours.trim()) {
    const hours = Number(values.downtime_hours);
    if (!Number.isFinite(hours) || hours < 0) {
      errors.downtime_hours = 'Enter a number of hours of zero or more.';
    }
  }

  for (const field of MONEY_FIELDS) {
    const raw = values[field.key].trim();
    if (!raw) continue;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      errors.money = `${field.label}: enter an amount of zero or more, or leave it blank.`;
      break;
    }
  }

  return errors;
}

function numberOrUndefined(value: string): number | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function moneyOrNull(value: string): string | null {
  const raw = value.trim();
  return raw ? raw : null;
}

/** The numeric half of the form, ready for the preview endpoint. */
export function buildScenarioInputs(values: ScenarioFormValues): ScenarioInputs {
  return {
    currency: values.currency.trim() ? values.currency.trim().toUpperCase() : undefined,
    time_horizon_months: numberOrUndefined(values.time_horizon_months),
    probability: numberOrUndefined(values.probability),
    residual_probability: values.residual_probability.trim()
      ? Number(values.residual_probability)
      : null,
    direct_loss: moneyOrNull(values.direct_loss),
    revenue_loss: moneyOrNull(values.revenue_loss),
    downtime_hours: values.downtime_hours.trim() ? Number(values.downtime_hours) : null,
    downtime_cost_per_hour: moneyOrNull(values.downtime_cost_per_hour),
    recovery_cost: moneyOrNull(values.recovery_cost),
    incident_response_cost: moneyOrNull(values.incident_response_cost),
    regulatory_cost: moneyOrNull(values.regulatory_cost),
    other_cost: moneyOrNull(values.other_cost),
    insurance_recovery: moneyOrNull(values.insurance_recovery),
    mitigation_cost: moneyOrNull(values.mitigation_cost),
  };
}

export function buildScenarioPayload(values: ScenarioFormValues): Record<string, unknown> {
  return {
    name: values.name.trim(),
    scenario_type: values.scenario_type,
    risk_id: values.risk_id ? Number(values.risk_id) : null,
    asset_id: values.asset_id ? Number(values.asset_id) : null,
    description: values.description.trim() || null,
    assumptions: values.assumptions.trim() || null,
    ...buildScenarioInputs(values),
  };
}

export function ScenarioForm({
  values,
  errors,
  onChange,
  scenarioTypes,
  risks,
  assets,
  organizationCurrency,
}: {
  values: ScenarioFormValues;
  errors: ScenarioFormErrors;
  onChange: (patch: Partial<ScenarioFormValues>) => void;
  scenarioTypes: readonly string[];
  risks: RiskOption[];
  assets: AssetOption[];
  organizationCurrency: string;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Scenario name"
          required
          htmlFor="scenario-name"
          error={errors.name}
          className="sm:col-span-2 lg:col-span-3"
        >
          <Input
            id="scenario-name"
            value={values.name}
            invalid={Boolean(errors.name)}
            placeholder="e.g. Ransomware on the billing platform"
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </Field>

        <Field label="Type" htmlFor="scenario-type" hint="Best, base and worst cases are separate scenarios.">
          <Select
            id="scenario-type"
            value={values.scenario_type}
            options={toOptions(scenarioTypes)}
            onChange={(event) => onChange({ scenario_type: event.target.value })}
          />
        </Field>

        <Field label="Linked risk" htmlFor="scenario-risk">
          <Select
            id="scenario-risk"
            value={values.risk_id}
            placeholder="Not linked"
            options={risks.map((risk) => ({
              value: String(risk.id),
              label: `${risk.risk_ref} · ${risk.title}`,
            }))}
            onChange={(event) => onChange({ risk_id: event.target.value })}
          />
        </Field>

        <Field label="Linked asset" htmlFor="scenario-asset">
          <Select
            id="scenario-asset"
            value={values.asset_id}
            placeholder="Not linked"
            options={assets.map((asset) => ({
              value: String(asset.id),
              label: `${asset.asset_ref} · ${asset.name}`,
            }))}
            onChange={(event) => onChange({ asset_id: event.target.value })}
          />
        </Field>
      </div>

      <ScenarioInputFields
        values={values}
        errors={errors}
        onChange={onChange}
        organizationCurrency={organizationCurrency}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Description" htmlFor="scenario-description" className="sm:col-span-2">
          <Textarea
            id="scenario-description"
            value={values.description}
            rows={3}
            placeholder="What event does this scenario describe?"
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </Field>
        <Field
          label="Assumptions"
          htmlFor="scenario-assumptions"
          className="sm:col-span-2"
          hint="State what had to hold for these numbers to be defensible."
        >
          <Textarea
            id="scenario-assumptions"
            value={values.assumptions}
            rows={3}
            onChange={(event) => onChange({ assumptions: event.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

/** The numeric inputs alone, so the what-if workbench can reuse them. */
export function ScenarioInputFields({
  values,
  errors,
  onChange,
  organizationCurrency,
}: {
  values: ScenarioFormValues;
  errors: ScenarioFormErrors;
  onChange: (patch: Partial<ScenarioFormValues>) => void;
  organizationCurrency: string;
}) {
  const probability = Number(values.probability);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Currency"
          htmlFor="scenario-currency"
          hint={`Organization currency: ${organizationCurrency}`}
        >
          <Input
            id="scenario-currency"
            value={values.currency}
            maxLength={3}
            className="uppercase"
            onChange={(event) => onChange({ currency: event.target.value.toUpperCase() })}
          />
        </Field>

        <Field
          label="Time horizon (months)"
          required
          htmlFor="scenario-horizon"
          error={errors.time_horizon_months}
        >
          <Input
            id="scenario-horizon"
            type="number"
            min={1}
            max={120}
            value={values.time_horizon_months}
            invalid={Boolean(errors.time_horizon_months)}
            onChange={(event) => onChange({ time_horizon_months: event.target.value })}
          />
        </Field>

        <Field
          label="Probability"
          required
          htmlFor="scenario-probability"
          error={errors.probability}
          aside={Number.isFinite(probability) ? formatPercent(probability, 1) : undefined}
          hint="0 to 1 — the chance the scenario occurs within the horizon."
        >
          <Input
            id="scenario-probability"
            type="number"
            min={0}
            max={1}
            step="0.01"
            value={values.probability}
            invalid={Boolean(errors.probability)}
            onChange={(event) => onChange({ probability: event.target.value })}
          />
        </Field>

        <Field
          label="Residual probability"
          htmlFor="scenario-residual-probability"
          error={errors.residual_probability}
          aside={
            values.residual_probability.trim() && Number.isFinite(Number(values.residual_probability))
              ? formatPercent(Number(values.residual_probability), 1)
              : undefined
          }
          hint="Leave blank until a post-mitigation probability is defensible."
        >
          <Input
            id="scenario-residual-probability"
            type="number"
            min={0}
            max={1}
            step="0.01"
            value={values.residual_probability}
            invalid={Boolean(errors.residual_probability)}
            onChange={(event) => onChange({ residual_probability: event.target.value })}
          />
        </Field>
      </div>

      {errors.money ? (
        <p role="alert" className="text-2xs text-danger">
          {errors.money}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Downtime hours"
          htmlFor="scenario-downtime_hours"
          error={errors.downtime_hours}
          hint="Multiplied by the hourly cost to size the interruption."
        >
          <Input
            id="scenario-downtime_hours"
            type="number"
            min={0}
            step="0.5"
            value={values.downtime_hours}
            invalid={Boolean(errors.downtime_hours)}
            onChange={(event) => onChange({ downtime_hours: event.target.value })}
          />
        </Field>

        {MONEY_FIELDS.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            htmlFor={`scenario-${field.key}`}
            hint={field.hint}
          >
            <MoneyInput
              id={`scenario-${field.key}`}
              value={values[field.key]}
              onChange={(value) => onChange({ [field.key]: value } as Partial<ScenarioFormValues>)}
            />
          </Field>
        ))}
      </div>
    </div>
  );
}

/**
 * Money entry.
 *
 * Kept as a text field with a decimal keyboard rather than `type="number"`, so
 * the exact decimal the analyst typed is what is sent to the API instead of a
 * floating-point round trip.
 */
function MoneyInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      placeholder="Not estimated"
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        if (next === '' || /^\d*\.?\d*$/.test(next)) onChange(next);
      }}
    />
  );
}

function formulaText(formula: Record<string, string> | undefined): string | undefined {
  if (!formula) return undefined;
  const entries = Object.entries(formula);
  if (!entries.length) return undefined;
  return entries.map(([key, value]) => `${key.padEnd(24)} = ${value}`).join('\n');
}

export function scenarioErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}
