import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { EM_DASH, formatDate, humanise, toOptions } from '@/lib/format';
import { sortStateOf, useListState } from '@/hooks/useListState';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type {
  Message,
  Page,
  QuestionnaireTemplate,
  TemplateKind,
  VendorAssessment,
} from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge, RiskScore, StatusBadge } from '@/components/ui/Badge';
import type { BadgeTone } from '@/components/ui/Badge';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { ActiveFilters, FilterBar, FilterSelect, SearchInput } from '@/components/ui/Filters';
import { NoticeBanner, Spinner } from '@/components/ui/Feedback';
import { Field, FormErrorSummary, Input, Select } from '@/components/ui/Form';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { MethodologyPanel } from '@/components/ui/Methodology';

/**
 * Third-party (TILT) vendor assessments.
 *
 * This screen preserves the original TILT workflow: a vendor is described, a
 * questionnaire is answered, and the legacy scoring engine produces a maturity
 * score, a vulnerability percentage and a verdict. The verdict is the legacy
 * engine's own label and is not a recommendation — the numbers behind it are
 * shown beside it so a reader can disagree with it.
 *
 * Two vocabulary notes, because the screen has to be honest about what the
 * server actually stores:
 *
 * * `status` is free text on the server (a 30-character string, default
 *   "Pending"). The list below is the vocabulary the TILT module used, offered
 *   as a convenience; a record carrying any other value keeps that value.
 * * `data_classification` is a 1–5 tier that also drives the impact axis, so
 *   the tier is shown next to the score it produced.
 */

/** The status vocabulary the preserved TILT module used. The server stores free text. */
export const VENDOR_STATUSES: readonly string[] = ['Pending', 'New', 'Potential', 'Active'];

export const ASSESSMENT_TYPES: readonly TemplateKind[] = ['standard', 'cloud'];

/** 1–5 tier that sets the impact axis. Labels preserved from the legacy UI. */
export const DATA_CLASSIFICATION_OPTIONS = [
  { value: '1', label: 'Tier 1 · Public' },
  { value: '2', label: 'Tier 2 · Internal' },
  { value: '3', label: 'Tier 3 · Confidential' },
  { value: '4', label: 'Tier 4 · Restricted' },
  { value: '5', label: 'Tier 5 · Highly restricted' },
];

/** Maturity scale labels, preserved from the legacy TILT UI. */
const MATURITY_LABELS: Record<number, string> = {
  0: 'Not implemented',
  1: 'Initial',
  2: 'Developing',
  3: 'Defined',
  4: 'Managed',
  5: 'Optimized',
};

/** Maturity scale for the standard questionnaire (answers 1–5). */
export const STANDARD_MATURITY_OPTIONS = [1, 2, 3, 4, 5].map((value) => ({
  value: String(value),
  label: `${value} · ${MATURITY_LABELS[value]}`,
}));

/** Maturity scale for the cloud scorecard (answers 0–5; 0 is "not implemented"). */
export const CLOUD_MATURITY_OPTIONS = [0, 1, 2, 3, 4, 5].map((value) => ({
  value: String(value),
  label: `${value} · ${MATURITY_LABELS[value]}`,
}));

export function classificationLabel(value?: number | null): string {
  if (value === null || value === undefined) return EM_DASH;
  return DATA_CLASSIFICATION_OPTIONS.find((option) => option.value === String(value))?.label ?? `Tier ${value}`;
}

const TYPE_TONE: Record<string, BadgeTone> = {
  standard: 'neutral',
  cloud: 'primary',
};

