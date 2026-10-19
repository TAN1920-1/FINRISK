import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDate, formatDateTime, formatNumber, formatPercentValue, humanise } from '@/lib/format';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type {
  Message,
  OsintScanResult,
  QuestionnaireTemplate,
  TemplateKind,
  VendorAssessment,
} from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { Badge, RiskScore, SeverityBadge, StatusBadge } from '@/components/ui/Badge';
import type { BadgeTone } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { Tabs } from '@/components/ui/Tabs';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { CardSkeleton, EmptyState, ErrorState, NoticeBanner } from '@/components/ui/Feedback';
import { MethodologyPanel } from '@/components/ui/Methodology';
import {
  buildVendorPayload,
  classificationLabel,
  formFromVendor,
  maturityLabel,
  readAnswer,
  validateVendorForm,
  VendorForm,
  type VendorFormErrors,
  type VendorFormValues,
} from './VendorAssessments';

/**
 * A single vendor assessment.
 *
 * Three things this page refuses to blur together:
 *
 * * **The stored score and the displayed score.** `inherent_score` and
 *   `severity` come from the server; the page never recomputes `impact ×
 *   likelihood` in the browser, so what is shown is what was persisted.
 * * **The engine's verdict and a decision.** The verdict is the legacy
 *   calculator's label; the inputs that produced it are shown next to it.
 * * **A scan and its absence.** OSINT warnings are the finding; a scan that was
 *   skipped (live checks disabled) produces no findings, and the page says so
 *   rather than printing a reassuring zero.
 */

interface OsintWarning {
  type: string;
  level: string;
  title: string;
  detail: string;
  source: string;
}

const WARNING_TONE: Record<string, BadgeTone> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

