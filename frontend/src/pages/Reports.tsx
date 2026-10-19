import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, RefreshCw } from 'lucide-react';
import { ApiError, api, postForFile } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { EM_DASH, formatDateTime, formatNumber, humanise, toOptions } from '@/lib/format';
import { sortStateOf, useListState } from '@/hooks/useListState';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type {
  GeneratedReport,
  Page,
  ReportCatalogEntry,
  ReportDataset,
  ReportRequest,
  ReportTypeKey,
  RiskCategory,
  RiskMeta,
  Severity,
} from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { ActiveFilters, DateRangeFilter, FilterBar, FilterSelect, SearchInput } from '@/components/ui/Filters';
import { CardSkeleton, EmptyState, ErrorState, NoticeBanner } from '@/components/ui/Feedback';
import { Field, Input, Select } from '@/components/ui/Form';
import { Tabs } from '@/components/ui/Tabs';
import { MethodologyPanel } from '@/components/ui/Methodology';

/**
 * Reports.
 *
 * A report is assembled by the API from persisted records. The screen builds the
 * request, shows the result as data before anything is written to a file, and
 * repeats the report's own methodology and limitations — so a downloaded PDF
 * cannot say something the on-screen preview did not.
 */

interface ReportFormValues {
  report_type: string;
  format: 'csv' | 'pdf';
  start_date: string;
  end_date: string;
  category: string;
  severity: string;
  business_unit: string;
}

const EMPTY_REPORT_FORM: ReportFormValues = {
  report_type: '',
  format: 'pdf',
  start_date: '',
  end_date: '',
  category: '',
  severity: '',
  business_unit: '',
};

