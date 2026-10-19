import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Download, Plus, Search, Upload } from 'lucide-react';
import { ApiError, api, getForFile } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDate, humanise, toOptions } from '@/lib/format';
import { sortStateOf, useListState } from '@/hooks/useListState';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type {
  AssetOption,
  CveLookup,
  Finding,
  FindingMeta,
  ImportResult,
  Page,
} from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge, SeverityBadge, StatusBadge } from '@/components/ui/Badge';
import type { BadgeTone } from '@/components/ui/Badge';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { ActiveFilters, FilterBar, FilterSelect, SearchInput } from '@/components/ui/Filters';
import { CardSkeleton, ErrorState, NoticeBanner } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { MethodologyPanel } from '@/components/ui/Methodology';

/**
 * Cybersecurity intelligence.
 *
 * Two numbers appear next to every finding and they are not the same number:
 * the CVSS score is technical severity supplied by the source, and the priority
 * score is this platform's context-aware score built from documented weights.
 * The page keeps them in separate columns, the methodology panel spells out the
 * weights, and the disclaimer the API returns is shown verbatim — a priority
 * score must never be read as, or reported as, a CVSS score.
 */

export const REMEDIATION_TONE: Record<string, BadgeTone> = {
  open: 'critical',
  in_progress: 'high',
  remediated: 'low',
  accepted_risk: 'medium',
  false_positive: 'neutral',
};

const MAX_CVSS = 10;

