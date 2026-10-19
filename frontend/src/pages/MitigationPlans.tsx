import { useState, type MouseEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Upload } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDate, formatMoney, formatPercent, humanise, toOptions } from '@/lib/format';
import { sortStateOf, useListState } from '@/hooks/useListState';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type {
  MemberOut,
  Message,
  Mitigation,
  MitigationMeta,
  MitigationStatusResult,
  Page,
  RiskOption,
} from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge, SeverityBadge, StatusBadge } from '@/components/ui/Badge';
import type { BadgeTone } from '@/components/ui/Badge';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { ActiveFilters, FilterBar, FilterSelect, SearchInput } from '@/components/ui/Filters';
import { NoticeBanner } from '@/components/ui/Feedback';
import { Checkbox, Field, FormErrorSummary, Input, Select, Textarea } from '@/components/ui/Form';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { CSVImportDialog } from '@/components/ui/CSVImportDialog';
import { MethodologyPanel } from '@/components/ui/Methodology';

/**
 * Mitigation plans.
 *
 * A mitigation records planned work, not proof that a risk has been removed.
 * Closing an action therefore never moves the risk's residual score, and the
 * screen says so: the status dialog repeats the API's own note rather than
 * implying that completing a task reduced the risk.
 */

export const MITIGATION_TONE: Record<string, BadgeTone> = {
  planned: 'neutral',
  in_progress: 'primary',
  blocked: 'critical',
  completed: 'low',
  cancelled: 'unknown',
};