export function ReportsPage() {
  const { can } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const [values, setValues] = useState<ReportFormValues>(EMPTY_REPORT_FORM);
  const [preview, setPreview] = useState<ReportDataset | null>(null);
  const [exporting, setExporting] = useState(false);

  const list = useListState({ filterKeys: ['report_type'] as const, defaultSort: 'created_at' });

  const catalog = useQuery({
    queryKey: queryKeys.reportCatalog,
    queryFn: () => api.get<ReportCatalogEntry[]>('/api/reports/catalog'),
    staleTime: 30 * 60_000,
  });

  const history = useQuery({
    queryKey: queryKeys.reports(list.query),
    queryFn: () => api.get<Page<GeneratedReport>>('/api/reports', { query: list.query }),
  });

  const riskMeta = useQuery({
    queryKey: queryKeys.riskMeta,
    queryFn: () => api.get<RiskMeta>('/api/risks/meta'),
    staleTime: 5 * 60_000,
  });

  const catalogEntry = catalog.data?.find((entry) => entry.key === values.report_type);

  const previewMutation = useMutation({
    mutationFn: (payload: ReportRequest) => api.post<ReportDataset>('/api/reports/preview', payload),
    onSuccess: (dataset) => setPreview(dataset),
  });

  const canExport = can('report:export');

  const runExport = async () => {
    setExporting(true);
    try {
      const filename = await postForFile(
        '/api/reports/export',
        buildReportRequest(values),
        `finrisk-${values.report_type}.${values.format}`,
      );
      push({ tone: 'success', title: 'Report exported', description: filename });
      await queryClient.invalidateQueries({ queryKey: ['reports'] });
    } catch (error) {
      push({ tone: 'error', title: 'The export failed', description: errorMessage(error) });
    } finally {
      setExporting(false);
    }
  };

  const update = (patch: Partial<ReportFormValues>) => setValues((current) => ({ ...current, ...patch }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Build a report from the records in this organization, review it as data, then export it as CSV or PDF. Every export is recorded against your name."
      />

      <Tabs
        items={[
          {
            id: 'build',
            label: 'Build a report',
            content: (
              <div className="space-y-4">
                <Card>
                  <CardHeader
                    title="Report definition"
                    description="The available report types come from the API, so the list here is never out of step with what the server can produce."
                  />
                  <CardBody className="space-y-4">
                    {catalog.isPending ? <CardSkeleton lines={3} /> : null}
                    {catalog.isError ? (
                      <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} title="Could not load the report catalogue" />
                    ) : null}

                    {catalog.data ? (
                      <>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field label="Report type" required htmlFor="report-type" className="sm:col-span-2">
                            <Select
                              id="report-type"
                              value={values.report_type}
                              placeholder="Choose a report"
                              options={catalog.data.map((entry) => ({ value: entry.key, label: entry.title }))}
                              onChange={(event) => update({ report_type: event.target.value })}
                            />
                          </Field>

                          <Field
                            label="Format"
                            htmlFor="report-format"
                            hint="Preview always shows the data; the format only applies to the exported file."
                          >
                            <Select
                              id="report-format"
                              value={values.format}
                              options={[
                                { value: 'pdf', label: 'PDF document' },
                                { value: 'csv', label: 'CSV spreadsheet' },
                              ]}
                              onChange={(event) => update({ format: event.target.value as 'csv' | 'pdf' })}
                            />
                          </Field>

                          <DateRangeFilter
                            startDate={values.start_date}
                            endDate={values.end_date}
                            onChange={({ startDate, endDate }) => update({ start_date: startDate, end_date: endDate })}
                          />

                          <Field label="Risk category" htmlFor="report-category">
                            <Select
                              id="report-category"
                              value={values.category}
                              placeholder="All categories"
                              options={toOptions(riskMeta.data?.categories)}
                              onChange={(event) => update({ category: event.target.value })}
                            />
                          </Field>

                          <Field label="Severity" htmlFor="report-severity">
                            <Select
                              id="report-severity"
                              value={values.severity}
                              placeholder="All severities"
                              options={toOptions(riskMeta.data?.severities)}
                              onChange={(event) => update({ severity: event.target.value })}
                            />
                          </Field>

                          <Field
                            label="Business unit"
                            htmlFor="report-business-unit"
                            className="sm:col-span-2"
                            hint="Leave blank for the whole organization."
                          >
                            <Input
                              id="report-business-unit"
                              value={values.business_unit}
                              onChange={(event) => update({ business_unit: event.target.value })}
                            />
                          </Field>
                        </div>

                        {catalogEntry ? (
                          <NoticeBanner tone="info" title={catalogEntry.title}>
                            {catalogEntry.description}
                          </NoticeBanner>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="secondary"
                            icon={<Eye className="h-3.5 w-3.5" aria-hidden />}
                            loading={previewMutation.isPending}
                            disabled={!values.report_type}
                            onClick={() => previewMutation.mutate(buildReportRequest(values))}
                          >
                            Preview
                          </Button>
                          <Button
                            variant="primary"
                            icon={<Download className="h-3.5 w-3.5" aria-hidden />}
                            loading={exporting}
                            disabled={!values.report_type || !canExport}
                            onClick={() => void runExport()}
                            title={canExport ? undefined : 'Exporting requires the analyst role or above.'}
                          >
                            Export {values.format === 'csv' ? 'CSV' : 'PDF'}
                          </Button>
                          {!canExport ? (
                            <span className="text-2xs text-muted">
                              Your role can preview reports but cannot download them.
                            </span>
                          ) : null}
                        </div>

                        {previewMutation.isError ? (
                          <NoticeBanner tone="danger" title="The report could not be built">
                            {errorMessage(previewMutation.error)}
                          </NoticeBanner>
                        ) : null}
                      </>
                    ) : null}
                  </CardBody>
                </Card>

                {preview ? (
                  <Card>
                    <CardHeader
                      title={preview.title}
                      description={
                        <>
                          {formatNumber(preview.row_count)} row{preview.row_count === 1 ? '' : 's'} ·
                          built {formatDateTime(preview.generated_at)}
                        </>
                      }
                      actions={
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                          onClick={() => previewMutation.mutate(buildReportRequest(values))}
                          loading={previewMutation.isPending}
                        >
                          Rebuild
                        </Button>
                      }
                    />

                    {preview.figures?.length ? (
                      <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {preview.figures.map((figure) => (
                          <div key={figure.label} className="rounded border border-border bg-surface-muted/40 px-3 py-2">
                            <p className="text-2xs font-medium uppercase tracking-wide text-muted">{figure.label}</p>
                            <p className="mt-0.5 break-words text-sm font-semibold tabular-nums text-foreground">
                              {figure.value}
                            </p>
                          </div>
                        ))}
                      </CardBody>
                    ) : null}

                    <PreviewTable dataset={preview} />

                    <CardBody className="space-y-3">
                      <MethodologyPanel
                        title="How this report is produced"
                        methodology={preview.methodology}
                        limitations={preview.limitations}
                        defaultOpen
                      />
                      <p className="text-2xs text-muted">
                        Values are reproduced exactly as the report engine produced them. Amounts
                        appear in {preview.currency} because that is the organization's currency;
                        nothing is converted.
                      </p>
                    </CardBody>
                  </Card>
                ) : (
                  <EmptyState
                    title="Nothing previewed yet"
                    description="Choose a report type and press Preview to see the rows before writing a file."
                  />
                )}
              </div>
            ),
          },
          {
            id: 'history',
            label: 'Report history',
            badge: history.data?.total || undefined,
            content: (
              <Card>
                <CardHeader
                  title="Generated reports"
                  description="Every export is recorded here with who produced it and when. The file itself is not retained by the platform."
                />
                <FilterBar>
                  <SearchInput
                    value={list.state.search}
                    onChange={list.setSearch}
                    placeholder="Search report type or title…"
                    label="Search report history"
                  />
                  <FilterSelect
                    label="Report type"
                    value={list.state.filters.report_type ?? ''}
                    onChange={(value) => list.setFilter('report_type', value)}
                    options={(catalog.data ?? []).map((entry) => ({ value: entry.key, label: entry.title }))}
                  />
                </FilterBar>
                <div className="px-4 py-3">
                  <ActiveFilters
                    filters={[
                      list.state.filters.report_type
                        ? {
                            key: 'report_type',
                            label: `Report type: ${humanise(list.state.filters.report_type)}`,
                            onClear: () => list.setFilter('report_type', ''),
                          }
                        : null,
                      list.state.search
                        ? { key: 'q', label: `Search: “${list.state.search}”`, onClear: () => list.setSearch('') }
                        : null,
                    ]}
                    onClearAll={() => list.clearFilters()}
                  />
                </div>
                <DataTable<GeneratedReport>
                  caption="Generated reports"
                  columns={HISTORY_COLUMNS}
                  rows={history.data?.items ?? []}
                  rowKey={(report) => report.id}
                  loading={history.isPending}
                  error={history.isError ? history.error : undefined}
                  onRetry={() => void history.refetch()}
                  sort={sortStateOf(list.state)}
                  onSortChange={({ sort, order }) => list.setSort(sort, order)}
                  filtered={list.hasFilters}
                  emptyTitle="No reports have been generated"
                  emptyDescription="Reports appear here once somebody exports one."
                  footer={
                    history.data ? (
                      <Pagination
                        page={history.data.page}
                        pageSize={history.data.page_size}
                        total={history.data.total}
                        pages={history.data.pages}
                        onPageChange={list.setPage}
                        onPageSizeChange={list.setPageSize}
                        itemLabel="reports"
                      />
                    ) : null
                  }
                />
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview table
// ---------------------------------------------------------------------------

/** One dataset row, paired with its position so the table can key on it. */
interface PreviewRow {
  index: number;
  cells: Array<string | number | null>;
}

function PreviewTable({ dataset }: { dataset: ReportDataset }) {
  const rows: PreviewRow[] = dataset.rows.map((cells, index) => ({ index, cells }));
  const columns: Array<Column<PreviewRow>> = dataset.columns.map((header, columnIndex) => ({
    key: `${columnIndex}-${header}`,
    header,
    cell: (row) => <span className="text-xs">{renderCell(row.cells[columnIndex])}</span>,
  }));

  return (
    <div className="border-t border-border">
      <DataTable<PreviewRow>
        caption={`${dataset.title} data`}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.index}
        emptyTitle="This report produced no rows"
        emptyDescription="The filters matched no records. An empty report is not evidence that nothing is at risk — widen the period or clear a filter."
      />
    </div>
  );
}

/** A missing value is shown as a dash, never as zero. */
function renderCell(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return <span className="text-muted">{EM_DASH}</span>;
  return String(value);
}

const HISTORY_COLUMNS: Array<Column<GeneratedReport>> = [
  {
    key: 'title',
    header: 'Report',
    cell: (report) => (
      <span className="block">
        <span className="block text-xs font-medium text-foreground">{report.title}</span>
        <span className="block text-2xs text-muted">{humanise(report.report_type)}</span>
      </span>
    ),
  },
  {
    key: 'format',
    header: 'Format',
    sortKey: 'format',
    cell: (report) => <Badge tone="neutral">{report.format.toUpperCase()}</Badge>,
  },
  {
    key: 'rows',
    header: 'Rows',
    sortKey: 'row_count',
    align: 'right',
    cell: (report) => <span className="text-xs tabular-nums">{formatNumber(report.row_count)}</span>,
  },
  {
    key: 'period',
    header: 'Reporting period',
    hideOnMobile: true,
    cell: (report) =>
      report.reporting_period_start || report.reporting_period_end ? (
        <span className="text-xs">
          {report.reporting_period_start ?? 'start'} → {report.reporting_period_end ?? 'today'}
        </span>
      ) : (
        <span className="text-xs text-muted">All time</span>
      ),
  },
  {
    key: 'created',
    header: 'Generated',
    sortKey: 'created_at',
    cell: (report) => <span className="text-xs tabular-nums">{formatDateTime(report.created_at)}</span>,
  },
];

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

export function buildReportRequest(values: ReportFormValues): ReportRequest {
  return {
    report_type: values.report_type as ReportTypeKey,
    format: values.format,
    start_date: values.start_date || null,
    end_date: values.end_date || null,
    category: values.category ? (values.category as RiskCategory) : null,
    severity: values.severity ? (values.severity as Severity) : null,
    business_unit: values.business_unit.trim() || null,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}