export function VendorDetailPage() {
  const { vendorId = '' } = useParams<{ vendorId: string }>();
  const navigate = useNavigate();
  const { can, hasRole } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [editValues, setEditValues] = useState<VendorFormValues | null>(null);
  const [editErrors, setEditErrors] = useState<VendorFormErrors>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [scanResult, setScanResult] = useState<OsintScanResult | null>(null);

  const vendor = useQuery({
    queryKey: queryKeys.vendor(vendorId),
    queryFn: () => api.get<VendorAssessment>(`/api/tilt/vendors/${vendorId}`),
    enabled: Boolean(vendorId),
  });

  const kind: TemplateKind = vendor.data?.assessment_type === 'cloud' ? 'cloud' : 'standard';

  const templates = useQuery({
    queryKey: queryKeys.templates(kind),
    queryFn: () => api.get<QuestionnaireTemplate[]>(`/api/tilt/templates/${kind}`),
    enabled: Boolean(vendor.data),
    staleTime: 30 * 60_000,
  });

  const writable = can('risk:write');

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['vendor'] });
    await queryClient.invalidateQueries({ queryKey: ['vendors'] });
  };

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.patch<VendorAssessment>(`/api/tilt/vendors/${vendorId}`, payload),
    onSuccess: async (updated) => {
      setEditOpen(false);
      push({
        tone: 'success',
        title: 'Vendor assessment updated',
        description: `${updated.vendor_name} was saved. Its stored score is unchanged until the assessment is run again.`,
      });
      await refresh();
    },
  });

  const calculateMutation = useMutation({
    mutationFn: () => api.post<VendorAssessment>(`/api/tilt/vendors/${vendorId}/calculate`),
    onSuccess: async (updated) => {
      push({
        tone: 'success',
        title: 'Assessment scored',
        description: updated.verdict
          ? `${updated.vendor_name} scored ${updated.score ?? '—'} of ${updated.max_score ?? '—'} — ${updated.verdict}.`
          : `${updated.vendor_name} was re-scored.`,
      });
      await refresh();
    },
    onError: (error) => {
      push({ tone: 'error', title: 'Could not score the assessment', description: serverError(error) });
    },
  });

  const scanMutation = useMutation({
    mutationFn: () => api.post<OsintScanResult>(`/api/tilt/vendors/${vendorId}/osint-scan`),
    onSuccess: async (result) => {
      setScanResult(result);
      push({
        tone: result.warnings?.length ? 'warning' : 'success',
        title: result.live_checks_enabled ? 'OSINT scan complete' : 'OSINT scan ran offline',
        description: result.live_checks_enabled
          ? `${result.warnings?.length ?? 0} warning(s) recorded.`
          : 'Live checks are disabled, so no external service was queried and nothing was found.',
      });
      await refresh();
    },
    onError: (error) => {
      push({ tone: 'error', title: 'Could not run the OSINT scan', description: serverError(error) });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: () => api.post<VendorAssessment>(`/api/tilt/vendors/${vendorId}/acknowledge`),
    onSuccess: async () => {
      push({
        tone: 'success',
        title: 'Warnings acknowledged',
        description: 'The acknowledgement is recorded on the audit trail.',
      });
      await refresh();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete<Message>(`/api/tilt/vendors/${vendorId}`),
    onSuccess: async (result) => {
      push({ tone: 'success', title: 'Vendor assessment deleted', description: result.message });
      await queryClient.invalidateQueries({ queryKey: ['vendors'] });
      navigate('/vendor-assessments');
    },
  });

  if (vendor.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader title="Vendor assessment" description="Loading the assessment…" />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (vendor.isError) {
    if (vendor.error instanceof ApiError && vendor.error.isNotFound) {
      return (
        <EmptyState
          title="That vendor assessment does not exist"
          description="It may have been deleted, or it belongs to a different organization."
          action={
            <Button variant="primary" onClick={() => navigate('/vendor-assessments')}>
              Back to vendor assessments
            </Button>
          }
        />
      );
    }
    return (
      <ErrorState
        error={vendor.error}
        onRetry={() => void vendor.refetch()}
        title="Could not load this vendor assessment"
      />
    );
  }

  const data = vendor.data;
  const answersMap = data.assessment_type === 'cloud' ? data.cloud_scores : data.answers;
  const storedWarnings = asWarnings(data.osint_warnings);
  const scanned = Boolean(data.last_scanned_at);

  const openEdit = () => {
    setEditValues(formFromVendor(data));
    setEditErrors({});
    setEditOpen(true);
  };

  const submitEdit = () => {
    if (!editValues) return;
    const validation = validateVendorForm(editValues);
    setEditErrors(validation);
    if (Object.keys(validation).length) return;
    updateMutation.mutate(buildVendorPayload(editValues));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.vendor_name}
        breadcrumbs={[{ label: 'Vendor Assessments', to: '/vendor-assessments' }, { label: data.vendor_name }]}
        description={
          <>
            {data.primary_domain ?? 'No domain recorded'}
            {' · '}
            {humanise(data.assessment_type)} questionnaire
          </>
        }
        meta={
          <>
            <StatusBadge status={data.status} />
            <Badge tone={data.assessment_type === 'cloud' ? 'primary' : 'neutral'}>
              {humanise(data.assessment_type)}
            </Badge>
            {data.severity ? <SeverityBadge severity={data.severity} suffix="inherent" /> : null}
            {scanned && !data.osint_acknowledged && storedWarnings.length > 0 ? (
              <Badge tone="high">Unacknowledged OSINT warnings</Badge>
            ) : null}
            {data.is_demo ? <Badge tone="unknown">Demonstration data</Badge> : null}
          </>
        }
        actions={
          <>
            {writable ? (
              <Button
                variant="outline"
                icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => calculateMutation.mutate()}
                disabled={calculateMutation.isPending}
              >
                Run assessment
              </Button>
            ) : null}
            {writable ? (
              <Button variant="outline" icon={<Pencil className="h-3.5 w-3.5" aria-hidden />} onClick={openEdit}>
                Edit
              </Button>
            ) : null}
            {hasRole('risk_manager') ? (
              <Button
                variant="danger"
                icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </Button>
            ) : null}
          </>
        }
      />

      {data.is_demo ? (
        <NoticeBanner tone="warning" title="This record is synthetic demonstration data">
          It was generated to illustrate the module and carries no information about a real vendor.
          Replace it before using these figures for any decision.
        </NoticeBanner>
      ) : null}

      <Tabs
        items={[
          {
            id: 'overview',
            label: 'Overview',
            content: (
              <div className="space-y-4">
                <Card>
                  <CardHeader
                    title="Scoring"
                    description="The values the server persisted the last time the assessment was run. They do not change when the details or answers are edited."
                  />
                  <CardBody className="space-y-4">
                    <DescriptionList
                      columns={3}
                      items={[
                        {
                          label: 'Inherent risk',
                          value: <RiskScore score={data.inherent_score} severity={data.severity} />,
                        },
                        {
                          label: 'Vulnerability',
                          value:
                            data.vulnerability === null || data.vulnerability === undefined ? (
                              <span className="text-muted">Not assessed</span>
                            ) : (
                              <span className="tabular-nums">{formatPercentValue(data.vulnerability)}</span>
                            ),
                        },
                        {
                          label: 'Maturity score',
                          value:
                            data.score === null || data.score === undefined ? (
                              <span className="text-muted">Not scored</span>
                            ) : (
                              <span className="tabular-nums">
                                {data.score} / {data.max_score ?? '—'}
                              </span>
                            ),
                        },
                        {
                          label: 'Impact',
                          value:
                            data.impact === null || data.impact === undefined ? (
                              <span className="text-muted">Not assessed</span>
                            ) : (
                              <span className="tabular-nums">{formatNumber(data.impact, { maximumFractionDigits: 1 })}</span>
                            ),
                        },
                        {
                          label: 'Likelihood',
                          value:
                            data.likelihood === null || data.likelihood === undefined ? (
                              <span className="text-muted">Not assessed</span>
                            ) : (
                              <span className="tabular-nums">
                                {formatNumber(data.likelihood, { maximumFractionDigits: 1 })}
                              </span>
                            ),
                        },
                        {
                          label: 'Data classification',
                          value:
                            data.data_classification === null || data.data_classification === undefined ? (
                              <span className="text-muted">Not recorded</span>
                            ) : (
                              <span title={`Impact axis set to ${data.data_classification}`}>
                                {classificationLabel(data.data_classification)}
                              </span>
                            ),
                        },
                      ]}
                    />

                    <div className="rounded border border-border bg-surface-muted/50 p-3">
                      <p className="text-2xs font-medium uppercase tracking-wide text-muted">Verdict</p>
                      <p className="mt-1 text-sm text-foreground">
                        {data.verdict ?? <span className="text-muted">Not assessed</span>}
                      </p>
                      <p className="mt-1 text-2xs text-muted">
                        The scoring engine's own label for the answers supplied. It is not a
                        procurement decision and it does not verify the answers.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded border border-border p-3">
                        <p className="text-2xs font-medium uppercase tracking-wide text-muted">Weakest answer</p>
                        <p className="mt-1 text-xs text-foreground">
                          {data.weakness ?? <span className="text-muted">Not derived</span>}
                        </p>
                      </div>
                      <div className="rounded border border-border p-3">
                        <p className="text-2xs font-medium uppercase tracking-wide text-muted">Strongest answer</p>
                        <p className="mt-1 text-xs text-foreground">
                          {data.strength ?? <span className="text-muted">Not derived</span>}
                        </p>
                      </div>
                    </div>

                    <p className="text-2xs text-muted">
                      Weakest and strongest are derived only when at least two items are scored and
                      the scores differ.
                    </p>
                  </CardBody>
                </Card>

                <MethodologyPanel
                  title="How this score is calculated"
                  defaultOpen
                  methodology="Standard: each maturity answer is inverted (1 → 1.0, 5 → 0.2), weighted Critical 3×, High 2×, otherwise 1×, averaged to a vulnerability percentage; maturity is 100 minus vulnerability. Cloud: (maturity ÷ 5) × points summed over the criteria out of 55. Impact and likelihood come from the same cut-offs (15 / 30 / 45 of 55), and an inherent risk score is likelihood × impact on a 1–25 scale."
                  limitations="A high maturity score means the questionnaire was answered well, not that the vendor was tested. No answers at all scores 100% vulnerability on the standard questionnaire, so an unscored vendor must not be read as a low-risk one."
                />

                <Card>
                  <CardHeader title="Record" />
                  <CardBody>
                    <DescriptionList
                      columns={3}
                      items={[
                        { label: 'Status', value: data.status },
                        { label: 'Created', value: formatDateTime(data.created_at) },
                        { label: 'Last updated', value: formatDateTime(data.updated_at) },
                        { label: 'Last OSINT scan', value: data.last_scanned_at ? formatDateTime(data.last_scanned_at) : 'Never scanned' },
                        { label: 'OSINT warnings acknowledged', value: data.osint_acknowledged ? 'Yes' : 'No' },
                        { label: 'Vendor ID', value: <span className="tabular-nums">{data.id}</span> },
                      ]}
                    />
                  </CardBody>
                </Card>
              </div>
            ),
          },
          {
            id: 'questionnaire',
            label: 'Questionnaire',
            badge: templates.data?.length || undefined,
            content: (
              <div className="space-y-4">
                {templates.isPending ? (
                  <CardSkeleton lines={5} />
                ) : templates.isError ? (
                  templates.error instanceof ApiError && templates.error.isNotFound ? (
                    <NoticeBanner tone="warning" title={`No ${kind} questionnaire is defined`}>
                      The server has no {kind} questionnaire templates, so the answers recorded here
                      cannot be labelled. The stored answers are still shown in raw form below.
                    </NoticeBanner>
                  ) : (
                    <ErrorState
                      error={templates.error}
                      onRetry={() => void templates.refetch()}
                      title="Could not load the questionnaire"
                    />
                  )
                ) : (
                  <Card>
                    <CardHeader
                      title={`${humanise(kind)} questionnaire`}
                      description="Read-only. Answers are edited through the Edit dialog, and the score is only recalculated when the assessment is run."
                    />
                    <CardBody>
                      <DataTable<QuestionnaireTemplate>
                        caption="Questionnaire answers"
                        columns={questionnaireColumns(answersMap)}
                        rows={templates.data ?? []}
                        rowKey={(item) => item.id}
                        emptyTitle="The questionnaire has no items"
                        emptyDescription="The template for this assessment type defines no questions, so there is nothing to answer."
                      />
                    </CardBody>
                  </Card>
                )}

                {storedAnswerCount(answersMap) === 0 ? (
                  <NoticeBanner tone="warning" title="No answers have been recorded">
                    Without answers the standard questionnaire scores 100% vulnerability and the
                    cloud scorecard scores nothing. This is a record of missing information, not a
                    clean result.
                  </NoticeBanner>
                ) : null}
              </div>
            ),
          },
          {
            id: 'osint',
            label: 'OSINT',
            badge: storedWarnings.length || undefined,
            content: (
              <div className="space-y-4">
                <Card>
                  <CardHeader
                    title="Public-source checks"
                    description="Ransomware leak-site membership, the TLS certificate and the DMARC record. Checks are best-effort and never prove a vendor is safe."
                    actions={
                      writable ? (
                        <Button
                          variant="outline"
                          icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                          onClick={() => scanMutation.mutate()}
                          disabled={scanMutation.isPending}
                        >
                          Run scan
                        </Button>
                      ) : null
                    }
                  />
                  <CardBody className="space-y-4">
                    <DescriptionList
                      columns={3}
                      items={[
                        {
                          label: 'Last scanned',
                          value: data.last_scanned_at ? formatDate(data.last_scanned_at) : 'Never scanned',
                        },
                        {
                          label: 'Warnings recorded',
                          value: <span className="tabular-nums">{storedWarnings.length}</span>,
                        },
                        {
                          label: 'Acknowledged',
                          value: data.osint_acknowledged ? 'Yes' : 'No',
                        },
                      ]}
                    />

                    {!scanned ? (
                      <NoticeBanner tone="info" title="This vendor has never been scanned">
                        No scan has been run, so no findings — and no clean bill of health — exist
                        yet. Run the scan to check the public sources.
                      </NoticeBanner>
                    ) : null}

                    {scanResult && !scanResult.live_checks_enabled ? (
                      <NoticeBanner tone="warning" title="Live checks were disabled">
                        No network or DNS call was made, so the empty result below means “not
                        checked”, not “nothing found”.
                      </NoticeBanner>
                    ) : null}

                    {scanResult?.notes?.length ? (
                      <div className="rounded border border-border bg-surface-muted/50 p-3">
                        <p className="text-2xs font-medium uppercase tracking-wide text-muted">
                          Scan notes
                        </p>
                        <ul className="mt-1 list-inside list-disc space-y-0.5 text-2xs text-muted">
                          {scanResult.notes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {scanResult ? <ScanResultPanel result={scanResult} /> : null}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader
                    title="Findings"
                    description="Each warning names its source so it can be checked independently."
                    actions={
                      writable && storedWarnings.length > 0 && !data.osint_acknowledged ? (
                        <Button
                          variant="primary"
                          icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
                          onClick={() => acknowledgeMutation.mutate()}
                          disabled={acknowledgeMutation.isPending}
                        >
                          Acknowledge
                        </Button>
                      ) : null
                    }
                  />
                  <CardBody className="space-y-3">
                    {data.osint_acknowledged && storedWarnings.length > 0 ? (
                      <NoticeBanner tone="info" title="These warnings have been acknowledged">
                        Acknowledging records that they were seen. It does not mean they were
                        remediated or that the risk was accepted.
                      </NoticeBanner>
                    ) : null}

                    {storedWarnings.length === 0 ? (
                      <EmptyState
                        title={scanned ? 'No warnings on record' : 'Not scanned yet'}
                        description={
                          scanned
                            ? 'The last scan produced no warnings. That is the absence of a finding, not evidence of security.'
                            : 'Run a scan to check the public sources for this vendor.'
                        }
                      />
                    ) : (
                      <ul className="space-y-2">
                        {storedWarnings.map((warning, index) => (
                          <li key={`${warning.type}-${index}`} className="rounded border border-border p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={WARNING_TONE[warning.level] ?? 'neutral'}>
                                {humanise(warning.level || 'unknown')}
                              </Badge>
                              <span className="text-xs font-medium text-foreground">{warning.title}</span>
                            </div>
                            {warning.detail ? (
                              <p className="mt-1 text-2xs text-muted">{warning.detail}</p>
                            ) : null}
                            {warning.source ? (
                              <p className="mt-1 text-2xs text-muted">
                                Source: <span className="text-foreground">{warning.source}</span>
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}

                    {dmarcCheckedDomains(data) ? (
                      <p className="text-2xs text-muted">
                        DMARC was checked for: <span className="text-foreground">{dmarcCheckedDomains(data)}</span>
                      </p>
                    ) : null}
                  </CardBody>
                </Card>

                {scanMutation.isError ? (
                  <NoticeBanner tone="danger" title="The scan could not be run">
                    {serverError(scanMutation.error)}
                  </NoticeBanner>
                ) : null}
              </div>
            ),
          },
        ]}
      />

      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit ${data.vendor_name}`}
        description="Editing details and answers does not re-score the vendor. Run the assessment to recalculate."
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={updateMutation.isPending}>
              Cancel
            </Button>
            <Button variant="primary" loading={updateMutation.isPending} onClick={submitEdit}>
              Save changes
            </Button>
          </>
        }
      >
        {editValues ? (
          <VendorForm
            values={editValues}
            errors={editErrors}
            onChange={(patch) => setEditValues((current) => (current ? { ...current, ...patch } : current))}
            serverError={updateMutation.error}
          />
        ) : (
          <CardSkeleton lines={4} />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this vendor assessment?"
        message={
          <>
            <p>
              {data.vendor_name} and its questionnaire answers, scoring and OSINT findings will be
              removed. The deletion is written to the audit trail.
            </p>
            <p className="mt-2">This cannot be undone.</p>
          </>
        }
        confirmLabel="Delete assessment"
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components and helpers
// ---------------------------------------------------------------------------

/** The most recent scan's raw results, rendered as the checks they are. */
function ScanResultPanel({ result }: { result: OsintScanResult }) {
  const values = result.osint_results ?? {};
  const ransomware = values.ransomware;
  const ssl = values.ssl;
  const daysRemaining = values.ssl_days_remaining;
  const dmarc = values.dmarc;
  const dmarcPolicy = values.dmarc_policy;

  return (
    <div className="rounded border border-border bg-surface-muted/50 p-3">
      <p className="text-2xs font-medium uppercase tracking-wide text-muted">This scan’s results</p>
      <DescriptionList
        columns={2}
        className="mt-2"
        items={[
          {
            label: 'Ransomware leak sites',
            value:
              ransomware === null || ransomware === undefined ? (
                <span className="text-muted">Not checked</span>
              ) : ransomware ? (
                <Badge tone="critical">Listed</Badge>
              ) : (
                <Badge tone="low">Not listed</Badge>
              ),
          },
          {
            label: 'TLS certificate grade',
            value:
              ssl === null || ssl === undefined ? (
                <span className="text-muted">Not checked</span>
              ) : (
                <span className="tabular-nums">
                  {String(ssl)}
                  {typeof daysRemaining === 'number' ? ` · ${daysRemaining} day(s) remaining` : ''}
                </span>
              ),
          },
          {
            label: 'DMARC record',
            value:
              dmarc === null || dmarc === undefined ? (
                <span className="text-muted">Not checked</span>
              ) : dmarc ? (
                <Badge tone="low">Published{dmarcPolicy ? ` · p=${String(dmarcPolicy)}` : ''}</Badge>
              ) : (
                <Badge tone="medium">Not found</Badge>
              ),
          },
          {
            label: 'Live checks',
            value: result.live_checks_enabled ? 'Enabled' : 'Disabled — nothing was queried',
          },
        ]}
      />
    </div>
  );
}

function questionnaireColumns(
  answers: Record<string, unknown> | null | undefined,
): Array<Column<QuestionnaireTemplate>> {
  return [
    {
      key: 'position',
      header: '#',
      align: 'right',
      cell: (item) => <span className="text-2xs tabular-nums text-muted">{item.position}</span>,
    },
    {
      key: 'text',
      header: 'Question',
      cell: (item) => (
        <span className="block max-w-xl">
          <span className="block text-xs text-foreground">{item.text}</span>
          {item.description ? (
            <span className="mt-0.5 block text-2xs text-muted">{item.description}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      hideOnMobile: true,
      cell: (item) => <span className="text-2xs text-muted">{item.category ?? 'Uncategorised'}</span>,
    },
    {
      key: 'weight',
      header: 'Weight',
      hideOnMobile: true,
      cell: (item) => (
        <span className="text-2xs text-muted">
          {item.weight ?? 'Standard'}
          {item.criticality ? ` · ${item.criticality}` : ''}
        </span>
      ),
    },
    {
      key: 'answer',
      header: 'Answer',
      align: 'right',
      cell: (item) => {
        const value = readAnswer(answers, item.id);
        if (value === undefined || value === null || value === '') {
          return <span className="text-2xs text-muted">Unscored</span>;
        }
        return (
          <span className="text-xs tabular-nums">
            {String(value)}
            <span className="ml-1 text-2xs text-muted">{maturityLabel(value)}</span>
          </span>
        );
      },
    },
  ];
}

/** Count the answers actually recorded, ignoring empty entries. */
function storedAnswerCount(answers: Record<string, unknown> | null | undefined): number {
  if (!answers) return 0;
  return Object.values(answers).filter((value) => value !== null && value !== undefined && value !== '').length;
}

function dmarcCheckedDomains(data: VendorAssessment): string {
  const urls = data.osint_urls;
  if (!urls) return '';
  const domains = urls.dmarc_checked_domains;
  if (!Array.isArray(domains)) return '';
  return domains.map((domain) => String(domain)).join(', ');
}

function asWarnings(raw: Array<Record<string, unknown>> | null | undefined): OsintWarning[] {
  return (raw ?? []).map((item) => ({
    type: String(item.type ?? 'unknown'),
    level: String(item.level ?? ''),
    title: String(item.title ?? 'Finding'),
    detail: String(item.detail ?? ''),
    source: String(item.source ?? ''),
  }));
}

function serverError(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}