export function VendorAssessmentsPage() {
  const navigate = useNavigate();
  const { can, hasRole } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<VendorAssessment | null>(null);
  const [values, setValues] = useState<VendorFormValues>(EMPTY_VENDOR_FORM);
  const [errors, setErrors] = useState<VendorFormErrors>({});
  const [deleteTarget, setDeleteTarget] = useState<VendorAssessment | null>(null);

  const list = useListState({
    filterKeys: ['status', 'assessment_type'] as const,
    defaultSort: 'updated_at',
    defaultOrder: 'desc',
  });

  const vendors = useQuery({
    queryKey: queryKeys.vendors(list.query),
    queryFn: () => api.get<Page<VendorAssessment>>('/api/tilt/vendors', { query: list.query }),
  });

  const writable = can('risk:write');

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setValues(EMPTY_VENDOR_FORM);
    setErrors({});
  };

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<VendorAssessment>('/api/tilt/vendors', payload),
    onSuccess: async (vendor) => {
      closeForm();
      push({
        tone: 'success',
        title: 'Vendor assessment created',
        description: `${vendor.vendor_name} was added. Answer the questionnaire and run the assessment to score it.`,
      });
      await queryClient.invalidateQueries({ queryKey: ['vendors'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.patch<VendorAssessment>(`/api/tilt/vendors/${editing?.id}`, payload),
    onSuccess: async (vendor) => {
      closeForm();
      push({
        tone: 'success',
        title: 'Vendor assessment updated',
        description: `${vendor.vendor_name} was saved.`,
      });
      await queryClient.invalidateQueries({ queryKey: ['vendors'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete<Message>(`/api/tilt/vendors/${id}`),
    onSuccess: async (result) => {
      setDeleteTarget(null);
      push({ tone: 'success', title: 'Vendor assessment deleted', description: result.message });
      await queryClient.invalidateQueries({ queryKey: ['vendors'] });
    },
  });

  const openCreate = () => {
    setValues(EMPTY_VENDOR_FORM);
    setErrors({});
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (vendor: VendorAssessment) => {
    setValues(formFromVendor(vendor));
    setErrors({});
    setEditing(vendor);
    setFormOpen(true);
  };

  const submit = () => {
    const validation = validateVendorForm(values);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    const payload = buildVendorPayload(values);
    if (editing) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  const serverError = createMutation.error ?? updateMutation.error;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vendor Assessments"
        description="Third-party risk questionnaires, scored with the preserved TILT engine. A verdict of “Standard Approval” is the engine's label, not a procurement decision."
        meta={
          vendors.data ? (
            <span className="text-2xs text-muted">
              {vendors.data.total} vendor{vendors.data.total === 1 ? '' : 's'} in scope
            </span>
          ) : null
        }
        actions={
          writable ? (
            <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={openCreate}>
              New assessment
            </Button>
          ) : null
        }
      />

      <NoticeBanner tone="info" title="How a vendor gets a score">
        Recording a vendor captures its details and questionnaire answers. The score, verdict and
        vulnerability percentage only change when the assessment is run on the vendor's own page.
        Until then the fields read “Not assessed”.
      </NoticeBanner>

      <Card>
        <FilterBar>
          <SearchInput
            value={list.state.search}
            onChange={list.setSearch}
            placeholder="Search vendor or domain…"
            label="Search vendor assessments"
          />
          <FilterSelect
            label="Status"
            value={list.state.filters.status ?? ''}
            onChange={(value) => list.setFilter('status', value)}
            options={toOptions(VENDOR_STATUSES)}
          />
          <FilterSelect
            label="Assessment type"
            value={list.state.filters.assessment_type ?? ''}
            onChange={(value) => list.setFilter('assessment_type', value)}
            options={toOptions(ASSESSMENT_TYPES)}
          />
        </FilterBar>

        <div className="px-4 py-3">
          <ActiveFilters
            filters={[
              list.state.filters.status
                ? {
                    key: 'status',
                    label: `Status: ${humanise(list.state.filters.status)}`,
                    onClear: () => list.setFilter('status', ''),
                  }
                : null,
              list.state.filters.assessment_type
                ? {
                    key: 'assessment_type',
                    label: `Type: ${humanise(list.state.filters.assessment_type)}`,
                    onClear: () => list.setFilter('assessment_type', ''),
                  }
                : null,
              list.state.search
                ? { key: 'q', label: `Search: “${list.state.search}”`, onClear: () => list.setSearch('') }
                : null,
            ]}
            onClearAll={() => list.clearFilters()}
          />
        </div>

        <DataTable<VendorAssessment>
          caption="Vendor assessments"
          columns={vendorColumns({
            onEdit: writable ? openEdit : undefined,
            onDelete: hasRole('risk_manager') ? setDeleteTarget : undefined,
            onOpen: (vendor) => navigate(`/vendor-assessments/${vendor.id}`),
          })}
          rows={vendors.data?.items ?? []}
          rowKey={(vendor) => vendor.id}
          loading={vendors.isPending}
          error={vendors.isError ? vendors.error : undefined}
          onRetry={() => void vendors.refetch()}
          sort={sortStateOf(list.state)}
          onSortChange={({ sort, order }) => list.setSort(sort, order)}
          onRowClick={(vendor) => navigate(`/vendor-assessments/${vendor.id}`)}
          filtered={list.hasFilters}
          emptyTitle="No vendor assessments recorded"
          emptyDescription="An empty register is not evidence that no third party poses a risk. Record a vendor to begin assessing it."
          emptyAction={
            writable ? (
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={openCreate}>
                New assessment
              </Button>
            ) : undefined
          }
          footer={
            vendors.data ? (
              <Pagination
                page={vendors.data.page}
                pageSize={vendors.data.page_size}
                total={vendors.data.total}
                pages={vendors.data.pages}
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
                itemLabel="vendors"
              />
            ) : null
          }
        />
      </Card>

      <MethodologyPanel
        title="How the TILT score is calculated"
        methodology="The standard questionnaire inverts each maturity answer (1 → 1.0, 5 → 0.2), weights it by importance (Critical 3×, High 2×, otherwise 1×) and averages it to a vulnerability percentage; the maturity score is 100 minus that. The cloud scorecard sums (maturity ÷ 5) × points over its criteria out of a fixed 55, and a Critical criterion scored zero forces a REJECT verdict. Impact and likelihood are derived from the same cut-offs (15 / 30 / 45 of 55)."
        limitations="The engine grades the answers it is given and cannot verify them. A high score means the questionnaire was answered well, not that the vendor has been tested. No answer at all scores 100% vulnerability on the standard questionnaire, so an unscored vendor is not a low-risk one."
      />

      {writable ? (
        <Dialog
          open={formOpen}
          onClose={closeForm}
          title={editing ? `Edit ${editing.vendor_name}` : 'New vendor assessment'}
          description={
            editing
              ? 'Editing the details does not re-score the vendor. Run the assessment on the vendor’s page to recalculate.'
              : 'Describe the vendor, choose its questionnaire and record its answers. Scoring happens when the assessment is run.'
          }
          size="xl"
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
                {editing ? 'Save changes' : 'Create assessment'}
              </Button>
            </>
          }
        >
          <VendorForm
            values={values}
            errors={errors}
            onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
            serverError={serverError}
          />
        </Dialog>
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this vendor assessment?"
        message={
          <>
            <p>
              {deleteTarget?.vendor_name} and its questionnaire answers, scoring and OSINT findings
              will be removed. The deletion is written to the audit trail.
            </p>
            <p className="mt-2">This cannot be undone.</p>
          </>
        }
        confirmLabel="Delete assessment"
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

function vendorColumns(handlers: {
  onEdit?: (vendor: VendorAssessment) => void;
  onDelete?: (vendor: VendorAssessment) => void;
  onOpen?: (vendor: VendorAssessment) => void;
}): Array<Column<VendorAssessment>> {
  const { onEdit, onDelete, onOpen } = handlers;
  const stop = (event: MouseEvent) => event.stopPropagation();

  return [
    {
      key: 'vendor',
      header: 'Vendor',
      sortKey: 'vendor_name',
      cell: (vendor) => (
        <span className="block max-w-md">
          <span className="block truncate text-xs font-medium text-foreground">{vendor.vendor_name}</span>
          <span className="block truncate text-2xs text-muted">
            {vendor.primary_domain ?? 'No domain recorded'}
            {vendor.is_demo ? ' · Demonstration data' : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortKey: 'assessment_type',
      cell: (vendor) => (
        <Badge tone={TYPE_TONE[vendor.assessment_type] ?? 'neutral'}>
          {humanise(vendor.assessment_type)}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (vendor) => <StatusBadge status={vendor.status} />,
    },
    {
      key: 'verdict',
      header: 'Verdict',
      hideOnMobile: true,
      headerTitle: 'The legacy scoring engine’s own label for this vendor. Not a procurement decision.',
      cell: (vendor) =>
        vendor.verdict ? (
          <span className="text-xs">{vendor.verdict}</span>
        ) : (
          <span className="text-xs text-muted">Not assessed</span>
        ),
    },
    {
      key: 'inherent',
      header: 'Inherent risk',
      hideOnMobile: true,
      headerTitle: 'Likelihood × impact, as stored by the server. Not recomputed in the browser.',
      cell: (vendor) => <RiskScore score={vendor.inherent_score} severity={vendor.severity} size="sm" />,
    },
    {
      key: 'classification',
      header: 'Classification',
      hideOnMobile: true,
      headerTitle: 'The 1–5 data tier the vendor handles, which also sets the impact axis.',
      cell: (vendor) =>
        vendor.data_classification === null || vendor.data_classification === undefined ? (
          <span className="text-xs text-muted">Not recorded</span>
        ) : (
          <span className="text-xs" title={classificationLabel(vendor.data_classification)}>
            Tier {vendor.data_classification}
          </span>
        ),
    },
    {
      key: 'scanned',
      header: 'OSINT',
      sortKey: 'last_scanned_at',
      hideOnMobile: true,
      cell: (vendor) =>
        vendor.last_scanned_at ? (
          <span className="flex flex-col items-start gap-1">
            <span className="text-xs tabular-nums">{formatDate(vendor.last_scanned_at)}</span>
            {!vendor.osint_acknowledged && (vendor.osint_warnings?.length ?? 0) > 0 ? (
              <Badge tone="high">Unacknowledged</Badge>
            ) : null}
          </span>
        ) : (
          <span className="text-xs text-muted">Never scanned</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (vendor) => (
        <span className="flex justify-end gap-1" onClick={stop}>
          {onOpen ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Open ${vendor.vendor_name}`}
              onClick={() => onOpen(vendor)}
            >
              Open
            </Button>
          ) : null}
          {onEdit ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Edit ${vendor.vendor_name}`}
              onClick={() => onEdit(vendor)}
            >
              Edit
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Delete ${vendor.vendor_name}`}
              onClick={() => onDelete(vendor)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
        </span>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Shared vendor form
// ---------------------------------------------------------------------------

export interface VendorFormValues {
  vendor_name: string;
  primary_domain: string;
  status: string;
  assessment_type: TemplateKind;
  data_classification: string;
  /** Standard questionnaire answers, keyed by template item id, values 1–5. */
  answers: Record<string, string>;
  /** Cloud scorecard answers, keyed by template item id, values 0–5. */
  cloud_scores: Record<string, string>;
}

export const EMPTY_VENDOR_FORM: VendorFormValues = {
  vendor_name: '',
  primary_domain: '',
  status: 'Pending',
  assessment_type: 'standard',
  data_classification: '3',
  answers: {},
  cloud_scores: {},
};

export function formFromVendor(vendor: VendorAssessment): VendorFormValues {
  const type: TemplateKind = vendor.assessment_type === 'cloud' ? 'cloud' : 'standard';
  return {
    vendor_name: vendor.vendor_name,
    primary_domain: vendor.primary_domain ?? '',
    status: vendor.status,
    assessment_type: type,
    data_classification:
      vendor.data_classification === null || vendor.data_classification === undefined
        ? ''
        : String(vendor.data_classification),
    answers: toStringMap(vendor.answers),
    cloud_scores: toStringMap(vendor.cloud_scores),
  };
}

export interface VendorFormErrors {
  vendor_name?: string;
  status?: string;
  primary_domain?: string;
}

export function validateVendorForm(values: VendorFormValues): VendorFormErrors {
  const errors: VendorFormErrors = {};
  if (values.vendor_name.trim().length < 2) {
    errors.vendor_name = 'Enter the vendor’s name (at least two characters).';
  }
  if (!values.status.trim()) {
    errors.status = 'Give the vendor a status, for example “Pending”.';
  } else if (values.status.trim().length > 30) {
    errors.status = 'The status must be 30 characters or fewer.';
  }
  const domain = values.primary_domain.trim();
  if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) {
    errors.primary_domain = 'Enter a bare domain such as example.com, with no scheme or path.';
  }
  return errors;
}

/**
 * Build the request body.
 *
 * Only the answer map that matches the chosen questionnaire is sent, so a
 * cloud scorecard never leaves stale standard answers behind (and the reverse).
 * A blank domain stays `null`; it is not the empty string.
 */
export function buildVendorPayload(values: VendorFormValues): Record<string, unknown> {
  const isCloud = values.assessment_type === 'cloud';
  return {
    vendor_name: values.vendor_name.trim(),
    primary_domain: values.primary_domain.trim() || null,
    status: values.status.trim(),
    assessment_type: values.assessment_type,
    data_classification: values.data_classification ? Number(values.data_classification) : null,
    answers: isCloud ? null : toNumberMap(values.answers),
    cloud_scores: isCloud ? toNumberMap(values.cloud_scores) : null,
  };
}

export function VendorForm({
  values,
  errors,
  onChange,
  serverError,
}: {
  values: VendorFormValues;
  errors: VendorFormErrors;
  onChange: (patch: Partial<VendorFormValues>) => void;
  serverError?: unknown;
}) {
  return (
    <div className="space-y-5">
      <FormErrorSummary errors={Object.values(errors)} />

      {serverError ? (
        <NoticeBanner tone="danger" title="The server rejected this assessment">
          {serverMessage(serverError)}
        </NoticeBanner>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vendor name" required htmlFor="vendor-name" error={errors.vendor_name}>
          <Input
            id="vendor-name"
            value={values.vendor_name}
            invalid={Boolean(errors.vendor_name)}
            placeholder="e.g. Northwind Analytics"
            onChange={(event) => onChange({ vendor_name: event.target.value })}
          />
        </Field>

        <Field
          label="Primary domain"
          htmlFor="vendor-domain"
          error={errors.primary_domain}
          hint="The bare domain, used for the certificate and DMARC checks."
        >
          <Input
            id="vendor-domain"
            value={values.primary_domain}
            invalid={Boolean(errors.primary_domain)}
            placeholder="example.com"
            onChange={(event) => onChange({ primary_domain: event.target.value })}
          />
        </Field>

        <Field label="Status" htmlFor="vendor-status" error={errors.status} hint="Free text; the server stores up to 30 characters.">
          <Select
            id="vendor-status"
            value={values.status}
            invalid={Boolean(errors.status)}
            options={statusOptions(values.status)}
            onChange={(event) => onChange({ status: event.target.value })}
          />
        </Field>

        <Field
          label="Assessment type"
          htmlFor="vendor-type"
          hint="Changing the type switches which questionnaire is scored; answers for the other type are cleared on save."
        >
          <Select
            id="vendor-type"
            value={values.assessment_type}
            options={toOptions(ASSESSMENT_TYPES)}
            onChange={(event) => onChange({ assessment_type: event.target.value as TemplateKind })}
          />
        </Field>

        <Field
          label="Data classification"
          htmlFor="vendor-classification"
          className="sm:col-span-2"
          hint="The tier of data the vendor handles. This also sets the impact axis, so it is not a cosmetic label."
        >
          <Select
            id="vendor-classification"
            value={values.data_classification}
            placeholder="Not recorded"
            options={DATA_CLASSIFICATION_OPTIONS}
            onChange={(event) => onChange({ data_classification: event.target.value })}
          />
        </Field>
      </div>

      <QuestionnaireEditor values={values} onChange={onChange} />

      <NoticeBanner tone="info" title="Saving does not score">
        The maturity score, vulnerability percentage and verdict are produced by the scoring engine
        when the assessment is run. Save first, then run the assessment from the vendor’s page.
      </NoticeBanner>
    </div>
  );
}

/**
 * Questionnaire item list.
 *
 * The template determines which items exist, so the editor loads the templates
 * for the selected kind. A 404 from that endpoint means "no templates are
 * defined for this kind", which is a description of the server's state rather
 * than a failure, so it is rendered as a notice.
 */
function QuestionnaireEditor({
  values,
  onChange,
}: {
  values: VendorFormValues;
  onChange: (patch: Partial<VendorFormValues>) => void;
}) {
  const isCloud = values.assessment_type === 'cloud';
  const kind = values.assessment_type;

  const templates = useQuery({
    queryKey: queryKeys.templates(kind),
    queryFn: () => api.get<QuestionnaireTemplate[]>(`/api/tilt/templates/${kind}`),
    staleTime: 30 * 60_000,
  });

  const answers = isCloud ? values.cloud_scores : values.answers;
  const options = isCloud ? CLOUD_MATURITY_OPTIONS : STANDARD_MATURITY_OPTIONS;

  const setAnswer = (itemId: number, value: string) => {
    const key = String(itemId);
    const next = { ...answers };
    if (value === '') delete next[key];
    else next[key] = value;
    onChange(isCloud ? { cloud_scores: next } : { answers: next });
  };

  if (templates.isPending) {
    return (
      <div className="rounded border border-border px-3 py-6">
        <Spinner label={`Loading the ${kind} questionnaire…`} />
      </div>
    );
  }

  if (templates.isError) {
    if (templates.error instanceof ApiError && templates.error.isNotFound) {
      return (
        <NoticeBanner tone="warning" title={`No ${kind} questionnaire is defined`}>
          The server has no {kind} questionnaire templates, so no items can be answered. The vendor
          can still be saved; ask an administrator to define the questionnaire before scoring it.
        </NoticeBanner>
      );
    }
    return (
      <NoticeBanner tone="danger" title="The questionnaire could not be loaded">
        {serverMessage(templates.error)}
      </NoticeBanner>
    );
  }

  const items = templates.data ?? [];
  const answered = items.filter((item) => answers[String(item.id)] !== undefined).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {humanise(kind)} questionnaire
        </h3>
        <span className="text-2xs text-muted">
          {answered} of {items.length} answered — unanswered items are treated as unscored
        </span>
      </div>

      <div className="max-h-[22rem] space-y-2 overflow-y-auto rounded border border-border p-3">
        {items.map((item) => (
          <div key={item.id} className="grid gap-2 sm:grid-cols-[1fr_11rem] sm:items-start">
            <div className="min-w-0">
              <p className="text-xs text-foreground">
                <span className="tabular-nums text-muted">{item.position}. </span>
                {item.text}
              </p>
              <p className="mt-0.5 flex flex-wrap gap-2 text-2xs text-muted">
                {item.category ? <span>{item.category}</span> : null}
                {item.criticality ? <span>Criticality: {item.criticality}</span> : null}
                {item.weight ? <span>Weight: {item.weight}</span> : null}
                {isCloud && item.points !== null && item.points !== undefined ? (
                  <span>Points: {item.points}</span>
                ) : null}
              </p>
            </div>
            <Select
              aria-label={`Answer for item ${item.position}`}
              value={answers[String(item.id)] ?? ''}
              placeholder="Unscored"
              options={options}
              onChange={(event) => setAnswer(item.id, event.target.value)}
            />
          </div>
        ))}
      </div>

      {isCloud ? (
        <p className="text-2xs text-muted">
          On the cloud scorecard an unanswered Critical item counts as maturity 0 and forces a
          REJECT verdict, so “Unscored” is not neutral here.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusOptions(current: string): Array<{ value: string; label: string }> {
  const base = VENDOR_STATUSES.map((status) => ({ value: status, label: status }));
  if (current && !VENDOR_STATUSES.includes(current)) {
    return [...base, { value: current, label: `${current} (current)` }];
  }
  return base;
}

/** Coerce a stored answer map (`{ "12": 4 }`) into form strings, tolerating number keys. */
function toStringMap(raw: Record<string, unknown> | null | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) return result;
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined || value === '') continue;
    result[key] = String(value);
  }
  return result;
}

function toNumberMap(values: Record<string, string>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) result[key] = numeric;
  }
  return result;
}

/** Read an answer for an item, tolerating the server's int/str JSON key coercion. */
export function readAnswer(
  mapping: Record<string, unknown> | null | undefined,
  itemId: number,
): unknown {
  if (!mapping) return undefined;
  if (String(itemId) in mapping) return mapping[String(itemId)];
  return (mapping as Record<string | number, unknown>)[itemId];
}

export function maturityLabel(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return EM_DASH;
  return MATURITY_LABELS[numeric] ?? `Level ${numeric}`;
}

export function serverMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}
