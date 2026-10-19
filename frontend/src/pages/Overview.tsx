import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDateTime, formatMoney, formatRelative, humanise, toOptions } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useAuth } from '@/app/AuthProvider';
import type { Dashboard, KpiValue, Mitigation, Risk, RiskMeta } from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { KpiCard } from '@/components/ui/KpiCard';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { SeverityBadge, StatusBadge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { CategoryBarChart, ChartCard, TrendLineChart } from '@/components/ui/Charts';
import { ActiveFilters, DateRangeFilter, FilterBar, FilterSelect } from '@/components/ui/Filters';
import { CardSkeleton, EmptyState, ErrorState, NoticeBanner } from '@/components/ui/Feedback';
import { MethodologyPanel } from '@/components/ui/Methodology';

/**
 * Overview.
 *
 * Every figure on this screen is a value the API computed from stored records.
 * The screen never derives a total of its own, which is why the KPI grid renders
 * whatever the endpoint returns rather than a hand-picked list of numbers.
 */
export function OverviewPage() {
  const { activeOrganization, can } = useAuth();
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
        <PageHeader title="Overview" description="Loading the organization's risk posture…" />
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
  const isFiltered = Boolean(
    list.state.search ||
      list.state.filters.start_date ||
      list.state.filters.end_date ||
      list.state.filters.category ||
      list.state.filters.severity ||
      list.state.filters.business_unit,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description={
          <>
            Organization-wide posture for <span className="text-foreground">{data.organization.name}</span>.
            Figures are computed from stored records; financial values are documented estimates.
          </>
        }
        meta={
          <>
            <span className="text-2xs text-muted">Generated {formatDateTime(data.generated_at)}</span>
            {data.organization.reporting_period_label ? (
              <span className="text-2xs text-muted">
                Reporting period: {data.organization.reporting_period_label}
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden />}
              onClick={() => navigate('/risks')}
            >
              Open risk register
            </Button>
            {can('report:read') ? (
              <Button variant="primary" onClick={() => navigate('/reports')}>
                Generate a report
              </Button>
            ) : null}
          </>
        }
      />

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
          <KpiCard key={kpi.key} kpi={kpi} />
        ))}
      </section>

      <Card>
        <FilterBar>
          <DateRangeFilter
            startDate={list.state.filters.start_date ?? ''}
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

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Open risks by severity"
          description="Counts follow the documented likelihood x impact bands."
          empty={data.risks_by_severity.length === 0}
          emptyMessage="No risks match the current filters."
        >
          <CategoryBarChart data={data.risks_by_severity} colourBySeverity />
        </ChartCard>

        <ChartCard
          title="Risks by category"
          description="Where the register's exposure is concentrated."
          empty={data.risks_by_category.length === 0}
          emptyMessage="No risks match the current filters."
        >
          <CategoryBarChart data={data.risks_by_category} />
        </ChartCard>

        <ChartCard
          title="Risks raised vs closed"
          description="Twelve-month view of records created and resolved."
          empty={data.risks_created_vs_resolved.points.length === 0}
          className="lg:col-span-2"
        >
          <TrendLineChart
            data={data.risks_created_vs_resolved.points}
            primaryLabel={data.risks_created_vs_resolved.name || 'Raised'}
            secondaryLabel="Resolved"
          />
        </ChartCard>

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
