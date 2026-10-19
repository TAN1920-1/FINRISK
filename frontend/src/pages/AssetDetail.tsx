import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, Pencil } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDate, formatDateTime, formatMoney, humanise } from '@/lib/format';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type { Asset, Finding, MemberOut, Message, Page, Risk } from '@/types/api';
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
  AssetForm,
  assetErrorMessage,
  buildAssetPayload,
  formFromAsset,
  validateAssetForm,
  type AssetFormErrors,
  type AssetFormValues,
} from './AssetRegistry';
import { REMEDIATION_TONE } from './Cybersecurity';

/**
 * Asset detail.
 *
 * One asset, everything attached to it. The page reads the linked risks and
 * findings from the API rather than counting them itself, so the numbers here
 * and the rollups on the registry always agree. Retiring an asset never deletes
 * its records: linked risks, findings and reports keep their references.
 */
export function AssetDetailPage() {
  const { assetId = '' } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const { can, hasRole } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const [editValues, setEditValues] = useState<AssetFormValues | null>(null);
  const [editErrors, setEditErrors] = useState<AssetFormErrors>({});

  const asset = useQuery({
    queryKey: queryKeys.asset(assetId),
    queryFn: () => api.get<Asset>(`/api/assets/${assetId}`),
    enabled: Boolean(assetId),
  });

  const risks = useQuery({
    queryKey: queryKeys.assetRisks(assetId),
    queryFn: () => api.get<Risk[]>(`/api/assets/${assetId}/risks`),
    enabled: Boolean(assetId),
  });

  const findings = useQuery({
    queryKey: queryKeys.findings({ asset_id: assetId }),
    queryFn: () =>
      api.get<Page<Finding>>('/api/vulnerabilities/findings', {
        query: { asset_id: assetId, page_size: 25, sort: 'priority_score', order: 'desc' },
      }),
    enabled: Boolean(assetId),
  });

  const writable = can('asset:write');

  const members = useQuery({
    queryKey: queryKeys.members,
    queryFn: () => api.get<MemberOut[]>('/api/auth/members'),
    enabled: writable,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['asset', assetId] });
    await queryClient.invalidateQueries({ queryKey: ['assets'] });
  };

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.patch<Asset>(`/api/assets/${assetId}`, payload),
    onSuccess: async (updated) => {
      setEditOpen(false);
      push({
        tone: 'success',
        title: 'Asset updated',
        description: `${updated.asset_ref} · ${updated.name} was saved.`,
      });
      await refresh();
    },
  });

  const retireMutation = useMutation({
    mutationFn: () => api.delete<Message>(`/api/assets/${assetId}`),
    onSuccess: async (result) => {
      setRetireOpen(false);
      push({ tone: 'success', title: 'Asset retired', description: result.message });
      await refresh();
    },
  });

  if (asset.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader title="Asset" description="Loading the asset record…" />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (asset.isError) {
    if (asset.error instanceof ApiError && asset.error.isNotFound) {
      return (
        <EmptyState
          title="That asset does not exist"
          description="It may have been removed, or it belongs to a different organization."
          action={
            <Button variant="primary" onClick={() => navigate('/assets')}>
              Back to the registry
            </Button>
          }
        />
      );
    }
    return (
      <ErrorState error={asset.error} onRetry={() => void asset.refetch()} title="Could not load this asset" />
    );
  }

  const data = asset.data;
  const openRiskCount = data.open_risks ?? 0;
  const openFindingCount = data.open_findings ?? 0;

  const openEdit = () => {
    setEditValues(formFromAsset(data));
    setEditErrors({});
    setEditOpen(true);
  };

  const submitEdit = () => {
    if (!editValues) return;
    const validation = validateAssetForm(editValues);
    setEditErrors(validation);
    if (Object.keys(validation).length) return;
    updateMutation.mutate(buildAssetPayload(editValues, 'update'));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${data.asset_ref} · ${data.name}`}
        breadcrumbs={[{ label: 'Asset registry', to: '/assets' }, { label: data.asset_ref }]}
        description={
          <>
            {humanise(data.asset_type)}
            {` · ${humanise(data.environment)}`}
            {data.business_unit ? ` · ${data.business_unit}` : ''}
          </>
        }
        meta={
          <>
            {data.is_active ? (
              <Badge tone="low">Active</Badge>
            ) : (
              <Badge tone="unknown">Retired</Badge>
            )}
            <Badge tone="neutral">Criticality {data.criticality}/5</Badge>
            {data.internet_exposed ? <Badge tone="high">Internet exposed</Badge> : null}
            <SeverityBadge severity={data.severity} suffix="worst risk" />
            {data.is_demo ? <Badge tone="unknown">Demonstration data</Badge> : null}
          </>
        }
        actions={
          <>
            {writable ? (
              <Button variant="outline" icon={<Pencil className="h-3.5 w-3.5" aria-hidden />} onClick={openEdit}>
                Edit
              </Button>
            ) : null}
            {hasRole('risk_manager') && data.is_active ? (
              <Button
                variant="danger"
                icon={<Archive className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => setRetireOpen(true)}
              >
                Retire
              </Button>
            ) : null}
          </>
        }
      />

      {!data.is_active ? (
        <NoticeBanner tone="warning" title="This asset is retired">
          It is hidden from the default registry view. Its linked risks, findings and reports are kept,
          because removing them would break their history.
        </NoticeBanner>
      ) : null}

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
                    title="Inventory record"
                    description="The ratings on this row are what the vulnerability priority score reads when a finding is recorded against this asset."
                  />
                  <CardBody>
                    <DescriptionList
                      columns={3}
                      items={[
                        { label: 'Reference', value: data.asset_ref },
                        { label: 'Name', value: data.name },
                        { label: 'Type', value: humanise(data.asset_type) },
                        { label: 'Environment', value: humanise(data.environment) },
                        { label: 'Criticality', value: `${data.criticality} / 5` },
                        { label: 'Data sensitivity', value: `${data.data_sensitivity} / 5` },
                        {
                          label: 'Internet exposed',
                          value: data.internet_exposed ? (
                            <Badge tone="high">Yes</Badge>
                          ) : (
                            <span className="text-muted">No</span>
                          ),
                        },
                        {
                          label: 'Financial importance',
                          value:
                            data.financial_importance === null || data.financial_importance === undefined ? (
                              <span className="text-muted">Not valued</span>
                            ) : (
                              formatMoney(data.financial_importance, data.currency)
                            ),
                        },
                        { label: 'Currency', value: data.currency },
                        { label: 'Business unit', value: data.business_unit ?? <span className="text-muted">Not set</span> },
                        { label: 'Owner', value: data.owner_name ?? <span className="text-muted">Unassigned</span> },
                        {
                          label: 'Last assessed',
                          value: data.last_assessed_at ? (
                            formatDate(data.last_assessed_at)
                          ) : (
                            <span className="text-muted">Never assessed</span>
                          ),
                        },
                        {
                          label: 'Open risks',
                          value: `${openRiskCount}`,
                        },
                        {
                          label: 'Open findings',
                          value: `${openFindingCount}`,
                        },
                        { label: 'Created', value: formatDateTime(data.created_at) },
                        { label: 'Last updated', value: formatDateTime(data.updated_at) },
                      ]}
                    />
                  </CardBody>
                </Card>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader title="Description" />
                    <CardBody>
                      <LongText value={data.description} />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader
                      title="Dependencies"
                      description="What this asset relies on, and what relies on it."
                    />
                    <CardBody>
                      <LongText value={data.dependencies} />
                    </CardBody>
                  </Card>
                  <Card className="lg:col-span-2">
                    <CardHeader title="Existing controls" />
                    <CardBody>
                      <LongText value={data.existing_controls} />
                    </CardBody>
                  </Card>
                </div>
              </div>
            ),
          },
          {
            id: 'risks',
            label: 'Risks',
            badge: openRiskCount ? `(${openRiskCount})` : undefined,
            content: (
              <Card>
                <CardHeader
                  title="Linked risks"
                  description="Risks recorded against this asset. Manage them in full in the risk register."
                  actions={
                    <Link to={`/risks?asset_id=${data.id}`} className="rounded text-xs text-primary hover:underline">
                      Open in the register
                    </Link>
                  }
                />
                <DataTable<Risk>
                  columns={RISK_COLUMNS}
                  rows={risks.data ?? []}
                  rowKey={(risk) => risk.id}
                  loading={risks.isPending}
                  error={risks.isError ? risks.error : undefined}
                  onRetry={() => void risks.refetch()}
                  onRowClick={(risk) => navigate(`/risks/${risk.id}`)}
                  emptyTitle="No risks linked to this asset"
                  emptyDescription="A link is created by choosing this asset when a risk is recorded."
                />
              </Card>
            ),
          },
          {
            id: 'findings',
            label: 'Findings',
            badge: openFindingCount ? `(${openFindingCount})` : undefined,
            content: (
              <Card>
                <CardHeader
                  title="Vulnerability findings"
                  description="Findings recorded against this asset, ordered by the platform's context-aware priority score."
                  actions={
                    <Link
                      to={`/cybersecurity?asset_id=${data.id}`}
                      className="rounded text-xs text-primary hover:underline"
                    >
                      Open in Cybersecurity
                    </Link>
                  }
                />
                <DataTable<Finding>
                  columns={FINDING_COLUMNS}
                  rows={findings.data?.items ?? []}
                  rowKey={(finding) => finding.id}
                  loading={findings.isPending}
                  error={findings.isError ? findings.error : undefined}
                  onRetry={() => void findings.refetch()}
                  onRowClick={(finding) => navigate(`/cybersecurity/${finding.id}`)}
                  emptyTitle="No findings recorded"
                  emptyDescription="Import a scanner export or record a finding from the Cybersecurity screen."
                />
              </Card>
            ),
          },
        ]}
      />

      <MethodologyPanel
        title="How this asset is used in scoring"
        methodology="The asset is not scored on its own. Its criticality and data sensitivity are inputs to the context-aware vulnerability priority score, and its linked risks are scored on the 5 × 5 likelihood × impact matrix. The counts and the worst-risk badge on this page are recomputed by the API from those linked records."
        formula={
          'priority_contribution = 10 × (criticality / 5) + 5 × (data_sensitivity / 5)  (see Cybersecurity for the full weighting)\n' +
          'worst_risk_severity   = max(likelihood × impact) over linked open risks'
        }
        limitations="An unlinked risk or finding is invisible here. If an asset looks clean, check first whether anything has been recorded against it — an empty list is not evidence of a safe system."
      />

      {writable ? (
        <Dialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          title={`Edit ${data.asset_ref}`}
          description="Changes are recorded in the audit trail. Setting the asset inactive retires it without deleting its linked records."
          size="lg"
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
            <AssetForm
              values={editValues}
              errors={editErrors}
              onChange={(patch) => setEditValues((current) => (current ? { ...current, ...patch } : current))}
              members={members.data ?? []}
            />
          ) : null}
          {updateMutation.isError ? (
            <NoticeBanner tone="danger" title="The asset could not be saved" className="mt-3">
              {assetErrorMessage(updateMutation.error)}
            </NoticeBanner>
          ) : null}
        </Dialog>
      ) : null}

      <ConfirmDialog
        open={retireOpen}
        title="Retire this asset?"
        message={
          <>
            <p>
              {data.asset_ref} · {data.name} will be marked inactive and hidden from the default
              registry view. It is not deleted.
            </p>
            <p className="mt-2">
              Its linked risks, findings and reports keep their references, and the retirement is
              written to the audit trail.
            </p>
          </>
        }
        confirmLabel="Retire asset"
        pending={retireMutation.isPending}
        onConfirm={() => retireMutation.mutate()}
        onCancel={() => setRetireOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components and columns
// ---------------------------------------------------------------------------

function LongText({ value }: { value?: string | null }) {
  return value ? (
    <p className="whitespace-pre-wrap text-xs text-foreground">{value}</p>
  ) : (
    <p className="text-xs text-muted">Not recorded.</p>
  );
}

const RISK_COLUMNS: Array<Column<Risk>> = [
  {
    key: 'ref',
    header: 'Risk',
    cell: (risk) => (
      <span className="block max-w-md">
        <span className="block text-xs font-medium text-primary">{risk.risk_ref}</span>
        <span className="block truncate text-2xs text-muted">{risk.title}</span>
      </span>
    ),
  },
  {
    key: 'inherent',
    header: 'Score',
    align: 'right',
    headerTitle: 'Likelihood × impact, 1–25.',
    cell: (risk) => (
      <span className="text-xs tabular-nums">
        {risk.inherent_score} <span className="text-muted">/25</span>
      </span>
    ),
  },
  { key: 'severity', header: 'Severity', cell: (risk) => <SeverityBadge severity={risk.severity} /> },
  { key: 'status', header: 'Status', cell: (risk) => <StatusBadge status={risk.status} /> },
  {
    key: 'owner',
    header: 'Owner',
    hideOnMobile: true,
    cell: (risk) => <span className="text-xs">{risk.owner_name ?? '—'}</span>,
  },
];

const FINDING_COLUMNS: Array<Column<Finding>> = [
  {
    key: 'title',
    header: 'Finding',
    cell: (finding) => (
      <span className="block max-w-md">
        <span className="block truncate text-xs font-medium text-foreground">{finding.title}</span>
        <span className="block truncate text-2xs text-muted">{finding.cve_id ?? 'No CVE'}</span>
      </span>
    ),
  },
  {
    key: 'cvss',
    header: 'CVSS',
    align: 'right',
    hideOnMobile: true,
    headerTitle: 'Technical severity supplied by the source, not this platform’s priority score.',
    cell: (finding) => (
      <span className="text-xs tabular-nums">
        {finding.cvss_score === null || finding.cvss_score === undefined
          ? '—'
          : finding.cvss_score.toFixed(1)}
      </span>
    ),
  },
  {
    key: 'priority',
    header: 'Priority',
    align: 'right',
    headerTitle: 'This platform’s context-aware priority score. Not a CVSS score.',
    cell: (finding) => (
      <span className="flex flex-col items-end gap-1">
        <span className="text-xs tabular-nums">
          {finding.priority_score === null || finding.priority_score === undefined
            ? '—'
            : finding.priority_score.toFixed(0)}
        </span>
        <SeverityBadge severity={finding.priority_band} />
      </span>
    ),
  },
  {
    key: 'remediation',
    header: 'Remediation',
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
    hideOnMobile: true,
    cell: (finding) => (
      <span className="text-xs tabular-nums">
        {finding.remediation_due_date ? formatDate(finding.remediation_due_date) : '—'}
      </span>
    ),
  },
];