export function MitigationPlansPage() {
  const { can, hasRole } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Mitigation | null>(null);
  const [values, setValues] = useState<MitigationFormValues>(EMPTY_MITIGATION_FORM);
  const [errors, setErrors] = useState<MitigationFormErrors>({});
  const [statusTarget, setStatusTarget] = useState<Mitigation | null>(null);
  const [statusDraft, setStatusDraft] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Mitigation | null>(null);

  const list = useListState({
    filterKeys: ['status', 'priority', 'assigned_user_id', 'risk_id', 'overdue_only', 'open_only'] as const,
    defaultSort: 'due_date',
    defaultOrder: 'asc',
  });

  const meta = useQuery({
    queryKey: queryKeys.mitigationMeta,
    queryFn: () => api.get<MitigationMeta>('/api/mitigations/meta'),
    staleTime: 5 * 60_000,
  });

  const mitigations = useQuery({
    queryKey: queryKeys.mitigations(list.query),
    queryFn: () => api.get<Page<Mitigation>>('/api/mitigations', { query: list.query }),
  });

  const risks = useQuery({
    queryKey: queryKeys.riskOptions,
    queryFn: () => api.get<RiskOption[]>('/api/risks/options'),
    enabled: can('mitigation:write'),
  });

  const members = useQuery({
    queryKey: queryKeys.members,
    queryFn: () => api.get<MemberOut[]>('/api/auth/members'),
    enabled: can('mitigation:write'),
  });

  const writable = can('mitigation:write');

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setValues(EMPTY_MITIGATION_FORM);
    setErrors({});
  };

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<Mitigation>('/api/mitigations', payload),
    onSuccess: async (mitigation) => {
      closeForm();
      push({ tone: 'success', title: 'Remediation action created', description: `${mitigation.action_ref} was added to the plan.` });
      await queryClient.invalidateQueries({ queryKey: ['mitigations'] });
      await queryClient.invalidateQueries({ queryKey: ['risk'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.patch<Mitigation>(`/api/mitigations/${editing?.id}`, payload),
    onSuccess: async (mitigation) => {
      closeForm();
      push({ tone: 'success', title: 'Action updated', description: `${mitigation.action_ref} was saved.` });
      await queryClient.invalidateQueries({ queryKey: ['mitigations'] });
      await queryClient.invalidateQueries({ queryKey: ['risk'] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (input: { id: number; status: string; note: string }) =>
      api.post<MitigationStatusResult>(`/api/mitigations/${input.id}/status`, {
        status: input.status,
        note: input.note.trim() || null,
      }),
    onSuccess: async (result) => {
      setStatusTarget(null);
      setStatusNote('');
      // The API states, in its own words, that the risk's residual score did not
      // move. Repeating it verbatim keeps the screen from implying otherwise.
      push({
        tone: 'success',
        title: `${result.mitigation.action_ref} is now ${humanise(result.mitigation.status)}`,
        description: result.note,
      });
      await queryClient.invalidateQueries({ queryKey: ['mitigations'] });
      await queryClient.invalidateQueries({ queryKey: ['risk'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete<Message>(`/api/mitigations/${id}`),
    onSuccess: async () => {
      setDeleteTarget(null);
      push({ tone: 'success', title: 'Action deleted', description: 'The deletion was written to the audit trail.' });
      await queryClient.invalidateQueries({ queryKey: ['mitigations'] });
      await queryClient.invalidateQueries({ queryKey: ['risk'] });
    },
  });

  const openCreate = () => {
    setValues(EMPTY_MITIGATION_FORM);
    setErrors({});
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (mitigation: Mitigation) => {
    setValues(formFromMitigation(mitigation));
    setErrors({});
    setEditing(mitigation);
    setFormOpen(true);
  };

  const submit = () => {
    const validation = validateMitigationForm(values, editing ? 'update' : 'create');
    setErrors(validation);
    if (Object.keys(validation).length) return;
    const payload = buildMitigationPayload(values, editing ? 'update' : 'create');
    if (editing) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  const openStatus = (mitigation: Mitigation) => {
    setStatusTarget(mitigation);
    setStatusDraft(mitigation.status);
    setStatusNote('');
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mitigation Plans"
        description="Planned remediation work with an owner and a due date. Closing an action records that the work finished; it does not by itself reduce the risk's residual score."
        meta={
          mitigations.data ? (
            <span className="text-2xs text-muted">
              {mitigations.data.total} action{mitigations.data.total === 1 ? '' : 's'} in scope
            </span>
          ) : null
        }
        actions={
          writable ? (
            <>
              <Button
                variant="outline"
                icon={<Upload className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => setImportOpen(true)}
              >
                Import CSV
              </Button>
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={openCreate}>
                New action
              </Button>
            </>
          ) : null
        }
      />

      <NoticeBanner tone="info" title="What closing an action does">
        Completing or cancelling a remediation action does not change the risk's residual score. The
        residual only moves when somebody records explicit post-mitigation likelihood and impact on
        the risk itself.
      </NoticeBanner>

      <Card>
        <FilterBar>
          <SearchInput
            value={list.state.search}
            onChange={list.setSearch}
            placeholder="Search action or reference…"
            label="Search mitigation actions"
          />
          <FilterSelect
            label="Status"
            value={list.state.filters.status ?? ''}
            onChange={(value) => list.setFilter('status', value)}
            options={toOptions(meta.data?.statuses)}
          />
          <FilterSelect
            label="Priority"
            value={list.state.filters.priority ?? ''}
            onChange={(value) => list.setFilter('priority', value)}
            options={toOptions(meta.data?.priorities)}
          />
          <FilterSelect
            label="Owner"
            value={list.state.filters.assigned_user_id ?? ''}
            onChange={(value) => list.setFilter('assigned_user_id', value)}
            options={(members.data ?? []).map((member) => ({
              value: String(member.user_id),
              label: member.full_name,
            }))}
          />
          <div className="flex flex-col gap-1.5 pb-1">
            <Checkbox
              label="Open only"
              checked={list.state.filters.open_only === 'true'}
              onChange={(event) => list.setFilter('open_only', event.target.checked ? 'true' : '')}
            />
            <Checkbox
              label="Overdue only"
              checked={list.state.filters.overdue_only === 'true'}
              onChange={(event) => list.setFilter('overdue_only', event.target.checked ? 'true' : '')}
            />
          </div>
        </FilterBar>

        <div className="px-4 py-3">
          <ActiveFilters
            filters={[
              list.state.filters.status
                ? { key: 'status', label: `Status: ${humanise(list.state.filters.status)}`, onClear: () => list.setFilter('status', '') }
                : null,
              list.state.filters.priority
                ? { key: 'priority', label: `Priority: ${humanise(list.state.filters.priority)}`, onClear: () => list.setFilter('priority', '') }
                : null,
              list.state.filters.assigned_user_id
                ? {
                    key: 'assigned_user_id',
                    label: `Owner: ${ownerName(members.data, list.state.filters.assigned_user_id)}`,
                    onClear: () => list.setFilter('assigned_user_id', ''),
                  }
                : null,
              list.state.filters.open_only === 'true'
                ? { key: 'open_only', label: 'Open actions only', onClear: () => list.setFilter('open_only', '') }
                : null,
              list.state.filters.overdue_only === 'true'
                ? { key: 'overdue_only', label: 'Overdue only', onClear: () => list.setFilter('overdue_only', '') }
                : null,
              list.state.search
                ? { key: 'q', label: `Search: “${list.state.search}”`, onClear: () => list.setSearch('') }
                : null,
            ]}
            onClearAll={() => list.clearFilters()}
          />
        </div>

        <DataTable<Mitigation>
          caption="Mitigation plans"
          columns={mitigationColumns({
            onEdit: writable ? openEdit : undefined,
            onStatus: writable ? openStatus : undefined,
            onDelete: hasRole('risk_manager') ? setDeleteTarget : undefined,
          })}
          rows={mitigations.data?.items ?? []}
          rowKey={(mitigation) => mitigation.id}
          loading={mitigations.isPending}
          error={mitigations.isError ? mitigations.error : undefined}
          onRetry={() => void mitigations.refetch()}
          sort={sortStateOf(list.state)}
          onSortChange={({ sort, order }) => list.setSort(sort, order)}
          filtered={list.hasFilters}
          emptyTitle="No remediation actions recorded"
          emptyDescription="An empty plan is not evidence that nothing needs doing. Create the first action to track the work."
          emptyAction={
            writable ? (
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={openCreate}>
                New action
              </Button>
            ) : undefined
          }
          footer={
            mitigations.data ? (
              <Pagination
                page={mitigations.data.page}
                pageSize={mitigations.data.page_size}
                total={mitigations.data.total}
                pages={mitigations.data.pages}
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
                itemLabel="actions"
              />
            ) : null
          }
        />
      </Card>

      <MethodologyPanel
        title="How remediation progress is tracked"
        methodology="An action carries its own status, owner and due date. The risk register's residual score is a separate record and is only written when an analyst assesses the risk again after treatment, so completing an action and reducing a risk are two distinct events."
        limitations="An action marked complete records that the work was done, not that it was effective. Effectiveness is only visible once the risk is reassessed and the residual score moves."
      />

      {writable ? (
        <Dialog
          open={formOpen}
          onClose={closeForm}
          title={editing ? `Edit ${editing.action_ref}` : 'Add a remediation action'}
          description={
            editing
              ? 'Editing the action does not alter the parent risk. Reassessing the risk is a separate step.'
              : 'Pick the risk this action addresses, describe the work, and optionally give it an owner and a due date.'
          }
          size="lg"
          footer={
            <>
              <Button variant="ghost" onClick={closeForm} disabled={createMutation.isPending || updateMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={createMutation.isPending || updateMutation.isPending}
                onClick={submit}
              >
                {editing ? 'Save changes' : 'Add action'}
              </Button>
            </>
          }
        >
          {meta.data ? (
            <MitigationForm
              values={values}
              errors={errors}
              onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
              meta={meta.data}
              risks={risks.data ?? []}
              members={members.data ?? []}
              isCreate={!editing}
            />
          ) : null}
        </Dialog>
      ) : null}

      {writable ? (
        <CSVImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          endpoint="/api/mitigations/import"
          queryKey={['mitigations']}
          invalidateKeys={[['dashboard'], ['ai']]}
          title="Import remediation actions from a CSV file"
          description="Required columns: risk_ref (must match a risk in the register) and description. Optional: action_ref, priority, owner_email, due_date, estimated_cost, currency, status, expected_risk_reduction (0–1), evidence and completion_notes. Rows with a reference that already exists are reported rather than overwritten."
        />
      ) : null}

      <Dialog
        open={Boolean(statusTarget)}
        onClose={() => setStatusTarget(null)}
        title={statusTarget ? `Change status of ${statusTarget.action_ref}` : 'Change status'}
        description="The action's status is recorded on the audit trail."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStatusTarget(null)} disabled={statusMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={statusMutation.isPending}
              disabled={!statusTarget || statusDraft === statusTarget.status}
              onClick={() =>
                statusTarget && statusMutation.mutate({ id: statusTarget.id, status: statusDraft, note: statusNote })
              }
            >
              Save status
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Status" htmlFor="mitigation-status" required>
            <Select
              id="mitigation-status"
              value={statusDraft}
              options={toOptions(meta.data?.statuses)}
              onChange={(event) => setStatusDraft(event.target.value)}
            />
          </Field>
          <Field
            label="Completion note"
            htmlFor="mitigation-status-note"
            hint="Recorded when the action is marked complete. Optional."
          >
            <Textarea
              id="mitigation-status-note"
              value={statusNote}
              onChange={(event) => setStatusNote(event.target.value)}
              placeholder="What was done, and any caveats?"
            />
          </Field>
          <NoticeBanner tone="warning" title="This will not change the risk score">
            The risk's residual score is unchanged by this action. Record explicit post-mitigation
            likelihood and impact on the risk to move it.
          </NoticeBanner>
          {statusMutation.isError ? <NoticeBanner tone="danger">{errorMessage(statusMutation.error)}</NoticeBanner> : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this remediation action?"
        message={
          <>
            <p>
              {deleteTarget?.action_ref} will be removed from the plan. The linked risk is not
              affected, and the deletion is written to the audit trail.
            </p>
            <p className="mt-2">This cannot be undone.</p>
          </>
        }
        confirmLabel="Delete action"
        pending={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function mitigationColumns(handlers: {
  onEdit?: (mitigation: Mitigation) => void;
  onStatus?: (mitigation: Mitigation) => void;
  onDelete?: (mitigation: Mitigation) => void;
}): Array<Column<Mitigation>> {
  const { onEdit, onStatus, onDelete } = handlers;
  const stop = (event: MouseEvent) => event.stopPropagation();

  return [
    {
      key: 'ref',
      header: 'Reference',
      sortKey: 'action_ref',
      cell: (mitigation) => <span className="font-medium text-foreground">{mitigation.action_ref}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      sortKey: 'description',
      cell: (mitigation) => (
        <span className="block max-w-md">
          <span className="block truncate text-xs font-medium text-foreground">{mitigation.description}</span>
          <span className="block truncate text-2xs text-muted">
            {mitigation.risk_ref ? `${mitigation.risk_ref}` : 'No risk linked'}
            {mitigation.risk_title ? ` · ${mitigation.risk_title}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      sortKey: 'priority',
      cell: (mitigation) => <SeverityBadge severity={mitigation.priority} />,
    },
    {
      key: 'owner',
      header: 'Owner',
      hideOnMobile: true,
      cell: (mitigation) => <span className="text-xs">{mitigation.assigned_user_name ?? 'Unassigned'}</span>,
    },
    {
      key: 'due',
      header: 'Due',
      sortKey: 'due_date',
      hideOnMobile: true,
      cell: (mitigation) =>
        mitigation.due_date ? (
          <span className="flex flex-col items-start gap-1">
            <span className="text-xs tabular-nums">{formatDate(mitigation.due_date)}</span>
            {mitigation.is_overdue ? <Badge tone="critical">Overdue</Badge> : null}
          </span>
        ) : (
          <span className="text-xs text-muted">No due date</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (mitigation) => (
        <StatusBadge status={mitigation.status} tone={MITIGATION_TONE[mitigation.status] ?? 'neutral'} />
      ),
    },
    {
      key: 'cost',
      header: 'Estimated cost',
      sortKey: 'estimated_cost',
      align: 'right',
      hideOnMobile: true,
      headerTitle: 'Planned spend for this action, in the currency it was recorded in. Never converted.',
      cell: (mitigation) => (
        <span className="text-xs tabular-nums">{formatMoney(mitigation.estimated_cost, mitigation.currency)}</span>
      ),
    },
    {
      key: 'reduction',
      header: 'Expected reduction',
      align: 'right',
      hideOnMobile: true,
      headerTitle: 'How much the risk score is expected to fall by, per the person who planned the work. Not a measured result.',
      cell: (mitigation) =>
        mitigation.expected_risk_reduction === null || mitigation.expected_risk_reduction === undefined ? (
          <span className="text-xs text-muted">Not estimated</span>
        ) : (
          <span className="text-xs tabular-nums">{formatPercent(mitigation.expected_risk_reduction)}</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (mitigation) => (
        <span className="flex justify-end gap-1" onClick={stop}>
          {onStatus ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Change status of ${mitigation.action_ref}`}
              onClick={() => onStatus(mitigation)}
            >
              Status
            </Button>
          ) : null}
          {onEdit ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Edit ${mitigation.action_ref}`}
              onClick={() => onEdit(mitigation)}
            >
              Edit
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Delete ${mitigation.action_ref}`}
              onClick={() => onDelete(mitigation)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
        </span>
      ),
    },
  ];
}

function ownerName(members: MemberOut[] | undefined, userId: string): string {
  const match = members?.find((member) => String(member.user_id) === userId);
  return match ? match.full_name : `user ${userId}`;
}

// ---------------------------------------------------------------------------
// Shared mitigation form
// ---------------------------------------------------------------------------

export interface MitigationFormValues {
  risk_id: string;
  action_ref: string;
  description: string;
  priority: string;
  assigned_user_id: string;
  due_date: string;
  estimated_cost: string;
  currency: string;
  status: string;
  expected_risk_reduction: string;
  evidence: string;
  completion_notes: string;
}

export const EMPTY_MITIGATION_FORM: MitigationFormValues = {
  risk_id: '',
  action_ref: '',
  description: '',
  priority: 'medium',
  assigned_user_id: '',
  due_date: '',
  estimated_cost: '',
  currency: 'USD',
  status: 'planned',
  expected_risk_reduction: '',
  evidence: '',
  completion_notes: '',
};

export function formFromMitigation(mitigation: Mitigation): MitigationFormValues {
  return {
    risk_id: String(mitigation.risk_id),
    action_ref: mitigation.action_ref,
    description: mitigation.description,
    priority: mitigation.priority,
    assigned_user_id: mitigation.assigned_user_id ? String(mitigation.assigned_user_id) : '',
    due_date: mitigation.due_date ? mitigation.due_date.slice(0, 10) : '',
    estimated_cost:
      mitigation.estimated_cost === null || mitigation.estimated_cost === undefined
        ? ''
        : String(mitigation.estimated_cost),
    currency: mitigation.currency,
    status: mitigation.status,
    expected_risk_reduction:
      mitigation.expected_risk_reduction === null || mitigation.expected_risk_reduction === undefined
        ? ''
        : String(Math.round(mitigation.expected_risk_reduction * 100)),
    evidence: mitigation.evidence ?? '',
    completion_notes: mitigation.completion_notes ?? '',
  };
}

export interface MitigationFormErrors {
  risk_id?: string;
  description?: string;
  estimated_cost?: string;
  expected_risk_reduction?: string;
}

export function validateMitigationForm(
  values: MitigationFormValues,
  mode: 'create' | 'update',
): MitigationFormErrors {
  const errors: MitigationFormErrors = {};
  if (mode === 'create' && !values.risk_id) errors.risk_id = 'Choose the risk this action addresses.';
  if (values.description.trim().length < 3) errors.description = 'Describe the work in at least three characters.';
  if (values.estimated_cost.trim() && !/^\d*\.?\d*$/.test(values.estimated_cost)) {
    errors.estimated_cost = 'Enter a number, or leave the cost blank if it is not estimated.';
  }
  if (values.expected_risk_reduction.trim()) {
    const percent = Number(values.expected_risk_reduction);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      errors.expected_risk_reduction = 'Enter a percentage between 0 and 100.';
    }
  }
  return errors;
}

/**
 * Build the request body. A blank cost stays `null` rather than becoming zero,
 * because "not estimated" and "costs nothing" are different statements.
 */
export function buildMitigationPayload(
  values: MitigationFormValues,
  mode: 'create' | 'update',
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    description: values.description.trim(),
    priority: values.priority,
    assigned_user_id: values.assigned_user_id ? Number(values.assigned_user_id) : null,
    due_date: values.due_date || null,
    estimated_cost: values.estimated_cost.trim() || null,
    currency: values.currency.trim().toUpperCase() || 'USD',
    status: values.status,
    expected_risk_reduction: values.expected_risk_reduction.trim()
      ? Number(values.expected_risk_reduction) / 100
      : null,
    evidence: values.evidence.trim() || null,
    completion_notes: values.completion_notes.trim() || null,
  };
  if (mode === 'create') {
    payload.risk_id = Number(values.risk_id);
    payload.action_ref = values.action_ref.trim() || null;
  }
  return payload;
}

export function MitigationForm({
  values,
  errors,
  onChange,
  meta,
  risks,
  members,
  isCreate,
}: {
  values: MitigationFormValues;
  errors: MitigationFormErrors;
  onChange: (patch: Partial<MitigationFormValues>) => void;
  meta: MitigationMeta;
  risks: RiskOption[];
  members: MemberOut[];
  isCreate: boolean;
}) {
  const messages = Object.values(errors);
  return (
    <div className="space-y-4">
      <FormErrorSummary errors={messages} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Risk"
          required
          htmlFor="mitigation-risk"
          error={errors.risk_id}
          hint={isCreate ? undefined : 'The parent risk cannot be changed after the action is created.'}
        >
          <Select
            id="mitigation-risk"
            value={values.risk_id}
            disabled={!isCreate}
            invalid={Boolean(errors.risk_id)}
            placeholder="Select a risk"
            options={risks.map((risk) => ({ value: String(risk.id), label: `${risk.risk_ref} · ${risk.title}` }))}
            onChange={(event) => onChange({ risk_id: event.target.value })}
          />
        </Field>

        <Field label="Priority" htmlFor="mitigation-priority">
          <Select
            id="mitigation-priority"
            value={values.priority}
            options={toOptions(meta.priorities)}
            onChange={(event) => onChange({ priority: event.target.value })}
          />
        </Field>

        <Field
          label="Description"
          required
          htmlFor="mitigation-description"
          error={errors.description}
          className="sm:col-span-2"
        >
          <Textarea
            id="mitigation-description"
            value={values.description}
            invalid={Boolean(errors.description)}
            placeholder="What work will be carried out to address the risk?"
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </Field>

        <Field label="Owner" htmlFor="mitigation-owner" hint="The assignee is notified when they are not you.">
          <Select
            id="mitigation-owner"
            value={values.assigned_user_id}
            placeholder="Unassigned"
            options={members.map((member) => ({
              value: String(member.user_id),
              label: `${member.full_name} · ${humanise(member.role)}`,
            }))}
            onChange={(event) => onChange({ assigned_user_id: event.target.value })}
          />
        </Field>

        <Field label="Due date" htmlFor="mitigation-due">
          <Input
            id="mitigation-due"
            type="date"
            value={values.due_date}
            onChange={(event) => onChange({ due_date: event.target.value })}
          />
        </Field>

        <Field
          label="Estimated cost"
          htmlFor="mitigation-cost"
          error={errors.estimated_cost}
          hint="Leave blank if the cost has not been estimated."
        >
          <Input
            id="mitigation-cost"
            inputMode="decimal"
            value={values.estimated_cost}
            invalid={Boolean(errors.estimated_cost)}
            placeholder="Not estimated"
            onChange={(event) => {
              const next = event.target.value;
              if (next === '' || /^\d*\.?\d*$/.test(next)) onChange({ estimated_cost: next });
            }}
          />
        </Field>

        <Field label="Currency" htmlFor="mitigation-currency" hint="ISO 4217, three letters. Amounts are never converted.">
          <Input
            id="mitigation-currency"
            value={values.currency}
            maxLength={3}
            className="uppercase"
            onChange={(event) => onChange({ currency: event.target.value.toUpperCase() })}
          />
        </Field>

        <Field label="Status" htmlFor="mitigation-form-status">
          <Select
            id="mitigation-form-status"
            value={values.status}
            options={toOptions(meta.statuses)}
            onChange={(event) => onChange({ status: event.target.value })}
          />
        </Field>

        <Field
          label="Expected risk reduction"
          htmlFor="mitigation-reduction"
          error={errors.expected_risk_reduction}
          aside="0–100%"
          hint="The planner's expectation, not a measured result."
        >
          <Input
            id="mitigation-reduction"
            inputMode="numeric"
            value={values.expected_risk_reduction}
            invalid={Boolean(errors.expected_risk_reduction)}
            placeholder="Not estimated"
            onChange={(event) => {
              const next = event.target.value;
              if (next === '' || /^\d*$/.test(next)) onChange({ expected_risk_reduction: next });
            }}
          />
        </Field>

        <Field label="Evidence" htmlFor="mitigation-evidence" className="sm:col-span-2" hint="Links or references showing the work is planned or done.">
          <Textarea
            id="mitigation-evidence"
            value={values.evidence}
            onChange={(event) => onChange({ evidence: event.target.value })}
          />
        </Field>

        <Field label="Completion notes" htmlFor="mitigation-completion" className="sm:col-span-2">
          <Textarea
            id="mitigation-completion"
            value={values.completion_notes}
            onChange={(event) => onChange({ completion_notes: event.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}
