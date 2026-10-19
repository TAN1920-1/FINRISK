import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, GitCompareArrows, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatMoney, formatPercent, humanise, toOptions } from '@/lib/format';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type {
  AssetOption,
  FinancialScenario,
  Page,
  RiskOption,
  ScenarioCalculation,
  ScenarioInputs,
  ScenarioMeta,
  SeriesPoint,
} from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { Tabs } from '@/components/ui/Tabs';
import { CategoryBarChart, ChartCard } from '@/components/ui/Charts';
import { CardSkeleton, EmptyState, NoticeBanner, Spinner } from '@/components/ui/Feedback';
import { Checkbox } from '@/components/ui/Form';
import { MethodologyPanel } from '@/components/ui/Methodology';
import {
  EMPTY_SCENARIO_FORM,
  LossBreakdownPanel,
  ScenarioForm,
  SensitivityPanel,
  buildScenarioInputs,
  buildScenarioPayload,
  scenarioErrorMessage,
  validateScenarioForm,
  type ScenarioFormErrors,
  type ScenarioFormValues,
} from './FinancialExposure';

/**
 * Risk scenarios — the what-if workbench.
 *
 * This screen is deliberately separate from the Financial Exposure register:
 * here nothing is stored until the analyst decides it is worth keeping. The
 * preview runs the same loss engine the saved register uses, so a figure seen
 * here and the same figure after saving cannot disagree.
 */

const MAX_COMPARISON = 5;

