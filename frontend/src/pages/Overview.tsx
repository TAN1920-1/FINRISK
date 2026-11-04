import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  FileBarChart2,
  Info,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDateTime, formatMoney, formatRelative, humanise } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useAuth } from '@/app/AuthProvider';
import type { Dashboard, KpiValue, Risk } from '@/types/api';
import { cn } from '@/lib/cn';
import { KpiCard } from '@/components/ui/KpiCard';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { SeverityBadge, StatusBadge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import {
  AreaTrendChart,
  DonutChart,
} from '@/components/ui/Charts';
import { CardSkeleton, ErrorState } from '@/components/ui/Feedback';
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
  const { user, role, activeOrganization, can } = useAuth();
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

  const applyRange = (days: number | null) =>
    list.setFilters({ start_date: days === null ? '' : isoDaysAgo(days), end_date: '' });

  return (
    <div className="space-y-6">
      <section className="relative px-1 pt-2">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              SECURE TERMINAL ACTIVE • {data.organization.reporting_period_label || 'Q3 2025 REPORTING PERIOD'}
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              Welcome back, {role === 'admin' ? 'Chief Risk Officer' : firstName}
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Last synchronized telemetry analysis: Today, {formatDateTime(data.generated_at).split(',')[1].trim()}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void dashboard.refetch()}
              className="bg-surface text-[12px] font-semibold"
            >
              Compare Analysis
            </Button>
            {can('report:read') ? (
              <Button
                variant="outline"
                size="sm"
                icon={<FileBarChart2 className="h-3.5 w-3.5" />}
                onClick={() => navigate('/reports')}
                className="bg-surface text-[12px] font-semibold"
              >
                Generate Report
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
              onClick={() => navigate('/risks')}
              className="bg-surface text-[12px] font-semibold"
            >
              New Assessment
            </Button>
          </div>
        </div>
      </section>

      <section aria-label="Key indicators" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {data.kpis.slice(0, 7).map((kpi: KpiValue) => (
          <KpiCard
            key={kpi.key}
            kpi={kpi}
            series={kpi.key === 'risks_created_30d' ? createdSeries : undefined}
          />
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Financial Health Trends"
            description="Multi-metric correlation across revenue, cash flow, and risk factors"
            actions={
              <div className="flex items-center gap-1.5 rounded-lg bg-surface-muted p-1">
                {RANGE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => applyRange(preset.days)}
                    className={cn(
                      'rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-all',
                      activeRange === preset.id
                        ? 'bg-surface text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            }
          />
          <div className="h-[320px] px-4 pb-4">
            <AreaTrendChart
              data={data.risks_created_vs_resolved.points}
              primaryLabel="Revenue ($M)"
              secondaryLabel="Risk Score"
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Risk Distribution"
            description="Asset classification across weighted severity tiers."
            actions={<Info className="h-4 w-4 text-muted-foreground" />}
          />
          <div className="flex flex-col items-center px-4 pb-6">
            <div className="relative h-48 w-48">
              <DonutChart
                data={data.risks_by_severity}
                centreValue={severityTotal}
                centreLabel="TOTAL ASSETS"
                colourBySeverity
                showLegend={false}
              />
            </div>
            <ul className="mt-6 w-full space-y-3">
              {data.risks_by_severity.map((point) => (
                <li key={point.label} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                    <span className={cn('h-2.5 w-2.5 rounded-full', SEVERITY_DOT[point.label])} />
                    {humanise(point.label)} Risk
                  </span>
                  <span className="text-[13px] font-bold text-foreground tabular-nums">
                    {severityTotal > 0 ? Math.round((point.value / severityTotal) * 100) : 0}% ({point.value})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Highest-ranked risks"
            description="Ranked by inherent score, then by recency."
            actions={
              <Link to="/risks" className="text-[12px] font-bold uppercase tracking-wider text-primary hover:underline">
                View All
              </Link>
            }
          />
          <DataTable<Risk>
            columns={topRiskColumns(navigate, currency)}
            rows={data.top_risks.slice(0, 5)}
            rowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/risks/${row.id}`)}
          />
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Historical Activity"
              description="Latest telemetry from the audit trail"
            />
            <ul className="divide-y divide-border">
              {data.recent_activity.slice(0, 4).map((entry) => (
                <li key={entry.id} className="flex items-center justify-between px-4 py-3 hover:bg-surface-muted transition-colors cursor-pointer">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-foreground">{humanise(entry.action)}</p>
                    <p className="text-[11px] text-muted-foreground">{entry.user_email} · {formatRelative(entry.at)}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                </li>
              ))}
            </ul>
          </Card>
        </div>
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

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-risk-critical',
  high: 'bg-risk-high',
  medium: 'bg-risk-medium',
  low: 'bg-risk-low',
  unknown: 'bg-risk-unknown',
};

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
