import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDate, formatDateTime } from '@/lib/format';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type { AssetOption, Finding, FindingMeta, Message, PriorityFactor } from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { Badge, SeverityBadge, StatusBadge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { Tabs } from '@/components/ui/Tabs';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { CardSkeleton, EmptyState, ErrorState, NoticeBanner } from '@/components/ui/Feedback';
import { MethodologyPanel } from '@/components/ui/Methodology';
import {
  buildFindingPayload,
  findingErrorMessage,
  FindingForm,
  formFromFinding,
  isRemediationOverdue,
  REMEDIATION_TONE,
  validateFindingForm,
  type FindingFormErrors,
  type FindingFormValues,
} from './Cybersecurity';

/**
 * Vulnerability finding detail.
 *
 * The page exists to keep one distinction visible at all times: the CVSS score
 * belongs to the source and the priority score belongs to this platform. They
 * are shown in separate fields, the disclaimer the API returns is reproduced
 * verbatim beside the priority score, and the factor breakdown shows exactly
 * which inputs were combined — so a reader can never mistake one for the other.
 */
export function FindingDetailPage() {
  const { findingId = '' } = useParams<{ findingId: string }>();
  const navigate = useNavigate();
  const { can, hasRole } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editValues, setEditValues] = useState<FindingFormValues | null>(null);
  const [editErrors, setEditErrors] = useState<FindingFormErrors>({});

  const finding = useQuery({
    queryKey: queryKeys.finding(findingId),
    queryFn: () => api.get<Finding>(`/api/vulnerabilities/findings/${findingId}`),
    enabled: Boolean(findingId),
  });

  const writable = can('vulnerability:write');

  const meta = useQuery({
    queryKey: queryKeys.findingMeta,
    queryFn: () => api.get<FindingMeta>('/api/vulnerabilities/meta'),
    staleTime: 5 * 60_000,
  });

  const assets = useQuery({
    queryKey: queryKeys.assetOptions,
    queryFn: () => api.get<AssetOption[]>('/api/assets/options'),
    enabled: writable,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['finding'] });
    await queryClient.invalidateQueries({ queryKey: ['findings'] });
  };

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.patch<Finding>(`/api/vulnerabilities/findings/${findingId}`, payload),
    onSuccess: async (updated) => {
      setEditOpen(false);
      push({
        tone: 'success',
        title: 'Finding updated',
        description: `${updated.title} was saved and its priority re-scored.`,
      });
      await refresh();
    },
  });

  const enrichMutation = useMutation({
    mutationFn: () => api.post<Finding>(`/api/vulnerabilities/findings/${findingId}/enrich`),
    onSuccess: async (updated) => {
      push({
        tone: 'success',
        title: 'Intelligence refreshed',
        description: `${updated.cve_id ?? 'The finding'} was re-read from upstream sources and re-scored.`,
      });
      await refresh();
    },
    onError: (error) => {
      push({ tone: 'error', title: 'Could not refresh intelligence', description: findingErrorMessage(error) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete<Message>(`/api/vulnerabilities/findings/${findingId}`),
    onSuccess: async () => {
      push({ tone: 'success', title: 'Finding deleted', description: 'The deletion was written to the audit trail.' });
      await queryClient.invalidateQueries({ queryKey: ['findings'] });
      navigate('/cybersecurity');
    },
  });

  if (finding.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader title="Finding" description="Loading the vulnerability finding…" />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (finding.isError) {
    if (finding.error instanceof ApiError && finding.error.isNotFound) {
      return (
        <EmptyState
          title="That finding does not exist"
          description="It may have been deleted, or it belongs to a different organization."
          action={
            <Button variant="primary" onClick={() => navigate('/cybersecurity')}>
              Back to findings
            </Button>
          }
        />
      );
    }
    return (
      <ErrorState
        error={finding.error}
        onRetry={() => void finding.refetch()}
        title="Could not load this finding"
      />
    );
  }

  const data = finding.data;
  const overdue = isRemediationOverdue(data);
  const factors = data.priority_factors ?? [];

  const openEdit = () => {
    setEditValues(formFromFinding(data));
    setEditErrors({});
    setEditOpen(true);
  };

  const submitEdit = () => {
    if (!editValues) return;
    const validation = validateFindingForm(editValues);
    setEditErrors(validation);
    if (Object.keys(validation).length) return;
    updateMutation.mutate(buildFindingPayload(editValues, 'update'));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={data.title}
        breadcrumbs={[{ label: 'Cybersecurity', to: '/cybersecurity' }, { label: `Finding ${data.id}` }]}
        description={
          <>
            {data.cve_id ? `${data.cve_id}` : 'No CVE identifier'}
            {data.asset_name ? ` · ${data.asset_name}` : ' · No asset linked'}
          </>
        }
        meta={
          <>
            <SeverityBadge severity={data.priority_band} suffix="priority" />
            <StatusBadge status={data.remediation_status} tone={REMEDIATION_TONE[data.remediation_status] ?? 'neutral'} />
            {data.exploit_evidence ? <Badge tone="critical">Exploited</Badge> : null}
            {data.internet_exposed ? <Badge tone="high">Internet-exposed</Badge> : null}
            {overdue ? <Badge tone="critical">Overdue</Badge> : null}
            {data.is_demo ? <Badge tone="unknown">Demonstration data</Badge> : null}
          </>
        }
        actions={
          <>
            {writable && data.cve_id ? (
              <Button
                variant="outline"
                icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => enrichMutation.mutate()}
                disabled={enrichMutation.isPending}
              >
                Refresh intelligence
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
          It was generated by the platform's demo seeder and carries no information about your
          organization. Replace it before using these figures for any decision.
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
                    title="Priority"
                    description="The platform's context-aware priority score, and the technical severity supplied by the source. They are different numbers."
                  />
                  <CardBody className="space-y-4">
                    <DescriptionList
                      columns={3}
                      items={[
                        {
                          label: 'Priority score',
                          value:
                            data.priority_score === null || data.priority_score === undefined ? (
                              <span className="text-muted">Not scored</span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <span className="text-sm font-semibold tabular-nums">
                                  {data.priority_score.toFixed(0)}
                                </span>
                                <SeverityBadge severity={data.priority_band} />
                              </span>
                            ),
                        },
                        {
                          label: 'CVSS score',
                          value:
                            data.cvss_score === null || data.cvss_score === undefined ? (
                              <span className="text-muted" title="The source did not publish a CVSS score for this finding.">
                                Not published
                              </span>
                            ) : (
                              <span className="tabular-nums">{data.cvss_score.toFixed(1)}</span>
                            ),
                        },
                        {
                          label: 'CVSS severity',
                          value: data.cvss_severity ? (
                            <SeverityBadge severity={data.cvss_severity} />
                          ) : (
                            <span className="text-muted">Not published</span>
                          ),
                        },
                        {
                          label: 'Exploit evidence',
                          value: data.exploit_evidence ? (
                            <Badge tone="critical">Exploited</Badge>
                          ) : (
                            <span className="text-muted">None recorded</span>
                          ),
                        },
                        {
                          label: 'Internet exposure',
                          value: data.internet_exposed ? (
                            <Badge tone="high">Exposed</Badge>
                          ) : (
                            <span className="text-muted">Not internet-facing</span>
                          ),
                        },
                        {
                          label: 'Detected',
                          value: data.detected_at ? formatDate(data.detected_at) : 'Not recorded',
                        },
                        {
                          label: 'Vulnerability age',
                          value:
                            data.vulnerability_age_days === null || data.vulnerability_age_days === undefined
                              ? 'Not recorded'
                              : `${data.vulnerability_age_days} days`,
                        },
                        {
                          label: 'Remediation status',
                          value: (
                            <StatusBadge
                              status={data.remediation_status}
                              tone={REMEDIATION_TONE[data.remediation_status] ?? 'neutral'}
                            />
                          ),
                        },
                        {
                          label: 'Due date',
                          value: data.remediation_due_date ? formatDate(data.remediation_due_date) : 'No due date set',
                        },
                      ]}
                    />

                    {meta.data ? (
                      <NoticeBanner tone="info" title="About the priority score">
                        {meta.data.disclaimer}
                      </NoticeBanner>
                    ) : null}
                  </CardBody>
                </Card>

                <div className="grid gap-4 lg:grid-cols-3">
                  <Card>
                    <CardHeader title="Description" />
                    <CardBody>
                      <LongText value={data.description} />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader title="Compensating controls" />
                    <CardBody>
                      <LongText value={data.compensating_controls} />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader title="Notes" />
                    <CardBody>
                      <LongText value={data.notes} />
                    </CardBody>
                  </Card>
                </div>

                <Card>
                  <CardHeader title="Record" />
                  <CardBody>
                    <DescriptionList
                      columns={3}
                      items={[
                        { label: 'Linked asset', value: data.asset_name ?? 'No asset linked' },
                        { label: 'CVE identifier', value: data.cve_id ?? 'None' },
                        {
                          label: 'Remediation reference',
                          value: data.remediation_reference ?? 'Not recorded',
                        },
                        { label: 'Recorded', value: formatDateTime(data.created_at) },
                        { label: 'Last updated', value: formatDateTime(data.updated_at) },
                        {
                          label: 'Finding ID',
                          value: <span className="tabular-nums">{data.id}</span>,
                        },
                      ]}
                    />
                  </CardBody>
                </Card>
              </div>
            ),
          },
          {
            id: 'priority',
            label: 'Priority breakdown',
            badge: factors.length || undefined,
            content: (
              <div className="space-y-4">
                <Card>
                  <CardHeader
                    title="Factor contributions"
                    description="Total priority = the sum of these contributions, less the compensating-control penalty when controls are documented."
                  />
                  <CardBody>
                    <DataTable
                      columns={FACTOR_COLUMNS}
                      rows={factors}
                      rowKey={(factor) => factor.key}
                      emptyTitle="No factor breakdown available"
                      emptyDescription="The platform has not scored this finding from factors, so no breakdown can be shown."
                    />
                  </CardBody>
                </Card>

                {meta.data ? (
                  <MethodologyPanel
                    methodology={meta.data.methodology}
                    limitations={meta.data.disclaimer}
                    formula={weightsText(meta.data)}
                    defaultOpen
                  />
                ) : null}
              </div>
            ),
          },
        ]}
      />

      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit finding"
        description="The CVSS score and the priority score are separate; editing descriptions and remediation details does not overwrite the published CVSS score."
        size="xl"
        footer={
          <>
            {updateMutation.isError ? (
              <p className="mr-auto text-xs text-risk-critical">{findingErrorMessage(updateMutation.error)}</p>
            ) : null}
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        {editValues && meta.data ? (
          <FindingForm
            values={editValues}
            errors={editErrors}
            meta={meta.data}
            assets={assets.data ?? []}
            onChange={(patch) => setEditValues((current) => (current ? { ...current, ...patch } : current))}
          />
        ) : (
          <CardSkeleton lines={4} />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this finding?"
        message={
          <>
            <p>
              {data.title} will be removed from the register and from every count and score that
              uses it. The deletion is written to the audit trail.
            </p>
            <p className="mt-2">This cannot be undone.</p>
          </>
        }
        confirmLabel="Delete finding"
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components and columns
// ---------------------------------------------------------------------------

function LongText({ value }: { value?: string | null }) {
  return (
    <p className="whitespace-pre-wrap text-xs text-foreground">
      {value ?? <span className="text-muted">Not recorded.</span>}
    </p>
  );
}

const FACTOR_COLUMNS: Array<Column<PriorityFactor>> = [
  { key: 'label', header: 'Factor', cell: (factor) => <span className="text-xs font-medium">{factor.label}</span> },
  {
    key: 'weight',
    header: 'Weight',
    align: 'right',
    cell: (factor) => <span className="text-xs tabular-nums text-muted">{factor.weight}</span>,
  },
  {
    key: 'contribution',
    header: 'Contribution',
    align: 'right',
    cell: (factor) => <span className="text-xs tabular-nums">{factor.contribution.toFixed(1)}</span>,
  },
  {
    key: 'detail',
    header: 'Detail',
    hideOnMobile: true,
    cell: (factor) => <span className="text-xs text-muted">{factor.detail}</span>,
  },
];

/** Render the documented weights as a padded block, so the sum can be checked by eye. */
function weightsText(meta: FindingMeta): string {
  const rows = Object.entries(meta.weights).map(
    ([key, weight]) => `${key.padEnd(26, ' ')}${String(weight).padStart(5, ' ')}`,
  );
  rows.push(`${'-compensating_control_penalty'.padEnd(26, ' ')}${String(meta.compensating_control_penalty).padStart(5, ' ')}`);
  return rows.join('\n');
}
