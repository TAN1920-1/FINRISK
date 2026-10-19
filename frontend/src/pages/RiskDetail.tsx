import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClipboardCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDate, formatDateTime, humanise, toOptions } from '@/lib/format';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type {
  AssetOption,
  EvidenceRecord,
  MemberOut,
  Message,
  Mitigation,
  Risk,
  RiskAssessmentOut,
  RiskDetail,
  RiskMeta,
} from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { Badge, RiskScore, SeverityBadge, StatusBadge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { Tabs } from '@/components/ui/Tabs';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { CardSkeleton, EmptyState, ErrorState, NoticeBanner } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { MethodologyPanel } from '@/components/ui/Methodology';
import {
  buildRiskPayload,
  formFromRisk,
  isOverdue,
  riskErrorMessage,
  RiskForm,
  validateRiskForm,
  type RiskFormErrors,
  type RiskFormValues,
} from './RiskRegister';

/**
 * Risk detail.
 *
 * Everything that changes a risk goes through its own endpoint, so the audit
 * trail records *what* changed rather than a single opaque "saved". Status
 * changes and reassessments write an assessment snapshot; ownership changes are
 * recorded separately; evidence raises the risk's evidence-quality rating.
 */
export function RiskDetailPage() {
  const { riskId = '' } = useParams<{ riskId: string }>();
  const navigate = useNavigate();
  const { can, hasRole } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [editValues, setEditValues] = useState<RiskFormValues | null>(null);
  const [editErrors, setEditErrors] = useState<RiskFormErrors>({});
  const [statusDraft, setStatusDraft] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [ownerDraft, setOwnerDraft] = useState('');
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);

  const risk = useQuery({
    queryKey: queryKeys.risk(riskId),
    queryFn: () => api.get<RiskDetail>(`/api/risks/${riskId}`),
    enabled: Boolean(riskId),
  });

  const writable = can('risk:write');

  const meta = useQuery({
    queryKey: queryKeys.riskMeta,
    queryFn: () => api.get<RiskMeta>('/api/risks/meta'),
    enabled: writable,
    staleTime: 5 * 60_000,
  });

  const members = useQuery({
    queryKey: queryKeys.members,
    queryFn: () => api.get<MemberOut[]>('/api/auth/members'),
    enabled: writable,
  });

  const assets = useQuery({
    queryKey: queryKeys.assetOptions,
    queryFn: () => api.get<AssetOption[]>('/api/assets/options'),
    enabled: writable,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['risk'] });
    await queryClient.invalidateQueries({ queryKey: ['risks'] });
  };

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.patch<Risk>(`/api/risks/${riskId}`, payload),
    onSuccess: async (updated) => {
      setEditOpen(false);
      push({
        tone: 'success',
        title: 'Risk updated',
        description: `${updated.risk_ref} is now ${humanise(updated.severity)}.`,
      });
      await refresh();
    },
  });

  const statusMutation = useMutation({
    mutationFn: (input: { status: string; note: string }) =>
      api.post<Risk>(`/api/risks/${riskId}/status`, {
        status: input.status,
        note: input.note.trim() || null,
      }),
    onSuccess: async (updated) => {
      setStatusNote('');
      push({
        tone: 'success',
        title: `Status set to ${humanise(updated.status)}`,
        description: 'An assessment snapshot was recorded with this change.',
      });
      await refresh();
    },
  });

  const ownerMutation = useMutation({
    mutationFn: (ownerId: string) =>
      api.post<Risk>(`/api/risks/${riskId}/owner`, {
        owner_id: ownerId ? Number(ownerId) : null,
      }),
    onSuccess: async (updated) => {
      push({
        tone: 'success',
        title: updated.owner_name ? `Assigned to ${updated.owner_name}` : 'Ownership cleared',
      });
      await refresh();
    },
  });

  const assessmentMutation = useMutation({
    mutationFn: () => api.post<RiskAssessmentOut>(`/api/risks/${riskId}/assessments`),
    onSuccess: async () => {
      push({
        tone: 'success',
        title: 'Assessment recorded',
        description: 'A snapshot of the current scoring was added to the history.',
      });
      await refresh();
    },
  });

  const evidenceMutation = useMutation({
    mutationFn: () =>
      api.post<EvidenceRecord>(`/api/risks/${riskId}/evidence`, {
        title: evidence.title.trim(),
        description: evidence.description.trim() || null,
        evidence_type: evidence.evidence_type.trim() || 'document',
        source_url: evidence.source_url.trim() || null,
        quality: evidence.quality,
        collected_at: evidence.collected_at ? `${evidence.collected_at}T00:00:00Z` : null,
      }),
    onSuccess: async (record) => {
      setEvidenceOpen(false);
      setEvidence(EMPTY_EVIDENCE);
      push({
        tone: 'success',
        title: 'Evidence added',
        description: `“${record.title}” was recorded and the risk's evidence quality was re-evaluated.`,
      });
      await refresh();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete<Message>(`/api/risks/${riskId}`),
    onSuccess: async (result) => {
      setDeleteOpen(false);
      push({ tone: 'success', title: 'Risk deleted', description: result.message });
      await queryClient.invalidateQueries({ queryKey: ['risks'] });
      navigate('/risks');
    },
  });

  if (risk.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader title="Risk" description="Loading the risk record…" />
        <CardSkeleton lines={6} />
      </div>
    );
  }

  if (risk.isError) {
    if (risk.error instanceof ApiError && risk.error.isNotFound) {
      return (
        <EmptyState
          title="That risk does not exist"
          description="It may have been deleted, or it belongs to a different organization."
          action={
            <Button variant="primary" onClick={() => navigate('/risks')}>
              Back to the register
            </Button>
          }
        />
      );
    }
    return (
      <ErrorState error={risk.error} onRetry={() => void risk.refetch()} title="Could not load this risk" />
    );
  }

  const data = risk.data;
  const openStatuses = meta.data?.open_statuses ?? [];
  const overdue = isOverdue(data, openStatuses);
  const bands = data.residual_severity ? humanise(data.residual_severity) : null;

  const openEdit = () => {
    setEditValues(formFromRisk(data));
    setEditErrors({});
    setEditOpen(true);
  };

  const submitEdit = () => {
    if (!editValues) return;
    const validation = validateRiskForm(editValues);
    setEditErrors(validation);
    if (Object.keys(validation).length) return;
    updateMutation.mutate(buildRiskPayload(editValues, 'update'));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${data.risk_ref} · ${data.title}`}
        breadcrumbs={[{ label: 'Risk register', to: '/risks' }, { label: data.risk_ref }]}
        description={
          <>
            {humanise(data.category)}
            {data.business_unit ? ` · ${data.business_unit}` : ''}
            {data.asset_name ? ` · ${data.asset_name}` : ''}
          </>
        }
        meta={
          <>
            <SeverityBadge severity={data.severity} />
            <RiskScore score={data.inherent_score} severity={data.severity} label="Inherent score" />
            <StatusBadge status={data.status} />
            <Badge tone="neutral">Evidence {humanise(data.evidence_quality)}</Badge>
            {overdue ? <Badge tone="critical">Overdue</Badge> : null}
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
                  <CardHeader title="Scoring" description="The inherent score is likelihood × impact. The residual score appears only once the risk has been reassessed." />
                  <CardBody>
                    <DescriptionList
                      columns={3}
                      items={[
                        {
                          label: 'Inherent score',
                          value: <RiskScore score={data.inherent_score} severity={data.severity} />,
                        },
                        { label: 'Likelihood', value: data.likelihood },
                        { label: 'Impact', value: data.impact },
                        {
                          label: 'Residual score',
                          value:
                            data.residual_score === null || data.residual_score === undefined ? (
                              <span className="text-muted">Not assessed</span>
                            ) : (
                              <RiskScore score={data.residual_score} severity={data.residual_severity} />
                            ),
                        },
                        {
                          label: 'Residual likelihood',
                          value: data.residual_likelihood ?? <span className="text-muted">Not assessed</span>,
                        },
                        {
                          label: 'Residual impact',
                          value: data.residual_impact ?? <span className="text-muted">Not assessed</span>,
                        },
                        { label: 'Evidence quality', value: humanise(data.evidence_quality) },
                        { label: 'Status', value: <StatusBadge status={data.status} /> },
                        {
                          label: 'Due date',
                          value: data.due_date ? (
                            <span className="flex items-center gap-2">
                              <span className="tabular-nums">{formatDate(data.due_date)}</span>
                              {overdue ? <Badge tone="critical">Overdue</Badge> : null}
                            </span>
                          ) : (
                            <span className="text-muted">Not set</span>
                          ),
                        },
                        { label: 'Asset', value: data.asset_name ?? <span className="text-muted">Not linked</span> },
                        { label: 'Owner', value: data.owner_name ?? <span className="text-muted">Unassigned</span> },
                        { label: 'Business unit', value: data.business_unit ?? <span className="text-muted">Not set</span> },
                        { label: 'Source', value: data.source ?? <span className="text-muted">Not recorded</span> },
                        { label: 'Created', value: formatDateTime(data.created_at) },
                        { label: 'Last updated', value: formatDateTime(data.updated_at) },
                      ]}
                    />
                  </CardBody>
                </Card>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader title="Description and context" />
                    <CardBody className="space-y-3">
                      <LongText label="Description" value={data.description} />
                      <LongText label="Threat scenario" value={data.threat_scenario} />
                      <LongText label="Existing controls" value={data.existing_controls} />
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader
                      title="Treatment"
                      description="Free-text treatment notes. Quantified loss estimates belong in the scenario models."
                    />
                    <CardBody className="space-y-3">
                      <LongText label="Mitigation plan" value={data.mitigation_plan} />
                      <LongText
                        label="Financial impact assumptions"
                        value={data.financial_impact_assumptions}
                      />
                      <DescriptionList
                        items={[
                          {
                            label: 'Mitigation actions',
                            value: `${data.mitigation_count ?? 0} linked${data.completed_mitigation_count ? ` · ${data.completed_mitigation_count} completed` : ''}`,
                          },
                          {
                            label: 'Expected gross exposure',
                            value: data.expected_gross_exposure
                              ? `${data.expected_gross_exposure} ${data.currency ?? ''}`.trim()
                              : 'Not estimated',
                          },
                          {
                            label: 'Expected residual exposure',
                            value: data.expected_residual_exposure
                              ? `${data.expected_residual_exposure} ${data.currency ?? ''}`.trim()
                              : 'Not estimated',
                          },
                        ]}
                      />
                    </CardBody>
                  </Card>
                </div>

                {writable ? (
                  <Card>
                    <CardHeader
                      title="Lifecycle and ownership"
                      description="Both actions are recorded individually in the audit trail."
                    />
                    <CardBody className="grid gap-5 lg:grid-cols-2">
                      <div className="space-y-3">
                        <Field
                          label="Change status"
                          htmlFor="risk-status-change"
                          hint="Moving a risk writes an assessment snapshot with the note below."
                        >
                          <Select
                            id="risk-status-change"
                            value={statusDraft || data.status}
                            options={toOptions(meta.data?.statuses)}
                            onChange={(event) => setStatusDraft(event.target.value)}
                          />
                        </Field>
                        <Field label="Note" htmlFor="risk-status-note">
                          <Textarea
                            id="risk-status-note"
                            rows={2}
                            value={statusNote}
                            placeholder="Why is this moving?"
                            onChange={(event) => setStatusNote(event.target.value)}
                          />
                        </Field>
                        <Button
                          variant="primary"
                          disabled={(statusDraft || data.status) === data.status && !statusNote.trim()}
                          loading={statusMutation.isPending}
                          onClick={() =>
                            statusMutation.mutate({ status: statusDraft || data.status, note: statusNote })
                          }
                        >
                          Apply status change
                        </Button>
                        {statusMutation.isError ? (
                          <NoticeBanner tone="danger" title="The status could not be changed">
                            {riskErrorMessage(statusMutation.error)}
                          </NoticeBanner>
                        ) : null}
                      </div>

                      <div className="space-y-3">
                        <Field
                          label="Owner"
                          htmlFor="risk-owner-change"
                          hint={members.data?.length ? undefined : 'No other members to assign.'}
                        >
                          <Select
                            id="risk-owner-change"
                            value={ownerDraft || (data.owner_id ? String(data.owner_id) : '')}
                            placeholder="Unassigned"
                            options={(members.data ?? []).map((member) => ({
                              value: String(member.user_id),
                              label: `${member.full_name} · ${humanise(member.role)}`,
                            }))}
                            onChange={(event) => setOwnerDraft(event.target.value)}
                          />
                        </Field>
                        <Button
                          variant="outline"
                          loading={ownerMutation.isPending}
                          onClick={() =>
                            ownerMutation.mutate(ownerDraft || (data.owner_id ? String(data.owner_id) : ''))
                          }
                        >
                          Save owner
                        </Button>
                        {ownerMutation.isError ? (
                          <NoticeBanner tone="danger" title="The owner could not be changed">
                            {riskErrorMessage(ownerMutation.error)}
                          </NoticeBanner>
                        ) : null}
                      </div>
                    </CardBody>
                  </Card>
                ) : null}
              </div>
            ),
          },
          {
            id: 'assessments',
            label: 'Assessments',
            badge: data.assessments?.length ? `(${data.assessments.length})` : undefined,
            content: (
              <Card>
                <CardHeader
                  title="Assessment history"
                  description="Each row is a snapshot of the scoring at a point in time, captured when the risk was created, re-scored or moved between statuses."
                  actions={
                    writable ? (
                      <Button
                        variant="outline"
                        size="sm"
                        icon={<ClipboardCheck className="h-3.5 w-3.5" aria-hidden />}
                        loading={assessmentMutation.isPending}
                        onClick={() => assessmentMutation.mutate()}
                      >
                        Record snapshot
                      </Button>
                    ) : undefined
                  }
                />
                <DataTable<RiskAssessmentOut>
                  columns={ASSESSMENT_COLUMNS}
                  rows={data.assessments ?? []}
                  rowKey={(item) => item.id}
                  emptyTitle="No assessments recorded"
                  emptyDescription="A snapshot is written automatically when the risk is created or its status changes."
                />
                {assessmentMutation.isError ? (
                  <div className="px-4 pb-3">
                    <NoticeBanner tone="danger" title="The snapshot could not be recorded">
                      {riskErrorMessage(assessmentMutation.error)}
                    </NoticeBanner>
                  </div>
                ) : null}
              </Card>
            ),
          },
          {
            id: 'evidence',
            label: 'Evidence',
            badge: data.evidence?.length ? `(${data.evidence.length})` : undefined,
            content: (
              <Card>
                <CardHeader
                  title="Evidence"
                  description="Adding evidence can only raise the risk's evidence quality, never lower it."
                  actions={
                    writable ? (
                      <Button
                        variant="outline"
                        size="sm"
                        icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
                        onClick={() => setEvidenceOpen(true)}
                      >
                        Add evidence
                      </Button>
                    ) : undefined
                  }
                />
                {data.evidence?.length ? (
                  <ul className="divide-y divide-border">
                    {data.evidence.map((record) => (
                      <li key={record.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-foreground">{record.title}</p>
                            <p className="mt-0.5 text-2xs text-muted">
                              {humanise(record.evidence_type)}
                              {record.collected_at ? ` · collected ${formatDate(record.collected_at)}` : ''}
                              {record.source_url ? ' · has a source link' : ''}
                            </p>
                          </div>
                          <Badge tone={record.quality === 'verified' || record.quality === 'high' ? 'low' : 'neutral'}>
                            {humanise(record.quality)}
                          </Badge>
                        </div>
                        {record.description ? (
                          <p className="mt-1.5 text-2xs text-muted">{record.description}</p>
                        ) : null}
                        {record.source_url ? (
                          <a
                            href={record.source_url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="mt-1 inline-block break-all text-2xs text-primary hover:underline"
                          >
                            {record.source_url}
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    title="No evidence recorded"
                    description="Evidence quality is currently “none”. Attach the documents, logs or test results behind this risk."
                  />
                )}
              </Card>
            ),
          },
          {
            id: 'mitigations',
            label: 'Mitigations',
            badge: data.mitigations?.length ? `(${data.mitigations.length})` : undefined,
            content: (
              <Card>
                <CardHeader
                  title="Mitigation actions"
                  description="Actions that treat this risk. Manage them in full on the Mitigation Plans screen."
                  actions={
                    <Link
                      to={`/mitigation-plans?risk_id=${data.id}`}
                      className="rounded text-xs text-primary hover:underline"
                    >
                      Open in Mitigation Plans
                    </Link>
                  }
                />
                <DataTable<Mitigation>
                  columns={MITIGATION_COLUMNS}
                  rows={data.mitigations ?? []}
                  rowKey={(item) => item.id}
                  emptyTitle="No mitigation actions linked"
                  emptyDescription="Add an action from the Mitigation Plans screen to start tracking treatment."
                />
              </Card>
            ),
          },
        ]}
      />

      <MethodologyPanel
        title="How this risk is scored"
        methodology={
          meta.data
            ? `Inherent score = likelihood × impact, each on a 1–5 scale. The severity band comes from the documented ranges and is recomputed by the API on every read, so it can never drift from the underlying numbers.`
            : 'Risk scoring follows a documented 5 x 5 likelihood x impact matrix.'
        }
        formula="inherent_score = likelihood × impact"
        limitations={
          bands
            ? `A residual severity of ${bands} describes the scoring after treatment; it is a re-assessment, not observed outcome data.`
            : 'Leave the residual score empty until the risk has genuinely been reassessed — an empty residual is more honest than a copy of the inherent score.'
        }
      />

      {writable && meta.data ? (
        <Dialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          title={`Edit ${data.risk_ref}`}
          description="Changes are recorded in the audit trail. Clearing the residual fields removes the post-treatment score."
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
            <RiskForm
              values={editValues}
              errors={editErrors}
              onChange={(patch) =>
                setEditValues((current) => (current ? { ...current, ...patch } : current))
              }
              meta={meta.data}
              members={members.data ?? []}
              assets={assets.data ?? []}
            />
          ) : null}
          {updateMutation.isError ? (
            <NoticeBanner tone="danger" title="The risk could not be saved" className="mt-3">
              {riskErrorMessage(updateMutation.error)}
            </NoticeBanner>
          ) : null}
        </Dialog>
      ) : null}

      <Dialog
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        title="Add evidence"
        description="Evidence raises the risk's evidence-quality rating and is attributed to you."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEvidenceOpen(false)} disabled={evidenceMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={evidenceMutation.isPending}
              disabled={evidence.title.trim().length < 2}
              onClick={() => evidenceMutation.mutate()}
            >
              Add evidence
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Title" required htmlFor="evidence-title">
            <Input
              id="evidence-title"
              value={evidence.title}
              onChange={(event) => setEvidence({ ...evidence, title: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="evidence-type" hint="A short label such as document, log or test result.">
              <Input
                id="evidence-type"
                value={evidence.evidence_type}
                list="evidence-type-options"
                onChange={(event) => setEvidence({ ...evidence, evidence_type: event.target.value })}
              />
              <datalist id="evidence-type-options">
                {EVIDENCE_TYPES.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>
            </Field>
            <Field label="Quality" htmlFor="evidence-quality" hint="Adding evidence can only raise the rating.">
              <Select
                id="evidence-quality"
                value={evidence.quality}
                options={toOptions(meta.data?.evidence_quality)}
                onChange={(event) => setEvidence({ ...evidence, quality: event.target.value })}
              />
            </Field>
            <Field label="Collected on" htmlFor="evidence-collected">
              <Input
                id="evidence-collected"
                type="date"
                value={evidence.collected_at}
                onChange={(event) => setEvidence({ ...evidence, collected_at: event.target.value })}
              />
            </Field>
            <Field label="Source URL" htmlFor="evidence-url">
              <Input
                id="evidence-url"
                value={evidence.source_url}
                onChange={(event) => setEvidence({ ...evidence, source_url: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Notes" htmlFor="evidence-description">
            <Textarea
              id="evidence-description"
              rows={3}
              value={evidence.description}
              onChange={(event) => setEvidence({ ...evidence, description: event.target.value })}
            />
          </Field>
          {evidenceMutation.isError ? (
            <NoticeBanner tone="danger" title="The evidence could not be saved">
              {riskErrorMessage(evidenceMutation.error)}
            </NoticeBanner>
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this risk?"
        message={
          <>
            <p>
              {data.risk_ref} and everything recorded against it — its assessments, evidence and
              mitigation actions — will be removed. The deletion is written to the audit trail.
            </p>
            <p className="mt-2">This cannot be undone.</p>
          </>
        }
        confirmLabel="Delete risk"
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

function LongText({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-wide text-muted">{label}</p>
      {value ? (
        <p className="mt-0.5 whitespace-pre-wrap text-xs text-foreground">{value}</p>
      ) : (
        <p className="mt-0.5 text-xs text-muted">Not recorded.</p>
      )}
    </div>
  );
}

const ASSESSMENT_COLUMNS: Array<Column<RiskAssessmentOut>> = [
  {
    key: 'assessed_at',
    header: 'Assessed',
    cell: (item) => <span className="text-xs tabular-nums">{formatDateTime(item.assessed_at)}</span>,
  },
  { key: 'method', header: 'Method', hideOnMobile: true, cell: (item) => <Badge tone="neutral">{humanise(item.method)}</Badge> },
  {
    key: 'inherent',
    header: 'Inherent',
    align: 'right',
    cell: (item) => <span className="text-xs tabular-nums">{item.inherent_score}</span>,
  },
  {
    key: 'residual',
    header: 'Residual',
    align: 'right',
    cell: (item) =>
      item.residual_score === null || item.residual_score === undefined ? (
        <span className="text-xs text-muted">—</span>
      ) : (
        <span className="text-xs tabular-nums">{item.residual_score}</span>
      ),
  },
  {
    key: 'confidence',
    header: 'Confidence',
    align: 'right',
    hideOnMobile: true,
    cell: (item) =>
      item.confidence === null || item.confidence === undefined ? (
        <span className="text-xs text-muted">—</span>
      ) : (
        <span className="text-xs tabular-nums">{item.confidence.toFixed(2)}</span>
      ),
  },
  {
    key: 'notes',
    header: 'Notes',
    cell: (item) => <span className="text-2xs text-muted">{item.notes ?? '—'}</span>,
  },
];

const MITIGATION_COLUMNS: Array<Column<Mitigation>> = [
  {
    key: 'action',
    header: 'Action',
    cell: (item) => (
      <span className="block max-w-md">
        <span className="block truncate text-xs font-medium text-foreground">{item.action_ref}</span>
        <span className="block truncate text-2xs text-muted">{item.description}</span>
      </span>
    ),
  },
  { key: 'priority', header: 'Priority', cell: (item) => <SeverityBadge severity={item.priority} /> },
  { key: 'status', header: 'Status', cell: (item) => <StatusBadge status={item.status} /> },
  {
    key: 'assignee',
    header: 'Assigned',
    hideOnMobile: true,
    cell: (item) => <span className="text-xs">{item.assigned_user_name ?? 'Unassigned'}</span>,
  },
  {
    key: 'due',
    header: 'Due',
    hideOnMobile: true,
    cell: (item) => (
      <span className="flex items-center gap-1.5 text-xs tabular-nums">
        {item.due_date ? formatDate(item.due_date) : '—'}
        {item.is_overdue ? <Badge tone="critical">Overdue</Badge> : null}
      </span>
    ),
  },
];

const EMPTY_EVIDENCE = {
  title: '',
  evidence_type: 'document',
  quality: 'medium',
  source_url: '',
  collected_at: '',
  description: '',
};

const EVIDENCE_TYPES = [
  'document',
  'screenshot',
  'log',
  'report',
  'test_result',
  'interview',
  'external_source',
  'other',
];