export function CybersecurityPage() {
  const { can } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [cveOpen, setCveOpen] = useState(false);
  const [values, setValues] = useState<FindingFormValues>(EMPTY_FINDING_FORM);
  const [errors, setErrors] = useState<FindingFormErrors>({});
  const [exporting, setExporting] = useState(false);

  const list = useListState({
    filterKeys: [
      'asset_id',
      'priority_band',
      'remediation_status',
      'kev_only',
      'internet_exposed_only',
    ] as const,
    defaultSort: 'priority_score',
  });

  const meta = useQuery({
    queryKey: queryKeys.findingMeta,
    queryFn: () => api.get<FindingMeta>('/api/vulnerabilities/meta'),
    staleTime: 5 * 60_000,
  });

  const findings = useQuery({
    queryKey: queryKeys.findings(list.query),
    queryFn: () => api.get<Page<Finding>>('/api/vulnerabilities/findings', { query: list.query }),
  });

  const assets = useQuery({
    queryKey: queryKeys.assetOptions,
    queryFn: () => api.get<AssetOption[]>('/api/assets/options'),
  });

  const writable = can('vulnerability:write');

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<Finding>('/api/vulnerabilities/findings', payload),
    onSuccess: async (finding) => {
      setFormOpen(false);
      setValues(EMPTY_FINDING_FORM);
      push({
        tone: 'success',
        title: 'Finding recorded',
        description: `${finding.title} was scored ${
          finding.priority_score === null || finding.priority_score === undefined
            ? 'without a priority score'
            : `at priority ${finding.priority_score.toFixed(0)}`
        }.`,
      });
      await queryClient.invalidateQueries({ queryKey: ['findings'] });
      navigate(`/cybersecurity/${finding.id}`);
    },
  });

  const openCreate = () => {
    setValues(EMPTY_FINDING_FORM);
    setErrors({});
    setFormOpen(true);
  };

  const submit = () => {
    const validation = validateFindingForm(values);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    createMutation.mutate(buildFindingPayload(values, 'create'));
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const filename = await getForFile(
        '/api/vulnerabilities/findings/export',
        {
          priority_band: list.state.filters.priority_band ?? '',
          remediation_status: list.state.filters.remediation_status ?? '',
        },
        'finrisk-vulnerability-findings.csv',
      );
      push({ tone: 'success', title: 'Export downloaded', description: filename });
    } catch (error) {
      push({ tone: 'error', title: 'The export failed', description: findingErrorMessage(error) });
    } finally {
      setExporting(false);
    }
  };

  if (meta.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader title="Cybersecurity" description="Loading the scoring model…" />
        <CardSkeleton lines={4} />
        <CardSkeleton lines={8} />
      </div>
    );
  }

  if (meta.isError) {
    return (
      <ErrorState
        error={meta.error}
        onRetry={() => void meta.refetch()}
        title="Could not load the cybersecurity model"
      />
    );
  }

  const assetOptions = assets.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cybersecurity"
        description="Vulnerability findings, their context-aware priority score and their remediation status. CVSS severity and the platform's priority score are shown separately and must not be conflated."
        meta={
          findings.data ? (
            <span className="text-2xs text-muted">
              {findings.data.total} finding{findings.data.total === 1 ? '' : 's'} in scope
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
            {writable ? (
              <>
                <Button
                  variant="outline"
                  icon={<Upload className="h-3.5 w-3.5" aria-hidden />}
                  onClick={() => setImportOpen(true)}
                >
                  Import CSV
                </Button>
                <Button
                  variant="outline"
                  icon={<Search className="h-3.5 w-3.5" aria-hidden />}
                  onClick={() => setCveOpen(true)}
                >
                  Look up CVE
                </Button>
                <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={openCreate}>
                  New finding
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <NoticeBanner tone="warning" title="The priority score is not a CVSS score">
        {meta.data.disclaimer}
      </NoticeBanner>

      {!meta.data.nvd_configured ? (
        <NoticeBanner tone="info" title="Upstream threat intelligence is not configured">
          No NVD API key is set, so CVE enrichment returns only what is already cached locally. Details
          such as the exploitation evidence flag and the EPSS score will be blank rather than guessed.
        </NoticeBanner>
      ) : null}

      <Card>
        <FilterBar>
          <SearchInput
            value={list.state.search}
            onChange={list.setSearch}
            placeholder="Search title, CVE or description…"
            label="Search findings"
          />
          <FilterSelect
            label="Priority band"
            value={list.state.filters.priority_band ?? ''}
            onChange={(value) => list.setFilter('priority_band', value)}
            options={toOptions(meta.data.priority_bands)}
          />
          <FilterSelect
            label="Remediation"
            value={list.state.filters.remediation_status ?? ''}
            onChange={(value) => list.setFilter('remediation_status', value)}
            options={toOptions(meta.data.remediation_statuses)}
          />
          <FilterSelect
            label="Asset"
            value={list.state.filters.asset_id ?? ''}
            onChange={(value) => list.setFilter('asset_id', value)}
            options={assetOptions.map((asset) => ({
              value: String(asset.id),
              label: `${asset.asset_ref} · ${asset.name}`,
            }))}
          />
          <div className="flex flex-col gap-1.5 pb-1">
            <Checkbox
              label="Known exploited"
              hint="Only findings tied to a CVE on the CISA KEV list."
              checked={list.state.filters.kev_only === 'true'}
              onChange={(event) => list.setFilter('kev_only', event.target.checked ? 'true' : '')}
            />
            <Checkbox
              label="Internet exposed"
              checked={list.state.filters.internet_exposed_only === 'true'}
              onChange={(event) =>
                list.setFilter('internet_exposed_only', event.target.checked ? 'true' : '')
              }
            />
          </div>
        </FilterBar>

        <div className="px-4 py-3">
          <ActiveFilters
            filters={[
              list.state.filters.priority_band
                ? {
                    key: 'priority_band',
                    label: `Priority: ${humanise(list.state.filters.priority_band)}`,
                    onClear: () => list.setFilter('priority_band', ''),
                  }
                : null,
              list.state.filters.remediation_status
                ? {
                    key: 'remediation_status',
                    label: `Remediation: ${humanise(list.state.filters.remediation_status)}`,
                    onClear: () => list.setFilter('remediation_status', ''),
                  }
                : null,
              list.state.filters.asset_id
                ? {
                    key: 'asset_id',
                    label: `Asset: ${labelForAsset(assetOptions, list.state.filters.asset_id)}`,
                    onClear: () => list.setFilter('asset_id', ''),
                  }
                : null,
              list.state.filters.kev_only === 'true'
                ? {
                    key: 'kev_only',
                    label: 'Known exploited only',
                    onClear: () => list.setFilter('kev_only', ''),
                  }
                : null,
              list.state.filters.internet_exposed_only === 'true'
                ? {
                    key: 'internet_exposed_only',
                    label: 'Internet exposed only',
                    onClear: () => list.setFilter('internet_exposed_only', ''),
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

        <DataTable<Finding>
          caption="Vulnerability findings"
          columns={findingColumns(navigate)}
          rows={findings.data?.items ?? []}
          rowKey={(finding) => finding.id}
          loading={findings.isPending}
          error={findings.isError ? findings.error : undefined}
          onRetry={() => void findings.refetch()}
          sort={sortStateOf(list.state)}
          onSortChange={({ sort, order }) => list.setSort(sort, order)}
          onRowClick={(finding) => navigate(`/cybersecurity/${finding.id}`)}
          filtered={list.hasFilters}
          emptyTitle="No findings recorded yet"
          emptyDescription="Import a scanner export or record a finding. An empty list means nothing has been recorded, not that the estate is clean."
          emptyAction={
            writable ? (
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={openCreate}>
                New finding
              </Button>
            ) : undefined
          }
          footer={
            findings.data ? (
              <Pagination
                page={findings.data.page}
                pageSize={findings.data.page_size}
                total={findings.data.total}
                pages={findings.data.pages}
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
                itemLabel="findings"
              />
            ) : null
          }
        />
      </Card>

      <MethodologyPanel
        title="How the priority score is calculated"
        methodology={meta.data.methodology}
        formula={weightsText(meta.data)}
        limitations={`${meta.data.disclaimer} The score also depends on the asset ratings: a finding on an internet-exposed, business-critical asset with sensitive data will outrank a technically severe finding on an internal test system. Age is measured from the detected date and only ever raises priority.`}
      />

      {writable ? (
        <>
          <Dialog
            open={formOpen}
            onClose={() => setFormOpen(false)}
            title="Record a vulnerability finding"
            description="Only the title is required. Supplying a CVE identifier lets the platform enrich the finding from upstream intelligence."
            size="lg"
            footer={
              <>
                <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={createMutation.isPending}>
                  Cancel
                </Button>
                <Button variant="primary" loading={createMutation.isPending} onClick={submit}>
                  Add finding
                </Button>
              </>
            }
          >
            <FindingForm
              values={values}
              errors={errors}
              onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
              meta={meta.data}
              assets={assetOptions}
              showCve
            />
            {createMutation.isError ? (
              <NoticeBanner tone="danger" title="The finding could not be saved" className="mt-3">
                {findingErrorMessage(createMutation.error)}
              </NoticeBanner>
            ) : null}
          </Dialog>

          <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} meta={meta.data} />
          <CveLookupDialog open={cveOpen} onClose={() => setCveOpen(false)} />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function labelForAsset(assets: AssetOption[], assetId: string): string {
  const match = assets.find((asset) => String(asset.id) === assetId);
  return match ? `${match.asset_ref} · ${match.name}` : `#${assetId}`;
}

function findingColumns(navigate: (to: string) => void): Array<Column<Finding>> {
  return [
    {
      key: 'title',
      header: 'Finding',
      sortKey: 'title',
      cell: (finding) => (
        <span className="block max-w-md">
          <button
            type="button"
            className="block max-w-full truncate rounded text-left text-xs font-medium text-primary hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              navigate(`/cybersecurity/${finding.id}`);
            }}
          >
            {finding.title}
          </button>
          <span className="mt-0.5 block truncate text-2xs text-muted">
            {finding.cve_id ?? 'No CVE identifier'}
            {finding.asset_name ? ` · ${finding.asset_name}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'cvss',
      header: 'CVSS',
      sortKey: 'cvss_score',
      align: 'right',
      headerTitle: 'Technical severity from the source. This is not the platform’s priority score.',
      cell: (finding) => (
        <span className="flex flex-col items-end gap-1">
          <span className="text-xs tabular-nums">
            {finding.cvss_score === null || finding.cvss_score === undefined
              ? '—'
              : finding.cvss_score.toFixed(1)}
          </span>
          {finding.cvss_severity ? <Badge tone="neutral">{finding.cvss_severity}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      sortKey: 'priority_score',
      align: 'right',
      headerTitle: 'Context-aware priority score out of 100. Not a CVSS score.',
      cell: (finding) => (
        <span className="flex flex-col items-end gap-1">
          <span className="text-xs font-medium tabular-nums">
            {finding.priority_score === null || finding.priority_score === undefined
              ? '—'
              : finding.priority_score.toFixed(0)}
          </span>
          <SeverityBadge severity={finding.priority_band} />
        </span>
      ),
    },
    {
      key: 'evidence',
      header: 'Evidence',
      hideOnMobile: true,
      headerTitle: 'Exploitation evidence: a CISA KEV entry outranks a local exploit flag, which outranks an EPSS estimate.',
      cell: (finding) => (
        <span className="flex flex-wrap gap-1">
          {finding.exploit_evidence ? <Badge tone="critical">Exploited</Badge> : null}
          {finding.internet_exposed ? <Badge tone="high">Exposed</Badge> : null}
          {!finding.exploit_evidence && !finding.internet_exposed ? (
            <span className="text-xs text-muted">—</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Remediation',
      sortKey: 'remediation_status',
      cell: (finding) => (
        <StatusBadge
          status={finding.remediation_status}
          tone={REMEDIATION_TONE[finding.remediation_status] ?? 'neutral'}
        />
      ),
    },
    {
      key: 'due',
      header: 'Due',
      sortKey: 'remediation_due_date',
      hideOnMobile: true,
      cell: (finding) => (
        <span className="flex flex-col items-start gap-1">
          <span className="text-xs tabular-nums">
            {finding.remediation_due_date ? formatDate(finding.remediation_due_date) : '—'}
          </span>
          {isRemediationOverdue(finding) ? <Badge tone="critical">Overdue</Badge> : null}
        </span>
      ),
    },
    {
      key: 'age',
      header: 'Age',
      hideOnMobile: true,
      headerTitle: 'Days since the finding was detected.',
      cell: (finding) => (
        <span className="text-xs tabular-nums">
          {finding.vulnerability_age_days === null || finding.vulnerability_age_days === undefined
            ? '—'
            : `${finding.vulnerability_age_days}d`}
        </span>
      ),
    },
  ];
}

const CLOSED_STATUSES = ['remediated', 'accepted_risk', 'false_positive'];

export function isRemediationOverdue(finding: Pick<Finding, 'remediation_due_date' | 'remediation_status'>): boolean {
  if (!finding.remediation_due_date) return false;
  if (CLOSED_STATUSES.includes(finding.remediation_status)) return false;
  return finding.remediation_due_date < new Date().toISOString().slice(0, 10);
}

function weightsText(meta: FindingMeta): string {
  const lines = Object.entries(meta.weights).map(
    ([key, weight]) => `${key.padEnd(22)} ${String(weight).padStart(5)}`,
  );
  lines.push(`${'compensating_controls'.padEnd(22)} ${String(-meta.compensating_control_penalty).padStart(5)}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Import dialog
// ---------------------------------------------------------------------------

function ImportDialog({
  open,
  onClose,
  meta,
}: {
  open: boolean;
  onClose: () => void;
  meta: FindingMeta;
}) {
  const { push } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post<ImportResult>('/api/vulnerabilities/findings/import', undefined, { formData });
    },
    onSuccess: async (data) => {
      setResult(data);
      push({
        tone: data.rows_failed ? 'warning' : 'success',
        title: `${data.rows_created} finding${data.rows_created === 1 ? '' : 's'} imported`,
        description: data.rows_failed
          ? `${data.rows_failed} row${data.rows_failed === 1 ? '' : 's'} could not be read and are listed below.`
          : 'Every row in the file was imported.',
      });
      await queryClient.invalidateQueries({ queryKey: ['findings'] });
    },
  });

  const close = () => {
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Import findings from a scanner export"
      description="Upload a CSV exported from your vulnerability scanner. Nothing is written until the file has been validated."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={importMutation.isPending}>
            Close
          </Button>
          <Button
            variant="primary"
            loading={importMutation.isPending}
            onClick={() => {
              const file = inputRef.current?.files?.[0];
              if (!file) {
                push({ tone: 'warning', title: 'Choose a CSV file first' });
                return;
              }
              setResult(null);
              importMutation.mutate(file);
            }}
          >
            Upload and import
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="finding-import-file" className="text-xs font-medium text-foreground">
            CSV file
          </label>
          <input
            id="finding-import-file"
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="mt-1 block w-full cursor-pointer rounded border border-border bg-surface px-2.5 py-2 text-xs text-foreground file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-2 file:py-1 file:text-2xs file:text-foreground"
          />
        </div>

        <div>
          <p className="text-2xs font-medium uppercase tracking-wide text-muted">Accepted columns</p>
          <p className="mt-1 text-xs text-muted">
            Only <span className="font-medium text-foreground">title</span> is required. A row whose
            asset reference is unknown, or whose remediation status is not recognised, is rejected on
            its own and reported below; the rest of the file still imports.
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {meta.import_columns.map((column) => (
              <code
                key={column}
                className="rounded border border-border bg-surface-muted px-1.5 py-0.5 text-2xs text-foreground"
              >
                {column}
              </code>
            ))}
          </div>
        </div>

        {result ? (
          <div className="rounded border border-border p-3">
            <p className="text-xs font-medium text-foreground">{result.filename}</p>
            <p className="mt-1 text-xs text-muted">
              {result.rows_total} row{result.rows_total === 1 ? '' : 's'} read ·{' '}
              <span className="text-foreground">{result.rows_created} imported</span>
              {result.rows_failed ? ` · ${result.rows_failed} skipped` : ''}
            </p>
            {result.errors?.length ? (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {result.errors.map((row) => (
                  <li key={`${row.row}-${row.error}`} className="text-2xs text-muted">
                    <span className="font-medium text-foreground">Row {row.row}:</span> {row.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {importMutation.isError ? (
          <NoticeBanner tone="danger" title="The file could not be imported">
            {findingErrorMessage(importMutation.error)}
          </NoticeBanner>
        ) : null}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CVE lookup dialog
// ---------------------------------------------------------------------------

function CveLookupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cveId, setCveId] = useState('');
  const [lookupId, setLookupId] = useState<string | null>(null);

  const lookup = useQuery({
    queryKey: queryKeys.cve(lookupId ?? ''),
    queryFn: () => api.get<CveLookup>(`/api/vulnerabilities/cve/${encodeURIComponent(lookupId ?? '')}`),
    enabled: Boolean(lookupId),
    retry: false,
  });

  const close = () => {
    setLookupId(null);
    onClose();
  };

  const submit = () => {
    const trimmed = cveId.trim().toUpperCase();
    if (!trimmed) return;
    setLookupId(trimmed);
  };

  const record = lookup.data;

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Look up a CVE"
      description="Read the cached intelligence for a CVE identifier. This looks up a record; it does not create a finding."
      size="lg"
      footer={
        <Button variant="ghost" onClick={close}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <Field label="CVE identifier" htmlFor="cve-id" className="flex-1">
            <Input
              id="cve-id"
              value={cveId}
              placeholder="CVE-2024-1234"
              onChange={(event) => setCveId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </Field>
          <Button variant="primary" loading={lookup.isFetching} onClick={submit} disabled={!cveId.trim()}>
            Look up
          </Button>
        </div>

        {lookup.isError ? (
          <NoticeBanner tone="danger" title="The lookup failed">
            {findingErrorMessage(lookup.error)}
          </NoticeBanner>
        ) : null}

        {record ? (
          <div className="space-y-4">
            {record.warnings?.length ? (
              <NoticeBanner tone="warning" title="Some details could not be retrieved">
                <ul className="list-inside list-disc space-y-1">
                  {record.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </NoticeBanner>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <LookupRow label="Identifier" value={record.cve_id} />
              <LookupRow
                label="Source"
                value={`${record.source}${record.cached ? ' · from cache' : ' · fetched now'}`}
              />
              <LookupRow
                label="CVSS score"
                value={
                  record.cvss_score === null || record.cvss_score === undefined
                    ? 'Not published'
                    : `${record.cvss_score.toFixed(1)}${record.cvss_severity ? ` · ${record.cvss_severity}` : ''}`
                }
              />
              <LookupRow
                label="EPSS score"
                value={
                  record.epss_score === null || record.epss_score === undefined
                    ? 'Not available'
                    : `${(record.epss_score * 100).toFixed(2)}% chance of exploitation in 30 days`
                }
              />
              <LookupRow
                label="CISA KEV"
                value={
                  record.kev_listed
                    ? `Listed${record.kev_due_date ? ` · remediate by ${formatDate(record.kev_due_date)}` : ''}`
                    : 'Not listed'
                }
              />
              <LookupRow
                label="Published"
                value={record.published_at ? formatDate(record.published_at) : 'Unknown'}
              />
            </div>

            {record.description ? (
              <div>
                <p className="text-2xs font-medium uppercase tracking-wide text-muted">Description</p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">{record.description}</p>
              </div>
            ) : null}

            {record.kev_required_action ? (
              <div>
                <p className="text-2xs font-medium uppercase tracking-wide text-muted">Required action</p>
                <p className="mt-1 text-xs text-foreground">{record.kev_required_action}</p>
              </div>
            ) : null}

            {record.cvss_vector ? (
              <div>
                <p className="text-2xs font-medium uppercase tracking-wide text-muted">CVSS vector</p>
                <code className="mt-1 block overflow-x-auto rounded bg-surface-muted p-2 font-mono text-2xs text-foreground">
                  {record.cvss_vector}
                </code>
              </div>
            ) : null}

            {record.references?.length ? (
              <div>
                <p className="text-2xs font-medium uppercase tracking-wide text-muted">References</p>
                <ul className="mt-1 space-y-1">
                  {record.references.slice(0, 8).map((reference, index) => {
                    const url = typeof reference.url === 'string' ? reference.url : null;
                    return (
                      <li key={`${url ?? 'reference'}-${index}`} className="break-all text-2xs">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-primary hover:underline"
                          >
                            {url}
                          </a>
                        ) : (
                          <span className="text-muted">{JSON.stringify(reference)}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function LookupRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-xs text-foreground">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared finding form (also used by the finding detail page's edit dialog)
// ---------------------------------------------------------------------------

export interface FindingFormValues {
  title: string;
  cve_id: string;
  asset_id: string;
  description: string;
  cvss_score: string;
  cvss_severity: string;
  detected_at: string;
  vulnerability_age_days: string;
  exploit_evidence: boolean;
  internet_exposed: boolean;
  remediation_status: string;
  remediation_reference: string;
  remediation_due_date: string;
  compensating_controls: string;
  notes: string;
}

export const EMPTY_FINDING_FORM: FindingFormValues = {
  title: '',
  cve_id: '',
  asset_id: '',
  description: '',
  cvss_score: '',
  cvss_severity: '',
  detected_at: '',
  vulnerability_age_days: '',
  exploit_evidence: false,
  internet_exposed: false,
  remediation_status: 'open',
  remediation_reference: '',
  remediation_due_date: '',
  compensating_controls: '',
  notes: '',
};

export function formFromFinding(finding: Finding): FindingFormValues {
  return {
    title: finding.title,
    cve_id: finding.cve_id ?? '',
    asset_id: finding.asset_id ? String(finding.asset_id) : '',
    description: finding.description ?? '',
    cvss_score:
      finding.cvss_score === null || finding.cvss_score === undefined ? '' : String(finding.cvss_score),
    cvss_severity: finding.cvss_severity ?? '',
    detected_at: finding.detected_at ? finding.detected_at.slice(0, 10) : '',
    vulnerability_age_days:
      finding.vulnerability_age_days === null || finding.vulnerability_age_days === undefined
        ? ''
        : String(finding.vulnerability_age_days),
    exploit_evidence: finding.exploit_evidence,
    internet_exposed: finding.internet_exposed,
    remediation_status: finding.remediation_status,
    remediation_reference: finding.remediation_reference ?? '',
    remediation_due_date: finding.remediation_due_date ? finding.remediation_due_date.slice(0, 10) : '',
    compensating_controls: finding.compensating_controls ?? '',
    notes: finding.notes ?? '',
  };
}

export interface FindingFormErrors {
  title?: string;
  cvss_score?: string;
}

export function validateFindingForm(values: FindingFormValues): FindingFormErrors {
  const errors: FindingFormErrors = {};
  if (values.title.trim().length < 3) errors.title = 'Enter at least three characters.';
  if (values.cvss_score.trim()) {
    const score = Number(values.cvss_score);
    if (!Number.isFinite(score) || score < 0 || score > MAX_CVSS) {
      errors.cvss_score = 'CVSS scores run from 0 to 10.';
    }
  }
  return errors;
}

/**
 * Build the request body. The CVSS score is only sent when it was supplied, so
 * an unknown technical severity stays unknown instead of being replaced by a
 * zero. On update the CVE identifier is omitted, because it is set when the
 * finding is recorded and is not editable afterwards.
 */
export function buildFindingPayload(
  values: FindingFormValues,
  mode: 'create' | 'update',
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: values.title.trim(),
    asset_id: values.asset_id ? Number(values.asset_id) : null,
    description: values.description.trim() || null,
    cvss_score: values.cvss_score.trim() ? Number(values.cvss_score) : null,
    cvss_severity: values.cvss_severity.trim() || null,
    detected_at: values.detected_at ? `${values.detected_at}T00:00:00Z` : null,
    vulnerability_age_days: values.vulnerability_age_days.trim()
      ? Number(values.vulnerability_age_days)
      : null,
    exploit_evidence: values.exploit_evidence,
    internet_exposed: values.internet_exposed,
    remediation_status: values.remediation_status,
    remediation_reference: values.remediation_reference.trim() || null,
    remediation_due_date: values.remediation_due_date || null,
    compensating_controls: values.compensating_controls.trim() || null,
    notes: values.notes.trim() || null,
  };

  if (mode === 'create') {
    payload.cve_id = values.cve_id.trim().toUpperCase() || null;
  }
  return payload;
}

export function FindingForm({
  values,
  errors,
  onChange,
  meta,
  assets,
  showCve = false,
}: {
  values: FindingFormValues;
  errors: FindingFormErrors;
  onChange: (patch: Partial<FindingFormValues>) => void;
  meta: FindingMeta;
  assets: AssetOption[];
  showCve?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required htmlFor="finding-title" error={errors.title} className="sm:col-span-2">
          <Input
            id="finding-title"
            value={values.title}
            invalid={Boolean(errors.title)}
            placeholder="Short, specific description of the vulnerability"
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </Field>

        {showCve ? (
          <Field
            label="CVE identifier"
            htmlFor="finding-cve"
            hint="Optional. Supplying it lets the platform enrich the finding from upstream intelligence."
          >
            <Input
              id="finding-cve"
              value={values.cve_id}
              placeholder="CVE-2024-1234"
              onChange={(event) => onChange({ cve_id: event.target.value })}
            />
          </Field>
        ) : null}

        <Field
          label="Asset"
          htmlFor="finding-asset"
          hint={assets.length ? undefined : 'No assets registered yet.'}
        >
          <Select
            id="finding-asset"
            value={values.asset_id}
            placeholder="No asset linked"
            options={assets.map((asset) => ({
              value: String(asset.id),
              label: `${asset.asset_ref} · ${asset.name}`,
            }))}
            onChange={(event) => onChange({ asset_id: event.target.value })}
          />
        </Field>

        <Field
          label="CVSS score"
          htmlFor="finding-cvss"
          error={errors.cvss_score}
          aside="0–10"
          hint="Technical severity from the source. Leave blank if it is not published."
        >
          <Input
            id="finding-cvss"
            inputMode="decimal"
            value={values.cvss_score}
            invalid={Boolean(errors.cvss_score)}
            placeholder="Not published"
            onChange={(event) => {
              const next = event.target.value;
              if (next === '' || /^\d*\.?\d*$/.test(next)) onChange({ cvss_score: next });
            }}
          />
        </Field>

        <Field label="CVSS severity label" htmlFor="finding-cvss-severity">
          <Input
            id="finding-cvss-severity"
            value={values.cvss_severity}
            list="finding-cvss-severity-options"
            placeholder="critical, high, medium or low"
            onChange={(event) => onChange({ cvss_severity: event.target.value })}
          />
          <datalist id="finding-cvss-severity-options">
            {['critical', 'high', 'medium', 'low'].map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </Field>

        <Field label="Detected on" htmlFor="finding-detected">
          <Input
            id="finding-detected"
            type="date"
            value={values.detected_at}
            onChange={(event) => onChange({ detected_at: event.target.value })}
          />
        </Field>

        <Field
          label="Days since detection"
          htmlFor="finding-age"
          hint="Leave blank and the platform counts from the detected date."
        >
          <Input
            id="finding-age"
            inputMode="numeric"
            value={values.vulnerability_age_days}
            onChange={(event) => {
              const next = event.target.value;
              if (next === '' || /^\d+$/.test(next)) onChange({ vulnerability_age_days: next });
            }}
          />
        </Field>

        <Field label="Remediation status" htmlFor="finding-status">
          <Select
            id="finding-status"
            value={values.remediation_status}
            options={toOptions(meta.remediation_statuses)}
            onChange={(event) => onChange({ remediation_status: event.target.value })}
          />
        </Field>

        <Field label="Remediation due date" htmlFor="finding-due">
          <Input
            id="finding-due"
            type="date"
            value={values.remediation_due_date}
            onChange={(event) => onChange({ remediation_due_date: event.target.value })}
          />
        </Field>

        <Field label="Remediation reference" htmlFor="finding-reference" className="sm:col-span-2">
          <Input
            id="finding-reference"
            value={values.remediation_reference}
            placeholder="Ticket, change request or patch reference"
            onChange={(event) => onChange({ remediation_reference: event.target.value })}
          />
        </Field>

        <div className="flex flex-col gap-3 pb-1 sm:col-span-2">
          <Checkbox
            label="Exploitation evidence"
            hint="A published exploit, observed activity, or a CISA KEV entry. Raises the priority score."
            checked={values.exploit_evidence}
            onChange={(event) => onChange({ exploit_evidence: event.target.checked })}
          />
          <Checkbox
            label="Internet exposed"
            hint="The vulnerable service is reachable from the public internet."
            checked={values.internet_exposed}
            onChange={(event) => onChange({ internet_exposed: event.target.checked })}
          />
        </div>

        <Field
          label="Compensating controls"
          htmlFor="finding-controls"
          hint="Documented controls reduce the priority score by the penalty shown in the methodology below."
          className="sm:col-span-2"
        >
          <Textarea
            id="finding-controls"
            rows={3}
            value={values.compensating_controls}
            onChange={(event) => onChange({ compensating_controls: event.target.value })}
          />
        </Field>

        <Field label="Description" htmlFor="finding-description" className="sm:col-span-2">
          <Textarea
            id="finding-description"
            rows={3}
            value={values.description}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </Field>

        <Field label="Notes" htmlFor="finding-notes" className="sm:col-span-2">
          <Textarea
            id="finding-notes"
            rows={2}
            value={values.notes}
            onChange={(event) => onChange({ notes: event.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

export function findingErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}
