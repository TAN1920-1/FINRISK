import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CalendarClock,
  FileBarChart2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDateTime, formatMoney, formatRelative, humanise, toOptions } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useAuth } from '@/app/AuthProvider';
import type { Dashboard, KpiValue, Mitigation, Risk, RiskMeta } from '@/types/api';
import { cn } from '@/lib/cn';
import { KpiCard } from '@/components/ui/KpiCard';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { SeverityBadge, StatusBadge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import {
  AreaTrendChart,
  CategoryBarChart,
  ChartCard,
  DonutChart,
} from '@/components/ui/Charts';
import { ActiveFilters, DateRangeFilter, FilterBar, FilterSelect } from '@/components/ui/Filters';
import { CardSkeleton, EmptyState, ErrorState, NoticeBanner } from '@/components/ui/Feedback';
import { MethodologyPanel } from '@/components/ui/Methodology';

/**
 * Overview.
 *
 * Every figure on this screen is a value the API computed from stored records.
 * The screen never derives a total of its own, which is why the KPI grid renders
 * whatever the endpoint returns rather than a hand-picked list of numbers. A
 * sparkline is only drawn when the endpoint supplied a real series for that
 * metric, and the reporting period is the same date filter the API applies — no
 * range the backend cannot honour is offered.
 */
export function OverviewPage() {
  const { user, activeOrganization, can } = useAuth();
  const navigate = useNavigate();

  const list = useListState({
    filterKeys: ['start_date', 'end_date', 'category', 'severity', 'business_unit'] as const,
    defaultSort: 'inherent_score',
  });

  const dashboard = useQuery({
    queryKey: queryKeys.dashboard(list.query),
    queryFn: () =>
      api.get<Dashboard>('/api/dashboard', {
        query: list.query as Record<string, string>,
      }),
  });

  const meta = useQuery({
    queryKey: queryKeys.riskMeta,
    queryFn: () => api.get<RiskMeta>('/api/risks/meta'),
    staleTime: 5 * 60_000,
  });

  if (dashboard.isPending) {
    return (
      <div className="space-y-4">
        <CardSkeleton lines={3} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <CardSkeleton key={index} lines={1} />
          ))}
        </div>
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (dashboard.isError) {
    return (
      <ErrorState
        error={dashboard.error}
        onRetry={() => void dashboard.refetch()}
        title="Could not load the dashboard"
      />
    );
  }

  const data = dashboard.data;
  const currency = activeOrganization?.currency ?? data.organization.currency ?? 'USD';
  const firstName = (user?.full_name ?? '').trim().split(/\s+/)[0] || user?.email || 'there';
  const severityTotal = data.risks_by_severity.reduce((sum, point) => sum + point.value, 0);
  const createdSeries = data.risks_created_vs_resolved.points.map((point) => point.value);
  const startDate = list.state.filters.start_date ?? '';
  const activeRange =
    RANGE_PRESETS.find((preset) => preset.days !== null && startDate === isoDaysAgo(preset.days))?.id ??
    (startDate ? 'custom' : 'all');
  const isFiltered = Boolean(
    list.state.search ||
      startDate ||
      list.state.filters.end_date ||
      list.state.filters.category ||
      list.state.filters.severity ||
      list.state.filters.business_unit,
  );

  const applyRange = (days: number | null) =>
    list.setFilters({ start_date: days === null ? '' : isoDaysAgo(days), end_date: '' });

  return (
    <div className="space-y-5">
      <section className="card hero-surface relative overflow-hidden p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-widest text-primary">
              {data.organization.name}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {greeting()}, {firstName}
            </h1>
            <p className="mt-1 max-w-2xl text-xs text-muted">
              Here is the current risk posture across the organization. Figures are computed from
              stored records; financial values are documented estimates, not predictions.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                Reporting period: {data.organization.reporting_period_label ?? 'All time'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Last calculated {formatDateTime(data.generated_at)}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-medium',
                  DATA_STATE[data.data_state].className,
                )}
              >
                {DATA_STATE[data.data_state].label}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="outline"
              icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden />}
              onClick={() => navigate('/risks')}
            >
              Open risk register
            </Button>
            {can('report:read') ? (
              <Button
                variant="primary"
                icon={<FileBarChart2 className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => navigate('/reports')}
              >
                Generate a report
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {data.data_state === 'empty' ? (
        <NoticeBanner tone="info" title="No records yet">
          This organization has no risks, assets or findings recorded. Everything below will stay at
          zero until you enter data — an empty register is not the same as a low-risk posture.
        </NoticeBanner>
      ) : null}

      {data.data_state === 'demo_only' ? (
        <NoticeBanner tone="warning" title="Demonstration data only">
          Every record currently in this organization is synthetic demo data. Replace it before using
          these figures for any real decision.
        </NoticeBanner>
      ) : null}

      {data.notes?.length ? (
        <NoticeBanner tone="info" title="Notes from the calculation">
          <ul className="list-inside list-disc space-y-0.5">
            {data.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </NoticeBanner>
      ) : null}

      <section aria-label="Key indicators" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.kpis.map((kpi: KpiValue) => (
          <KpiCard
            key={kpi.key}
            kpi={kpi}
            series={kpi.key === 'risks_created_30d' ? createdSeries : undefined}
          />
        ))}
      </section>

      <Card>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5">
          <span className="mr-1 text-2xs font-medium uppercase tracking-wide text-muted">Period</span>
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={activeRange === preset.id}
              onClick={() => applyRange(preset.days)}
              className={cn(
                'rounded-md px-2 py-0.5 text-2xs font-medium transition-colors',
                activeRange === preset.id
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted hover:bg-surface-muted hover:text-foreground',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <FilterBar>
          <DateRangeFilter
            startDate={startDate}
            endDate={list.state.filters.end_date ?? ''}
            onChange={(range) =>
              list.setFilters({ start_date: range.startDate, end_date: range.endDate })
            }
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
            label="Business unit"
            value={list.state.filters.business_unit ?? ''}
            onChange={(value) => list.setFilter('business_unit', value)}
            options={(meta.data?.business_units ?? []).map((unit) => ({ value: unit, label: unit }))}
          />
        </FilterBar>
        <div className="px-4 py-3">
          <ActiveFilters
            filters={[
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
              list.state.filters.business_unit
                ? {
                    key: 'business_unit',
                    label: `Business unit: ${list.state.filters.business_unit}`,
                    onClear: () => list.setFilter('business_unit', ''),
                  }
                : null,
            ]}
            onClearAll={() => list.clearFilters()}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Risk distribution"
          description="Share of in-scope risks by severity band."
          empty={severityTotal === 0}
          emptyMessage="No risks match the current filters."
          height={220}
        >
          <div className="flex h-full items-center gap-4 px-2">
            <div className="h-full w-36 shrink-0">
              <DonutChart
                data={data.risks_by_severity}
                centreValue={severityTotal}
                centreLabel="risks"
                colourBySeverity
                showLegend={false}
              />
            </div>
            <ul className="min-w-0 flex-1 space-y-2">
              {data.risks_by_severity.map((point) => (
                <li key={point.label} className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn('h-2 w-2 shrink-0 rounded-full', SEVERITY_DOT[point.label] ?? 'bg-muted')}
                      aria-hidden
                    />
                    <span className="truncate capitalize text-foreground">{humanise(point.label)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">
                    <span className="text-foreground">{point.value}</span>
                    {severityTotal > 0 ? ` · ${Math.round((point.value / severityTotal) * 100)}%` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </ChartCard>

        <ChartCard
          title="Risks by category"
          description="Where the register's exposure is concentrated."
          empty={data.risks_by_category.length === 0}
          emptyMessage="No risks match the current filters."
          className="lg:col-span-2"
        >
          <CategoryBarChart data={data.risks_by_category} />
        </ChartCard>
      </div>

      <ChartCard
        title="Risks raised vs closed"
        description="Twelve-month view of records created and resolved."
        empty={data.risks_created_vs_resolved.points.every((point) => point.value === 0 && !point.secondary)}
        emptyMessage="No risk activity in the last twelve months."
      >
        <AreaTrendChart
          data={data.risks_created_vs_resolved.points}
          primaryLabel={data.risks_created_vs_resolved.name || 'Raised'}
          secondaryLabel="Resolved"
        />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={`Expected exposure by business unit (${currency})`}
          description="Sum of expected loss from scenarios linked to each unit."
          empty={data.exposure_by_business_unit.length === 0}
          emptyMessage="No scenarios with a business unit are in scope."
          footnote={`Estimates in ${currency}. Scenarios in another currency are excluded rather than converted.`}
        >
          <CategoryBarChart data={data.exposure_by_business_unit} valueLabel={currency} />
        </ChartCard>

        <ChartCard
          title="Active assets by criticality"
          description="Distribution of in-scope assets across the 1–5 criticality scale."
          empty={data.assets_by_criticality.length === 0}
          emptyMessage="No active assets recorded."
        >
          <CategoryBarChart data={data.assets_by_criticality} valueLabel="Assets" />
        </ChartCard>
      </div>

      <Card>
        <CardHeader
          title="Highest-ranked risks"
          description="Ranked by inherent score, then by recency. Open the register for the full set."
          actions={
            <Link
              to="/risks"
              className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline"
            >
              All risks
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          }
        />
        <DataTable<Risk>
          columns={topRiskColumns(navigate, currency)}
          rows={data.top_risks}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/risks/${row.id}`)}
          emptyTitle={isFiltered ? 'No risks match these filters' : 'No risks recorded yet'}
          emptyDescription={
            isFiltered
              ? 'Adjust or clear the filters to widen the search.'
              : 'Add the first risk to start building the register.'
          }
          filtered={isFiltered}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Mitigations coming due"
            description="Next five actions by due date, including those already overdue."
          />
          {data.upcoming_mitigations.length === 0 ? (
            <EmptyState
              title="No scheduled mitigations"
              description="Actions with a due date appear here so nothing slips quietly."
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.upcoming_mitigations.map((mitigation: Mitigation) => (
                <li key={mitigation.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-foreground">
                      {mitigation.action_ref} · {mitigation.description}
                    </p>
                    <p className="mt-0.5 text-2xs text-muted">
                      {mitigation.risk_ref ? `${mitigation.risk_ref} · ` : ''}
                      {mitigation.assigned_user_name ?? 'Unassigned'}
                      {mitigation.due_date ? ` · due ${mitigation.due_date}` : ' · no due date'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge
                      status={mitigation.is_overdue ? 'overdue' : mitigation.status}
                      tone={mitigation.is_overdue ? 'critical' : 'neutral'}
                    />
                    <SeverityBadge severity={mitigation.priority} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Recent activity"
            description="Latest entries from the audit trail for this organization."
            actions={
              can('audit:read') ? (
                <Link
                  to="/audit-logs"
                  className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline"
                >
                  Full audit trail
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              ) : undefined
            }
          />
          {data.recent_activity.length === 0 ? (
            <EmptyState title="No activity recorded yet" />
          ) : (
            <ul className="divide-y divide-border">
              {data.recent_activity.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs text-foreground">{humanise(entry.action)}</p>
                    <p className="mt-0.5 text-2xs text-muted">
                      {entry.user_email ?? 'system'}
                      {entry.entity_type ? ` · ${humanise(entry.entity_type)}` : ''}
                      {entry.entity_id ? ` #${entry.entity_id}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-2xs text-muted">{formatRelative(entry.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <MethodologyPanel
        methodology="The dashboard aggregates stored records for the active organization: risk counts by category and severity band, asset criticality distribution, and expected loss summed from financial scenarios. Filtering by a date range applies to when the risk was raised."
        limitations="Risks scored under a different band definition elsewhere will still be counted here using the platform's own likelihood x impact bands. Financial totals are shown per currency and are never converted or added across currencies. Where a scenario input was left blank, the estimate excludes it rather than assuming a value."
      />
    </div>
  );
}

/** Quick reporting-period presets. Each maps to the API's own date filter. */
const RANGE_PRESETS: Array<{ id: string; label: string; days: number | null }> = [
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
  { id: '6m', label: '6M', days: 182 },
  { id: '1y', label: '1Y', days: 365 },
  { id: 'all', label: 'All time', days: null },
];

const DATA_STATE: Record<Dashboard['data_state'], { label: string; className: string }> = {
  empty: { label: 'No records', className: 'bg-surface-muted text-muted' },
  demo_only: { label: 'Demo data', className: 'bg-warning/12 text-warning' },
  populated: { label: 'Live data', className: 'bg-success/12 text-success' },
};

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-risk-critical',
  high: 'bg-risk-high',
  medium: 'bg-risk-medium',
  low: 'bg-risk-low',
  unknown: 'bg-risk-unknown',
};

function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Local-time ISO date, `days` before today. */
function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function topRiskColumns(
  navigate: (to: string) => void,
  currency: string,
): Array<Column<Risk>> {
  return [
    {
      key: 'ref',
      header: 'Reference',
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
      cell: (risk) => (
        <span className="block max-w-md">
          <span className="block truncate text-xs font-medium text-foreground">{risk.title}</span>
          <span className="block truncate text-2xs text-muted">
            {humanise(risk.category)}
            {risk.business_unit ? ` · ${risk.business_unit}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'score',
      header: 'Inherent',
      align: 'right',
      hideOnMobile: true,
      cell: (risk) => <span className="tabular-nums">{risk.inherent_score}</span>,
    },
    {
      key: 'severity',
      header: 'Severity',
      cell: (risk) => <SeverityBadge severity={risk.severity} />,
    },
    {
      key: 'exposure',
      header: `Expected (${currency})`,
      align: 'right',
      hideOnMobile: true,
      headerTitle: 'Expected gross exposure from linked scenarios, in the organization currency.',
      cell: (risk) =>
        risk.expected_gross_exposure
          ? formatMoney(risk.expected_gross_exposure, risk.currency ?? currency, { compact: true })
          : '—',
    },
    {
      key: 'status',
      header: 'Status',
      hideOnMobile: true,
      cell: (risk) => <StatusBadge status={risk.status} />,
    },
    {
      key: 'owner',
      header: 'Owner',
      hideOnMobile: true,
      cell: (risk) => <span className="text-xs">{risk.owner_name ?? '—'}</span>,
    },
  ];
}
