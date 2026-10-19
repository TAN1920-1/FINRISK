import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, FlaskConical, Play, RefreshCw, Sparkles } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDateTime, formatNumber, formatPercent, humanise } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useListState } from '@/hooks/useListState';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type {
  Insight,
  ModelStatus,
  ModelVersion,
  Prediction,
  RiskOption,
  TrainingResult,
} from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { Badge, SeverityBadge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { ActiveFilters, DateRangeFilter, FilterBar } from '@/components/ui/Filters';
import { CardSkeleton, EmptyState, ErrorState, NoticeBanner, Spinner } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/Form';
import { MethodologyPanel } from '@/components/ui/Methodology';

/**
 * AI Insights.
 *
 * Two very different things live on this screen and the page keeps them apart:
 *
 * * **Model output** — a priority class produced by the trained classifier. It
 *   is always rendered beside the deterministic rule-based class so a reviewer
 *   can see where the two disagree, and its confidence is described as a model
 *   score because the platform does not claim calibrated probabilities.
 * * **Insights** — plain counts, totals and rankings computed from stored rows.
 *   No language model is involved, which is why they are labelled with their
 *   basis and can be reproduced by hand from the database.
 */

type Dataset = 'stored' | 'synthetic';

interface TrainInput {
  dataset: Dataset;
  activate: boolean;
  syntheticRows: string;
}

export function AiInsightsPage() {
  const { can } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [trainOpen, setTrainOpen] = useState(false);
  const [dataset, setDataset] = useState<Dataset>('stored');
  const [syntheticRows, setSyntheticRows] = useState('320');
  const [activate, setActivate] = useState(true);
  const [riskId, setRiskId] = useState('');
  const [persistPrediction, setPersistPrediction] = useState(true);
  const [prediction, setPrediction] = useState<Prediction | null>(null);

  const insightFilters = useListState({ filterKeys: ['start_date', 'end_date'] as const });

  const status = useQuery({
    queryKey: queryKeys.modelStatus,
    queryFn: () => api.get<ModelStatus>('/api/ai/status'),
  });

  const models = useQuery({
    queryKey: queryKeys.models,
    queryFn: () => api.get<ModelVersion[]>('/api/ai/models'),
  });

  const riskOptions = useQuery({
    queryKey: queryKeys.riskOptions,
    queryFn: () => api.get<RiskOption[]>('/api/risks/options'),
    enabled: can('risk:write'),
  });

  const insights = useQuery({
    queryKey: queryKeys.insights(insightFilters.query),
    queryFn: () =>
      api.get<Insight[]>('/api/ai/insights', {
        query: {
          start_date: insightFilters.state.filters.start_date,
          end_date: insightFilters.state.filters.end_date,
        },
      }),
  });

  const trainMutation = useMutation({
    mutationFn: (input: TrainInput) =>
      api.post<TrainingResult>('/api/ai/train', {
        dataset: input.dataset,
        activate: input.activate,
        synthetic_rows: input.dataset === 'synthetic' ? Number(input.syntheticRows) : undefined,
      }),
    onSuccess: async (result) => {
      setTrainOpen(false);
      push({
        tone: 'success',
        title: 'Model trained',
        description: result.summary,
      });
      await queryClient.invalidateQueries({ queryKey: ['ai'] });
    },
  });

  const predictMutation = useMutation({
    mutationFn: () =>
      api.post<Prediction>('/api/ai/predict', {
        risk_id: Number(riskId),
        persist: persistPrediction,
      }),
    onSuccess: (result) => {
      setPrediction(result);
      push({
        tone: result.agrees_with_rules ? 'info' : 'warning',
        title: `Model class: ${humanise(result.predicted_class)}`,
        description: result.agrees_with_rules
          ? 'The model agrees with the rule-based classification.'
          : `The rule-based classification is ${humanise(result.rule_based_class)}. Review before acting.`,
      });
    },
  });

  const dateFilterActive = Boolean(
    insightFilters.state.filters.start_date || insightFilters.state.filters.end_date,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Insights"
        description={
          <>
            A priority classifier and a set of deterministic portfolio insights. Both are decision
            support: a reviewer owns every conclusion drawn from them.
          </>
        }
        actions={
          <Button
            variant="outline"
            icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            loading={status.isFetching}
            onClick={() => void status.refetch()}
          >
            Refresh status
          </Button>
        }
      />

      <NoticeBanner tone="warning" title="What this page is not">
        No language model writes anything here. The classifier predicts a priority class from context
        features, and every insight is a count, total or ranking computed from stored rows that you can
        reproduce by hand. Model scores are not probabilities, and feature attributions describe model
        behaviour rather than cause and effect.
      </NoticeBanner>

      {status.isPending ? (
        <CardSkeleton lines={3} />
      ) : status.isError ? (
        <ErrorState
          error={status.error}
          onRetry={() => void status.refetch()}
          title="Could not load the model status"
        />
      ) : (
        <Card>
          <CardHeader
            title="Model status"
            description="What this deployment can honestly claim about its model right now."
            actions={
              can('ai:train') ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<FlaskConical className="h-3.5 w-3.5" aria-hidden />}
                  disabled={!status.data.available}
                  onClick={() => setTrainOpen(true)}
                >
                  Train a version
                </Button>
              ) : undefined
            }
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={status.data.available ? 'low' : 'unknown'}>
                {status.data.available ? 'Active model available' : 'Rule-based classification only'}
              </Badge>
              {Object.entries(status.data.optional_runtime ?? {}).map(([name, present]) => (
                <Badge key={name} tone={present ? 'primary' : 'unknown'}>
                  {present ? `${name} available` : `${name} not installed`}
                </Badge>
              ))}
            </div>

            <p className="text-xs text-muted">{status.data.detail}</p>

            <DescriptionList
              columns={2}
              items={[
                { label: 'Prediction target', value: status.data.target_label },
                {
                  label: 'Minimum rows to train on stored data',
                  value: formatNumber(status.data.minimum_training_rows),
                },
                {
                  label: 'Target description',
                  value: status.data.target_description,
                  span: true,
                },
                {
                  label: 'Risk entries available to train on',
                  value: formatNumber(status.data.stored_rows_available),
                },
              ]}
            />

            {status.data.active_model ? (
              <div className="rounded border border-border bg-surface-muted/40 p-3">
                <p className="text-2xs font-medium uppercase tracking-wide text-muted">Active model</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {status.data.active_model.version} · {status.data.active_model.algorithm}
                </p>
                <p className="mt-0.5 text-2xs text-muted">
                  Trained {formatDateTime(status.data.active_model.trained_at)} on{' '}
                  {humanise(status.data.active_model.dataset_kind)} data (
                  {formatNumber(status.data.active_model.dataset_rows)} rows) · macro F1{' '}
                  {metricValue(status.data.active_model, 'macro_f1')}
                </p>
              </div>
            ) : (
              <NoticeBanner tone="info" title="No model has been trained yet">
                Predictions currently fall back to the documented 5x5 likelihood x impact matrix. That
                fallback is reported as such on every prediction rather than being presented as a model
                output.
              </NoticeBanner>
            )}

            {status.data.feature_schema?.length ? (
              <details className="rounded border border-border bg-surface-muted/40 px-3 py-2">
                <summary className="cursor-pointer text-2xs font-medium uppercase tracking-wide text-muted">
                  Features the model is allowed to see ({status.data.feature_schema.length})
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {status.data.feature_schema.map((feature) => (
                    <li key={feature.key} className="text-2xs">
                      <span className="font-medium text-foreground">{feature.label}</span>
                      <span className="text-muted"> — {feature.description}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-2xs text-muted">
                  Likelihood and impact are deliberately excluded so the model cannot read the answer
                  off the label definition.
                </p>
              </details>
            ) : null}
          </CardBody>
        </Card>
      )}

      {can('risk:write') ? (
        <Card>
          <CardHeader
            title="Classify a risk entry"
            description="The model's class is always shown beside the rule-based class so you can compare the two and disagree."
          />
          <CardBody className="space-y-4">
            {riskOptions.isPending ? (
              <Spinner label="Loading the risk register…" />
            ) : riskOptions.isError ? (
              <ErrorState
                error={riskOptions.error}
                onRetry={() => void riskOptions.refetch()}
                title="Could not load the risk list"
              />
            ) : riskOptions.data.length === 0 ? (
              <EmptyState
                title="No risks to classify"
                description="Add a risk register entry first; the classifier works on a single stored risk."
                action={
                  <Button variant="primary" onClick={() => navigate('/risks')}>
                    Open the risk register
                  </Button>
                }
              />
            ) : (
              <>
                <Field
                  label="Risk register entry"
                  htmlFor="ai-predict-risk"
                  hint={`${riskOptions.data.length} risk(s) in this organization.`}
                >
                  <Select
                    id="ai-predict-risk"
                    value={riskId}
                    onChange={(event) => setRiskId(event.target.value)}
                    placeholder="Choose a risk…"
                    options={riskOptions.data.map((risk) => ({
                      value: String(risk.id),
                      label: `${risk.risk_ref} · ${risk.title}`,
                    }))}
                  />
                </Field>
                <Checkbox
                  label="Record this prediction in the audit trail"
                  hint="The prediction and its explanation are written to the audit log either way when this is on."
                  checked={persistPrediction}
                  onChange={(event) => setPersistPrediction(event.target.checked)}
                />
                <Button
                  variant="primary"
                  icon={<Play className="h-3.5 w-3.5" aria-hidden />}
                  disabled={!riskId}
                  loading={predictMutation.isPending}
                  onClick={() => predictMutation.mutate()}
                >
                  Classify
                </Button>
                {predictMutation.isError ? (
                  <NoticeBanner tone="danger" title="The risk could not be classified">
                    {errorMessage(predictMutation.error)}
                  </NoticeBanner>
                ) : null}
              </>
            )}

            {prediction ? <PredictionPanel prediction={prediction} /> : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Registered model versions"
          description="Every version that has been trained, with the evaluation metrics recorded at training time."
          actions={
            can('report:read') ? (
              <Link
                to="/reports?report_type=model_evaluation"
                className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline"
              >
                Model evaluation report
                <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            ) : undefined
          }
        />
        <DataTable<ModelVersion>
          columns={MODEL_COLUMNS}
          rows={models.data ?? []}
          rowKey={(model) => model.id}
          loading={models.isPending}
          error={models.isError ? models.error : undefined}
          onRetry={() => void models.refetch()}
          emptyTitle="No model has been trained yet"
          emptyDescription="Train a version to record its algorithm, dataset and held-out evaluation metrics here."
        />
      </Card>

      <section className="space-y-3" aria-label="Deterministic insights">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground">
              <Sparkles className="h-4 w-4 text-muted" aria-hidden />
              Portfolio insights
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Deterministic findings computed from stored rows. Each one names the records behind it.
            </p>
          </div>
        </div>

        <Card>
          <FilterBar>
            <DateRangeFilter
              label="Risk raised between"
              startDate={insightFilters.state.filters.start_date ?? ''}
              endDate={insightFilters.state.filters.end_date ?? ''}
              onChange={(range) =>
                insightFilters.setFilters({
                  start_date: range.startDate,
                  end_date: range.endDate,
                })
              }
            />
          </FilterBar>
          <div className="px-4 py-3">
            <ActiveFilters
              filters={[
                dateFilterActive
                  ? {
                      key: 'period',
                      label: 'Limited to a date range',
                      onClear: () => insightFilters.clearFilters(),
                    }
                  : null,
              ]}
              onClearAll={() => insightFilters.clearFilters()}
            />
          </div>
        </Card>

        {insights.isPending ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <CardSkeleton key={index} lines={2} />
            ))}
          </div>
        ) : insights.isError ? (
          <ErrorState
            error={insights.error}
            onRetry={() => void insights.refetch()}
            title="Could not load the insights"
          />
        ) : insights.data.length === 0 ? (
          <EmptyState
            title="No insights to report"
            description="The organization has nothing to summarise yet, which is not the same as having no risk."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {insights.data.map((insight) => (
              <InsightCard key={insight.key} insight={insight} onOpen={navigate} />
            ))}
          </div>
        )}
      </section>

      <MethodologyPanel
        title="How the classifier and the insights work"
        methodology={
          status.data?.target_description ??
          'The classifier predicts the severity band of a risk register entry from context features.'
        }
        formula="class = argmax over critical | high | medium | low (context features only)"
        limitations={
          status.data?.limitations ??
          'Predictions are decision support and are never a substitute for a reviewer’s judgement.'
        }
      />

      <Dialog
        open={trainOpen}
        onClose={() => setTrainOpen(false)}
        title="Train a new model version"
        description="Several candidate algorithms are fitted and scored on a held-out split; the best one is kept. Training on stored data uses only this organization's risk register."
        footer={
          <>
            <Button variant="ghost" onClick={() => setTrainOpen(false)} disabled={trainMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={trainMutation.isPending}
              onClick={() => trainMutation.mutate({ dataset, activate, syntheticRows })}
            >
              Train model
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label="Training data"
            hint="Synthetic rows are a demonstration device generated by a documented random process. They carry no information about your organization — retrain on stored data before relying on the model for prioritisation."
          >
            <Select
              value={dataset}
              onChange={(event) => setDataset(event.target.value as Dataset)}
              options={[
                {
                  value: 'stored',
                  label: `This organization's risk register (${formatNumber(
                    status.data?.stored_rows_available ?? 0,
                  )} rows)`,
                },
                { value: 'synthetic', label: 'Synthetic demonstration dataset' },
              ]}
            />
          </Field>

          {dataset === 'synthetic' ? (
            <Field label="Synthetic rows" hint="Between 40 and 5000 rows. Defaults to 320.">
              <Input
                type="number"
                min={40}
                max={5000}
                value={syntheticRows}
                onChange={(event) => setSyntheticRows(event.target.value)}
              />
            </Field>
          ) : null}

          <Checkbox
            label="Make this version the active model"
            hint="When cleared, the version is still recorded and evaluated, but predictions keep using the current model."
            checked={activate}
            onChange={(event) => setActivate(event.target.checked)}
          />

          <NoticeBanner tone="info" title="This takes the plan out of the request path">
            Fitting several models over a few hundred rows is not instant. The audit trail records who
            trained which version from which dataset and what its held-out macro F1 was.
          </NoticeBanner>

          {trainMutation.isError ? (
            <NoticeBanner tone="danger" title="Training failed">
              {errorMessage(trainMutation.error)}
            </NoticeBanner>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model table
// ---------------------------------------------------------------------------

function metricValue(model: ModelVersion, key: string): string {
  const raw = model.metrics?.[key];
  return typeof raw === 'number' ? raw.toFixed(3) : '—';
}

const MODEL_COLUMNS: Array<Column<ModelVersion>> = [
  {
    key: 'version',
    header: 'Version',
    cell: (model) => (
      <span className="block">
        <span className="block font-medium text-foreground">{model.version}</span>
        <span className="block text-2xs text-muted">{model.algorithm}</span>
      </span>
    ),
  },
  {
    key: 'dataset',
    header: 'Training data',
    hideOnMobile: true,
    cell: (model) => (
      <span className="block text-xs">
        {humanise(model.dataset_kind)}
        <span className="block text-2xs text-muted">{formatNumber(model.dataset_rows)} rows</span>
      </span>
    ),
  },
  {
    key: 'macro_f1',
    header: 'Macro F1',
    align: 'right',
    headerTitle: 'Unweighted mean F1 across the four priority classes on the held-out split.',
    cell: (model) => <span className="tabular-nums">{metricValue(model, 'macro_f1')}</span>,
  },
  {
    key: 'accuracy',
    header: 'Accuracy',
    align: 'right',
    hideOnMobile: true,
    cell: (model) => <span className="tabular-nums">{metricValue(model, 'accuracy')}</span>,
  },
  {
    key: 'state',
    header: 'State',
    cell: (model) =>
      model.is_active ? (
        <Badge tone="primary">Active</Badge>
      ) : model.is_fallback ? (
        <Badge tone="unknown">Rules fallback</Badge>
      ) : (
        <Badge tone="neutral">Superseded</Badge>
      ),
  },
  {
    key: 'trained_at',
    header: 'Trained',
    hideOnMobile: true,
    cell: (model) => <span className="text-2xs text-muted">{formatDateTime(model.trained_at)}</span>,
  },
];

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

function PredictionPanel({ prediction }: { prediction: Prediction }) {
  const probabilities = Object.entries(prediction.class_probabilities ?? {});

  return (
    <div className="space-y-3 rounded border border-border bg-surface-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs font-medium uppercase tracking-wide text-muted">Model class</span>
        <SeverityBadge severity={prediction.predicted_class} />
        <span className="text-2xs font-medium uppercase tracking-wide text-muted">Rule-based class</span>
        <SeverityBadge severity={prediction.rule_based_class} />
        <Badge tone={prediction.agrees_with_rules ? 'low' : 'medium'}>
          {prediction.agrees_with_rules ? 'Agrees with the rules' : 'Disagrees with the rules'}
        </Badge>
        {prediction.used_fallback ? <Badge tone="unknown">Rule-based fallback</Badge> : null}
      </div>

      <p className="text-2xs text-muted">
        {prediction.model_version} · {prediction.algorithm} · trained on{' '}
        {humanise(prediction.dataset_kind)} data
      </p>

      {prediction.confidence !== null && prediction.confidence !== undefined ? (
        <p className="text-xs text-foreground">
          Model score <span className="tabular-nums">{formatPercent(prediction.confidence, 1)}</span>{' '}
          <span className="text-2xs text-muted">
            {prediction.confidence_is_calibrated
              ? '(calibrated against observed outcomes)'
              : '— a model score, not a calibrated probability'}
          </span>
        </p>
      ) : null}

      {probabilities.length ? (
        <div>
          <p className="text-2xs font-medium uppercase tracking-wide text-muted">Class scores</p>
          <ul className="mt-1 space-y-1">
            {probabilities.map(([label, value]) => (
              <li key={label} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-2xs text-muted">{humanise(label)}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded bg-surface-muted">
                  <span
                    className="block h-full rounded bg-primary"
                    style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right text-2xs tabular-nums text-foreground">
                  {formatPercent(value, 1)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {prediction.contributions?.length ? (
        <div>
          <p className="text-2xs font-medium uppercase tracking-wide text-muted">
            What moved the score
          </p>
          <ul className="mt-1 space-y-1">
            {prediction.contributions.slice(0, 8).map((contribution) => (
              <li key={contribution.key} className="flex items-center justify-between gap-2 text-2xs">
                <span className="truncate text-foreground">{contribution.label}</span>
                <span
                  className={cn(
                    'shrink-0 tabular-nums',
                    contribution.direction === 'increases_risk'
                      ? 'text-danger'
                      : contribution.direction === 'reduces_risk'
                        ? 'text-risk-low'
                        : 'text-muted',
                  )}
                >
                  {contribution.contribution > 0 ? '+' : ''}
                  {contribution.contribution.toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-2xs text-muted">
            Attributions describe how the model behaved on this row; they are not causal statements.
          </p>
        </div>
      ) : null}

      {prediction.recommendations?.length ? (
        <div>
          <p className="text-2xs font-medium uppercase tracking-wide text-muted">Suggested next checks</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-2xs text-foreground">
            {prediction.recommendations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {prediction.warnings?.length ? (
        <NoticeBanner tone="warning" title="Warnings attached to this prediction">
          <ul className="list-inside list-disc space-y-0.5">
            {prediction.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </NoticeBanner>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

type InsightItem = Record<string, unknown>;

function InsightCard({ insight, onOpen }: { insight: Insight; onOpen: (to: string) => void }) {
  const items = insight.items ?? [];

  return (
    <Card>
      <CardHeader
        title={insight.title}
        description={insight.summary}
        actions={
          <div className="flex items-center gap-2">
            {insight.metric ? <Badge tone="neutral">{insight.metric}</Badge> : null}
            <SeverityBadge severity={insight.severity} />
          </div>
        }
      />
      {items.length === 0 ? (
        <p className="px-4 py-3 text-2xs text-muted">
          Nothing to list — the summary above is the whole finding.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item, index) => (
            <li key={String(item.id ?? item.risk_id ?? item.asset_id ?? item.finding_id ?? index)}>
              {renderInsightItem(insight.key, item, onOpen)}
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-border px-4 py-2 text-2xs text-muted">
        Basis: {humanise(insight.basis)} — computed from stored records, not generated by a model.
      </div>
    </Card>
  );
}

function renderInsightItem(
  key: string,
  item: InsightItem,
  onOpen: (to: string) => void,
): ReactNode {
  switch (key) {
    case 'severity_mix':
      return insightRow(onOpen, {
        primary: humanise(text(item.severity)),
        trailing: <span className="text-xs tabular-nums text-foreground">{text(item.count)}</span>,
      });

    case 'exposure_concentration':
      return insightRow(onOpen, {
        primary: text(item.business_unit),
        secondary: `Expected loss ${text(item.expected_loss)}`,
        trailing: (
          <span className="text-xs tabular-nums text-foreground">
            {formatPercent(typeof item.share === 'number' ? item.share : null)}
          </span>
        ),
      });

    case 'exposed_assets':
      return insightRow(onOpen, {
        to: `/assets/${text(item.asset_id)}`,
        primary: `${text(item.asset_ref)} · ${text(item.name)}`,
        secondary: `Criticality ${text(item.criticality)}/5`,
        trailing: <Badge tone="high">{`${text(item.open_findings)} open`}</Badge>,
      });

    case 'unresolved_key_findings':
      return insightRow(onOpen, {
        to: `/cybersecurity/${text(item.finding_id)}`,
        primary: item.cve_id ? `${text(item.cve_id)} · ${text(item.title)}` : text(item.title),
        secondary: item.exploit_evidence
          ? 'Exploitation evidence recorded'
          : 'No exploitation evidence recorded',
        trailing: (
          <SeverityBadge
            severity={typeof item.priority_band === 'string' ? item.priority_band : null}
            suffix={item.priority_score != null ? text(item.priority_score) : undefined}
          />
        ),
      });

    case 'mitigation_load':
      return insightRow(onOpen, {
        to: '/mitigation-plans',
        primary: `${text(item.action_ref)} · ${humanise(text(item.status))}`,
        secondary: item.due_date ? `Due ${text(item.due_date)}` : 'No due date recorded',
        trailing: (
          <SeverityBadge severity={typeof item.priority === 'string' ? item.priority : null} />
        ),
      });

    default:
      // The risk-shaped insights: overdue_high_risks, weak_evidence, stale_risks.
      return insightRow(onOpen, {
        to: `/risks/${text(item.risk_id)}`,
        primary: `${text(item.risk_ref)} · ${text(item.title)}`,
        secondary: riskSecondary(item),
        trailing: <SeverityBadge severity={typeof item.severity === 'string' ? item.severity : null} />,
      });
  }
}

function riskSecondary(item: InsightItem): string {
  const parts = [`Score ${text(item.score)}`];
  if (item.days_overdue !== undefined) parts.push(`${text(item.days_overdue)} days overdue`);
  if (item.days_open !== undefined) parts.push(`open ${text(item.days_open)} days`);
  if (item.evidence_quality !== undefined) {
    parts.push(`evidence ${humanise(text(item.evidence_quality))}`);
  }
  if (item.due_date) parts.push(`due ${text(item.due_date)}`);
  return parts.join(' · ');
}

function insightRow(
  onOpen: (to: string) => void,
  options: { to?: string; primary: ReactNode; secondary?: ReactNode; trailing?: ReactNode },
): ReactNode {
  const body = (
    <>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">{options.primary}</p>
        {options.secondary ? <p className="mt-0.5 text-2xs text-muted">{options.secondary}</p> : null}
      </div>
      {options.trailing ? <div className="shrink-0">{options.trailing}</div> : null}
    </>
  );

  if (!options.to) {
    return <div className="flex items-start justify-between gap-3 px-4 py-2.5">{body}</div>;
  }

  const target = options.to;
  return (
    <button
      type="button"
      onClick={() => onOpen(target)}
      className="flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-muted/70"
    >
      {body}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return formatNumber(value, { maximumFractionDigits: 2 });
  return String(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}
