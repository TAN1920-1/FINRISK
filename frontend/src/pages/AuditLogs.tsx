import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { ApiError, api, getForFile } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import {
  EM_DASH,
  formatDateRange,
  formatDateTime,
  formatNumber,
  humanise,
  pluralise,
  toOptions,
} from '@/lib/format';
import { sortStateOf, useListState } from '@/hooks/useListState';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type { AuditLog, MemberOut, Page } from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { BadgeTone } from '@/components/ui/Badge';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import {
  ActiveFilters,
  DateRangeFilter,
  FilterBar,
  FilterSelect,
  SearchInput,
} from '@/components/ui/Filters';
import { NoticeBanner } from '@/components/ui/Feedback';

/**
 * Audit trail.
 *
 * The trail is append-only and organization-scoped: entries are written on the
 * same transaction as the change they describe, so this screen only ever reads.
 * The API serves it to administrators only (`CanAdminister`), which is why the
 * page states that plainly instead of pretending a denied request is an error.
 */

interface AuditMeta {
  actions: string[];
}

export function AuditLogsPage() {
  const { can } = useAuth();
  const { push } = useToast();

  const allowed = can('audit:read');

  const list = useListState({
    filterKeys: ['action', 'user_id', 'start', 'end'] as const,
    defaultSort: 'created_at',
  });

  // The list endpoint compares full timestamps, so the bare `YYYY-MM-DD` a date
  // input produces is widened to the first and last second of the chosen days.
  // Without this the last day of a range would be silently excluded.
  const apiQuery = useMemo(() => auditQuery(list.query), [list.query]);

  const meta = useQuery({
    queryKey: queryKeys.auditMeta,
    queryFn: () => api.get<AuditMeta>('/api/audit-logs/meta'),
    staleTime: 30 * 60_000,
    enabled: allowed,
  });

  const members = useQuery({
    queryKey: queryKeys.members,
    queryFn: () => api.get<MemberOut[]>('/api/auth/members'),
    staleTime: 5 * 60_000,
    enabled: allowed,
  });

  const logs = useQuery({
    queryKey: queryKeys.auditLogs(apiQuery),
    queryFn: () => api.get<Page<AuditLog>>('/api/audit-logs', { query: apiQuery }),
    enabled: allowed,
  });

  const [exporting, setExporting] = useState(false);

  if (!allowed) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Audit trail"
          description="Who changed what, from which address, and when."
        />
        <Card>
          <CardBody>
            <NoticeBanner tone="warning" title="Administrators only">
              The audit trail records the identity and address behind every change, so the API
              serves it to organization administrators only. Your role does not include the
              <span className="font-mono"> audit:read </span>
              capability.
            </NoticeBanner>
          </CardBody>
        </Card>
      </div>
    );
  }

  const selectedMember = (members.data ?? []).find(
    (member) => String(member.user_id) === (list.state.filters.user_id ?? ''),
  );
  const total = logs.data?.total ?? 0;

  const runExport = async () => {
    setExporting(true);
    try {
      const filename = await getForFile(
        '/api/audit-logs/export',
        toExportQuery(apiQuery),
        'audit-logs.csv',
      );
      push({ tone: 'success', title: 'Audit trail exported', description: filename });
    } catch (error) {
      push({ tone: 'error', title: 'The export failed', description: errorMessage(error) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit trail"
        description="Every recorded change in this organization, with who made it, from which address and when. Entries are written on the same transaction as the change they describe; the trail is administrator-only and is never edited through the application."
        actions={
          <Button
            variant="secondary"
            icon={<Download className="h-3.5 w-3.5" aria-hidden />}
            loading={exporting}
            disabled={!logs.data}
            onClick={() => void runExport()}
            title="Download the filtered trail as a CSV file."
          >
            Export CSV
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="Entries"
          description={
            logs.data
              ? `${formatNumber(total)} recorded ${pluralise(total, 'entry', 'entries')} match the current filters.`
              : 'Loading the trail…'
          }
        />
        <FilterBar>
          <SearchInput
            value={list.state.search}
            onChange={list.setSearch}
            placeholder="Search action, actor or record…"
            label="Search the audit trail"
          />
          <FilterSelect
            label="Action"
            value={list.state.filters.action ?? ''}
            onChange={(value) => list.setFilter('action', value)}
            options={toOptions(meta.data?.actions)}
          />
          <FilterSelect
            label="User"
            value={list.state.filters.user_id ?? ''}
            onChange={(value) => list.setFilter('user_id', value)}
            options={(members.data ?? []).map((member) => ({
              value: String(member.user_id),
              label: member.full_name || member.email,
            }))}
            allLabel="All users"
          />
          <DateRangeFilter
            startDate={list.state.filters.start ?? ''}
            endDate={list.state.filters.end ?? ''}
            label="Period"
            onChange={({ startDate, endDate }) =>
              list.setFilters({ start: startDate, end: endDate })
            }
          />
        </FilterBar>

        <div className="px-4 py-3">
          <ActiveFilters
            filters={[
              list.state.filters.action
                ? {
                    key: 'action',
                    label: `Action: ${actionLabel(list.state.filters.action)}`,
                    onClear: () => list.setFilter('action', ''),
                  }
                : null,
              list.state.filters.user_id
                ? {
                    key: 'user_id',
                    label: `User: ${
                      selectedMember ? selectedMember.full_name || selectedMember.email : list.state.filters.user_id
                    }`,
                    onClear: () => list.setFilter('user_id', ''),
                  }
                : null,
              list.state.filters.start || list.state.filters.end
                ? {
                    key: 'period',
                    label: `Period: ${formatDateRange(
                      list.state.filters.start,
                      list.state.filters.end,
                    )}`,
                    onClear: () => list.setFilters({ start: '', end: '' }),
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

        <DataTable<AuditLog>
          caption="Audit-trail entries"
          columns={AUDIT_COLUMNS}
          rows={logs.data?.items ?? []}
          rowKey={(entry) => entry.id}
          loading={logs.isPending}
          error={logs.isError ? logs.error : undefined}
          onRetry={() => void logs.refetch()}
          sort={sortStateOf(list.state)}
          onSortChange={({ sort, order }) => list.setSort(sort, order)}
          filtered={list.hasFilters}
          emptyTitle="No entries match"
          emptyDescription="Nothing in this organization has been recorded for the current filters. Widen the period or clear a filter — an empty trail is not proof that nothing happened."
          footer={
            logs.data ? (
              <Pagination
                page={logs.data.page}
                pageSize={logs.data.page_size}
                total={logs.data.total}
                pages={logs.data.pages}
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
                itemLabel="entries"
              />
            ) : null
          }
        />
      </Card>

      <NoticeBanner tone="info" title="About this trail">
        Entries are append-only: the application never edits or deletes them, and the CSV export
        contains exactly the same filtered view as the table above.
      </NoticeBanner>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const AUDIT_COLUMNS: Array<Column<AuditLog>> = [
  {
    key: 'created_at',
    header: 'When',
    sortKey: 'created_at',
    cell: (entry) => (
      <span className="whitespace-nowrap text-xs tabular-nums">{formatDateTime(entry.created_at)}</span>
    ),
  },
  {
    key: 'action',
    header: 'Action',
    sortKey: 'action',
    cell: (entry) => (
      <Badge tone={actionTone(entry.action)} title={entry.action}>
        {actionLabel(entry.action)}
      </Badge>
    ),
  },
  {
    key: 'user',
    header: 'Actor',
    sortKey: 'user_email',
    cell: (entry) =>
      entry.user_email ? (
        <span className="text-xs text-foreground">{entry.user_email}</span>
      ) : (
        <span className="text-xs text-muted">System</span>
      ),
  },
  {
    key: 'entity',
    header: 'Record',
    sortKey: 'entity_type',
    hideOnMobile: true,
    cell: (entry) =>
      entry.entity_type ? (
        <span className="text-xs">
          <span className="text-foreground">{humanise(entry.entity_type)}</span>
          {entry.entity_id ? <span className="text-muted"> · {entry.entity_id}</span> : null}
        </span>
      ) : (
        <span className="text-xs text-muted">{EM_DASH}</span>
      ),
  },
  {
    key: 'ip_address',
    header: 'Address',
    hideOnMobile: true,
    cell: (entry) => (
      <span className="text-xs tabular-nums text-muted">{entry.ip_address ?? EM_DASH}</span>
    ),
  },
  {
    key: 'detail',
    header: 'Detail',
    cell: (entry) => <DetailCell detail={entry.detail} />,
  },
];

/**
 * Collapsible `detail` payload.
 *
 * The summary line shows the first few scalar fields so the table stays
 * scannable; the full object is available on expansion rather than being
 * dropped, because the detail is the reason the entry is worth reading.
 */
function DetailCell({ detail }: { detail: Record<string, unknown> | null | undefined }) {
  if (!detail || Object.keys(detail).length === 0) {
    return <span className="text-xs text-muted">{EM_DASH}</span>;
  }

  const preview = summarise(detail);

  return (
    <details className="max-w-xs">
      <summary className="cursor-pointer text-xs text-muted marker:text-muted hover:text-foreground">
        {preview ? <span className="block truncate">{preview}</span> : <span>Details</span>}
      </summary>
      <pre className="mt-1 max-h-48 overflow-auto rounded border border-border bg-surface-muted/50 p-2 text-2xs text-foreground">
        {JSON.stringify(detail, null, 2)}
      </pre>
    </details>
  );
}

function summarise(detail: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail)) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'object') continue;
    parts.push(`${humanise(key)}: ${String(value)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Labels and tones
// ---------------------------------------------------------------------------

/** `auth.login_failed` reads as "Auth Login Failed" rather than "Auth.login Failed". */
function actionLabel(action: string): string {
  return humanise(action.replace(/\./g, ' '));
}

const ACTION_DOMAIN_TONE: Record<string, BadgeTone> = {
  organization: 'primary',
  asset: 'secondary',
  risk: 'high',
  mitigation: 'medium',
  financial_scenario: 'secondary',
  vulnerability_finding: 'high',
  ai: 'primary',
  report: 'neutral',
  data: 'neutral',
  demo_data: 'unknown',
};

const ACTION_TONE: Record<string, BadgeTone> = {
  'auth.login_failed': 'critical',
  'auth.password_changed': 'medium',
  'auth.user_registered': 'primary',
  'auth.login_succeeded': 'low',
};

function actionTone(action: string): BadgeTone {
  const exact = ACTION_TONE[action];
  if (exact) return exact;
  return ACTION_DOMAIN_TONE[action.split('.')[0]] ?? 'neutral';
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/** Widen a `YYYY-MM-DD` range to inclusive timestamps the endpoint can compare. */
function auditQuery(query: Record<string, string | number>): Record<string, string | number> {
  const next: Record<string, string | number> = { ...query };
  const start = String(next.start ?? '');
  const end = String(next.end ?? '');
  if (start) next.start = `${start}T00:00:00`;
  if (end) next.end = `${end}T23:59:59`;
  return next;
}

/** The export honours the filters but not the paging window, and sorts newest first. */
function toExportQuery(query: Record<string, string | number>): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(query).filter(([key]) => !['page', 'page_size', 'sort', 'order'].includes(key)),
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}