export function RiskScenariosPage() {
  const { can } = useAuth();

  const meta = useQuery({
    queryKey: queryKeys.scenarioMeta,
    queryFn: () => api.get<ScenarioMeta>('/api/financial-scenarios/meta'),
    staleTime: 5 * 60_000,
  });

  if (meta.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader title="Risk Scenarios" description="Loading the loss model…" />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Risk Scenarios"
        description="Model a what-if case and compare it against the scenarios already on the register. Nothing is stored until you choose to save it."
      />

      <NoticeBanner tone="info" title="How the workbench works">
        The preview is calculated by the same documented loss engine that produces the figures on
        the Financial Exposure register, so the two cannot drift apart. A component you leave blank
        is reported as not estimated, never as zero.
      </NoticeBanner>

      <Tabs
        items={[
          {
            id: 'what-if',
            label: 'What-if calculator',
            content: <WhatIfPanel canWrite={can('risk:write')} meta={meta.data} />,
          },
          {
            id: 'compare',
            label: 'Compare scenarios',
            content: <ComparePanel />,
          },
        ]}
      />

      <MethodologyPanel
        title="How these figures are produced"
        methodology="Every amount on this screen is the output of the API's loss engine applied to the inputs shown. The browser performs no arithmetic on money."
        formula={formulaText(meta.data?.formula)}
        limitations="A what-if result is an estimate for the inputs and the time horizon you chose. It is not a forecast, and it says nothing about the probability that the scenario actually occurs."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// What-if calculator
// ---------------------------------------------------------------------------

function WhatIfPanel({ canWrite, meta }: { canWrite: boolean; meta: ScenarioMeta | undefined }) {
  const { push } = useToast();
  const queryClient = useQueryClient();

  const [values, setValues] = useState<ScenarioFormValues>(EMPTY_SCENARIO_FORM);
  const [errors, setErrors] = useState<ScenarioFormErrors>({});
  const [preview, setPreview] = useState<ScenarioCalculation | null>(null);

  const organizationCurrency = meta?.organization_currency;

  // Adopt the organization's currency while the field is still untouched.
  useEffect(() => {
    if (!organizationCurrency) return;
    setValues((current) =>
      current.currency === EMPTY_SCENARIO_FORM.currency && organizationCurrency !== current.currency
        ? { ...current, currency: organizationCurrency }
        : current,
    );
  }, [organizationCurrency]);

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
    onSuccess: (result) => setPreview(result),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<FinancialScenario>('/api/financial-scenarios', payload),
    onSuccess: async (scenario) => {
      push({
        tone: 'success',
        title: 'Scenario saved to the register',
        description: scenario.calculation
          ? `${scenario.name}: expected loss ${formatMoney(scenario.calculation.expected_loss, scenario.currency)}.`
          : scenario.name,
      });
      setPreview(null);
      setValues((current) => ({ ...current, name: '' }));
      await queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    },
    onError: (error) => {
      push({ tone: 'error', title: 'The scenario was not saved', description: scenarioErrorMessage(error) });
    },
  });

  const runPreview = () => {
    const validation = validateScenarioForm(values, false);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    previewMutation.mutate(buildScenarioInputs(values));
  };

  const save = () => {
    const validation = validateScenarioForm(values, true);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    saveMutation.mutate(buildScenarioPayload(values));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Model a scenario"
          description="Set the inputs, then preview the loss calculation. Only the name and the two scoring inputs are required to save."
          actions={
            <>
              <Button
                variant="outline"
                icon={<Calculator className="h-3.5 w-3.5" aria-hidden />}
                loading={previewMutation.isPending}
                onClick={runPreview}
              >
                Preview calculation
              </Button>
              {canWrite ? (
                <Button
                  variant="primary"
                  icon={<Save className="h-3.5 w-3.5" aria-hidden />}
                  loading={saveMutation.isPending}
                  onClick={save}
                >
                  Save to register
                </Button>
              ) : null}
            </>
          }
        />
        <CardBody>
          <ScenarioForm
            values={values}
            errors={errors}
            onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
            scenarioTypes={meta?.scenario_types ?? []}
            risks={riskOptions.data ?? []}
            assets={assetOptions.data ?? []}
            organizationCurrency={organizationCurrency ?? 'USD'}
          />

          {previewMutation.isError ? (
            <NoticeBanner tone="danger" title="The preview could not be calculated" className="mt-4">
              {scenarioErrorMessage(previewMutation.error)}
            </NoticeBanner>
          ) : null}
        </CardBody>
      </Card>

      {previewMutation.isPending && !preview ? (
        <Card>
          <CardBody>
            <Spinner label="Running the loss engine…" />
          </CardBody>
        </Card>
      ) : null}

      {preview ? (
        <div className="space-y-4">
          <NoticeBanner tone="warning" title="This result is not stored">
            Saving the scenario records the inputs, not this snapshot. Re-open it later and the
            figure is recalculated from the same inputs.
          </NoticeBanner>
          <LossBreakdownPanel breakdown={preview.breakdown} title="Preview — unsaved inputs" />
          <SensitivityPanel calculation={preview} />
        </div>
      ) : (
        <Card>
          <CardBody>
            <EmptyState
              title="No preview yet"
              description="Fill in the inputs above and run a preview to see the loss breakdown and the sensitivity of the result."
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function ComparePanel() {
  const [selected, setSelected] = useState<number[]>([]);

  const catalog = useQuery({
    queryKey: queryKeys.scenarios({ page_size: 100, sort: 'name', order: 'asc', comparison: true }),
    queryFn: () =>
      api.get<Page<FinancialScenario>>('/api/financial-scenarios', {
        query: { page_size: 100, sort: 'name', order: 'asc' },
      }),
  });

  const compare = useQuery({
    queryKey: queryKeys.scenarioCompare(selected.join(',')),
    queryFn: () =>
      api.get<FinancialScenario[]>(
        `/api/financial-scenarios/compare?${selected.map((id) => `ids=${id}`).join('&')}`,
      ),
    enabled: selected.length > 0,
  });

  const rows = compare.data ?? [];
  const currencies = Array.from(new Set(rows.map((scenario) => scenario.currency)));
  const singleCurrency = currencies.length === 1 ? currencies[0] : null;

  const chartData: SeriesPoint[] = singleCurrency
    ? rows.map((scenario) => ({
        label: scenario.name,
        value: Number(scenario.calculation?.expected_loss ?? 0),
      }))
    : [];

  const toggle = (id: number) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= MAX_COMPARISON) return current;
      return [...current, id];
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <Card>
        <CardHeader
          title="Choose scenarios"
          description={`Select up to ${MAX_COMPARISON}. ${selected.length} selected.`}
          actions={
            selected.length ? (
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
            ) : null
          }
        />
        <div className="max-h-[28rem] overflow-y-auto px-4 py-3">
          {catalog.isPending ? (
            <Spinner label="Loading saved scenarios…" />
          ) : catalog.isError ? (
            <NoticeBanner tone="danger" title="The scenario list could not be loaded">
              {scenarioErrorMessage(catalog.error)}
            </NoticeBanner>
          ) : !catalog.data?.items.length ? (
            <EmptyState
              title="No scenarios saved yet"
              description="Use the what-if calculator to model one, then save it to the register."
            />
          ) : (
            <ul className="space-y-2">
              {catalog.data.items.map((scenario) => {
                const checked = selected.includes(scenario.id);
                const disabled = !checked && selected.length >= MAX_COMPARISON;
                return (
                  <li key={scenario.id}>
                    <div className={disabled ? 'opacity-50' : undefined}>
                      <Checkbox
                        label={scenario.name}
                        hint={`${humanise(scenario.scenario_type)} · ${scenario.currency} · expected ${formatMoney(
                          scenario.calculation?.expected_loss ?? null,
                          scenario.currency,
                        )}`}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(scenario.id)}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <div className="space-y-4">
        {!selected.length ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<GitCompareArrows className="h-5 w-5" aria-hidden />}
                title="Nothing to compare yet"
                description="Pick one or more scenarios on the left. Each one is recalculated by the API so the comparison reflects its stored inputs."
              />
            </CardBody>
          </Card>
        ) : compare.isPending ? (
          <Card>
            <CardBody>
              <Spinner label="Calculating the comparison…" />
            </CardBody>
          </Card>
        ) : compare.isError ? (
          <NoticeBanner tone="danger" title="The comparison could not be calculated">
            {scenarioErrorMessage(compare.error)}
          </NoticeBanner>
        ) : (
          <>
            {!singleCurrency ? (
              <NoticeBanner tone="warning" title="These scenarios use different currencies">
                Amounts are shown in each scenario's own currency and are deliberately not summed or
                converted. Compare them only after restating them in a common currency outside this
                screen.
              </NoticeBanner>
            ) : null}

            <Card>
              <CardHeader
                title="Side by side"
                description={
                  singleCurrency
                    ? `All amounts in ${singleCurrency}.`
                    : `Amounts are shown in ${currencies.join(', ')} and are not comparable directly.`
                }
              />
              <DataTable<FinancialScenario>
                caption="Scenario comparison"
                columns={comparisonColumns}
                rows={rows}
                rowKey={(scenario) => scenario.id}
                emptyTitle="No scenarios returned"
                emptyDescription="The selected scenarios could not be found in this organization."
              />
            </Card>

            {chartData.length ? (
              <ChartCard
                title="Expected loss by scenario"
                description="Probability-weighted exposure as the API calculated it for each scenario."
                height={240}
                footnote="Bars are drawn from the calculated expected loss. No total is shown because the scenarios are alternatives, not additive parts of a portfolio."
                empty={chartData.length === 0}
              >
                <CategoryBarChart data={chartData} valueLabel="Expected loss" />
              </ChartCard>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

const comparisonColumns: Array<Column<FinancialScenario>> = [
  {
    key: 'name',
    header: 'Scenario',
    cell: (scenario) => (
      <span className="block max-w-xs">
        <span className="block truncate text-xs font-medium text-foreground">{scenario.name}</span>
        <span className="block truncate text-2xs text-muted">
          {scenario.risk_ref ? `${scenario.risk_ref} · ${scenario.risk_title ?? ''}` : 'Not linked to a risk'}
        </span>
      </span>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    cell: (scenario) => <Badge tone="neutral">{humanise(scenario.scenario_type)}</Badge>,
  },
  {
    key: 'probability',
    header: 'Probability',
    align: 'right',
    cell: (scenario) => (
      <span className="text-xs tabular-nums">{formatPercent(scenario.probability, 1)}</span>
    ),
  },
  {
    key: 'net',
    header: 'Net loss',
    align: 'right',
    hideOnMobile: true,
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
    cell: (scenario) => (
      <span className="text-xs font-medium tabular-nums text-foreground">
        {scenario.calculation ? formatMoney(scenario.calculation.expected_loss, scenario.currency) : '—'}
        <span className="ml-1 text-2xs font-normal text-muted">{scenario.currency}</span>
      </span>
    ),
  },
  {
    key: 'residual',
    header: 'Residual',
    align: 'right',
    hideOnMobile: true,
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
    cell: (scenario) => (
      <span className="text-xs tabular-nums">
        {scenario.calculation
          ? formatMoney(scenario.calculation.potential_avoided_loss, scenario.currency)
          : '—'}
      </span>
    ),
  },
  {
    key: 'rom',
    header: 'RoM',
    align: 'right',
    hideOnMobile: true,
    headerTitle: 'Return on mitigation: (avoided loss − mitigation cost) ÷ mitigation cost.',
    cell: (scenario) => (
      <span className="text-xs tabular-nums">
        {scenario.calculation?.return_on_mitigation === null ||
        scenario.calculation?.return_on_mitigation === undefined
          ? '—'
          : formatPercent(scenario.calculation.return_on_mitigation, 1)}
      </span>
    ),
  },
];

function formulaText(formula: Record<string, string> | undefined): string | undefined {
  if (!formula) return undefined;
  const entries = Object.entries(formula);
  if (!entries.length) return undefined;
  return entries.map(([key, value]) => `${key.padEnd(24)} = ${value}`).join('\n');
}

export { toOptions as scenarioTypeOptions };
