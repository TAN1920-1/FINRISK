import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Upload } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDate, humanise, toOptions } from '@/lib/format';
import { sortStateOf, useListState } from '@/hooks/useListState';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type { Asset, AssetType, Environment, MemberOut, Page } from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge, SeverityBadge } from '@/components/ui/Badge';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { ActiveFilters, FilterBar, FilterSelect, SearchInput } from '@/components/ui/Filters';
import { NoticeBanner } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { CSVImportDialog } from '@/components/ui/CSVImportDialog';
import { MethodologyPanel } from '@/components/ui/Methodology';

/**
 * Asset registry.
 *
 * The inventory is the anchor every other record hangs off: risks, findings and
 * scenarios all point back at an asset. The rollup counts on each row (open
 * risks, open findings, worst severity) are recomputed by the API from the
 * linked records, so a row can never claim a posture the linked data does not
 * support. Nothing on this screen is derived in the browser.
 */

const SCALE_OPTIONS = [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) }));

/** Asset types come from the backend enum; there is no meta endpoint for assets. */
export const ASSET_TYPES: readonly AssetType[] = [
  'application',
  'database',
  'network',
  'endpoint',
  'cloud_service',
  'third_party_service',
  'business_process',
  'facility',
  'identity',
  'data_store',
];

export const ENVIRONMENTS: readonly Environment[] = [
  'production',
  'staging',
  'development',
  'disaster_recovery',
  'corporate',
];

export function AssetRegistryPage() {
  const { can } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [values, setValues] = useState<AssetFormValues>(EMPTY_ASSET_FORM);
  const [errors, setErrors] = useState<AssetFormErrors>({});

  const list = useListState({
    filterKeys: [
      'asset_type',
      'environment',
      'business_unit',
      'criticality',
      'internet_exposed',
      'active_only',
    ] as const,
    defaultSort: 'name',
    defaultOrder: 'asc',
  });

  const assets = useQuery({
    queryKey: queryKeys.assets(list.query),
    queryFn: () => api.get<Page<Asset>>('/api/assets', { query: list.query }),
  });

  const members = useQuery({
    queryKey: queryKeys.members,
    queryFn: () => api.get<MemberOut[]>('/api/auth/members'),
    enabled: can('asset:write'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<Asset>('/api/assets', payload),
    onSuccess: async (asset) => {
      setFormOpen(false);
      setValues(EMPTY_ASSET_FORM);
      push({
        tone: 'success',
        title: 'Asset registered',
        description: `${asset.asset_ref} · ${asset.name} was added to the inventory.`,
      });
      await queryClient.invalidateQueries({ queryKey: ['assets'] });
      navigate(`/assets/${asset.id}`);
    },
  });

  const openCreate = () => {
    setValues(EMPTY_ASSET_FORM);
    setErrors({});
    setFormOpen(true);
  };

  const submit = () => {
    const validation = validateAssetForm(values);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    createMutation.mutate(buildAssetPayload(values, 'create'));
  };

  const showRetired = list.state.filters.active_only === 'false';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Asset Registry"
        description="Applications, data stores, services and facilities the organization depends on. Risk and finding counts are rolled up from the linked records by the API."
        meta={
          assets.data ? (
            <span className="text-2xs text-muted">
              {assets.data.total} asset{assets.data.total === 1 ? '' : 's'} in scope
            </span>
          ) : null
        }
        actions={
          can('asset:write') ? (
            <>
              <Button
                variant="outline"
                icon={<Upload className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => setImportOpen(true)}
              >
                Import CSV
              </Button>
              <Button
                variant="primary"
                icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
                onClick={openCreate}
              >
                New asset
              </Button>
            </>
          ) : undefined
        }
      />

      <NoticeBanner tone="info" title="Criticality and data sensitivity are analyst ratings">
        Both use a 1–5 scale. They feed the context-aware vulnerability priority score, so an asset
        rated critical raises the priority of every finding recorded against it.
      </NoticeBanner>

      <Card>
        <FilterBar>
          <SearchInput
            value={list.state.search}
            onChange={list.setSearch}
            placeholder="Search name or reference…"
            label="Search assets"
          />
          <FilterSelect
            label="Type"
            value={list.state.filters.asset_type ?? ''}
            onChange={(value) => list.setFilter('asset_type', value)}
            options={toOptions(ASSET_TYPES)}
          />
          <FilterSelect
            label="Environment"
            value={list.state.filters.environment ?? ''}
            onChange={(value) => list.setFilter('environment', value)}
            options={toOptions(ENVIRONMENTS)}
          />
          <FilterSelect
            label="Criticality"
            value={list.state.filters.criticality ?? ''}
            onChange={(value) => list.setFilter('criticality', value)}
            options={SCALE_OPTIONS}
          />
          <div className="flex flex-col gap-1.5 pb-1">
            <Checkbox
              label="Internet exposed"
              checked={list.state.filters.internet_exposed === 'true'}
              onChange={(event) =>
                list.setFilter('internet_exposed', event.target.checked ? 'true' : '')
              }
            />
            <Checkbox
              label="Include retired"
              checked={showRetired}
              onChange={(event) => list.setFilter('active_only', event.target.checked ? 'false' : '')}
            />
          </div>
        </FilterBar>

        <div className="px-4 py-3">
          <ActiveFilters
            filters={[
              list.state.filters.asset_type
                ? {
                    key: 'asset_type',
                    label: `Type: ${humanise(list.state.filters.asset_type)}`,
                    onClear: () => list.setFilter('asset_type', ''),
                  }
                : null,
              list.state.filters.environment
                ? {
                    key: 'environment',
                    label: `Environment: ${humanise(list.state.filters.environment)}`,
                    onClear: () => list.setFilter('environment', ''),
                  }
                : null,
              list.state.filters.criticality
                ? {
                    key: 'criticality',
                    label: `Criticality: ${list.state.filters.criticality}`,
                    onClear: () => list.setFilter('criticality', ''),
                  }
                : null,
              list.state.filters.internet_exposed === 'true'
                ? {
                    key: 'internet_exposed',
                    label: 'Internet exposed only',
                    onClear: () => list.setFilter('internet_exposed', ''),
                  }
                : null,
              showRetired
                ? {
                    key: 'active_only',
                    label: 'Including retired assets',
                    onClear: () => list.setFilter('active_only', ''),
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

        <DataTable<Asset>
          caption="Asset inventory"
          columns={assetColumns(navigate, showRetired)}
          rows={assets.data?.items ?? []}
          rowKey={(asset) => asset.id}
          loading={assets.isPending}
          error={assets.isError ? assets.error : undefined}
          onRetry={() => void assets.refetch()}
          sort={sortStateOf(list.state)}
          onSortChange={({ sort, order }) => list.setSort(sort, order)}
          onRowClick={(asset) => navigate(`/assets/${asset.id}`)}
          filtered={list.hasFilters}
          emptyTitle="No assets registered yet"
          emptyDescription="An empty inventory is not the same as having no assets. Register the systems the organization depends on."
          emptyAction={
            can('asset:write') ? (
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={openCreate}>
                New asset
              </Button>
            ) : undefined
          }
          footer={
            assets.data ? (
              <Pagination
                page={assets.data.page}
                pageSize={assets.data.page_size}
                total={assets.data.total}
                pages={assets.data.pages}
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
                itemLabel="assets"
              />
            ) : null
          }
        />
      </Card>

      <MethodologyPanel
        title="How the inventory rollups work"
        methodology="Criticality and data sensitivity are analyst ratings on a 1–5 scale, where 5 is the most critical or the most sensitive. The open-risk count, the open-finding count and the worst severity are not stored on the asset: the API recomputes them from the linked records every time the list is read, so retiring or resolving a linked record is reflected immediately."
        formula={
          'criticality          analyst rating 1–5 (5 = most critical)\n' +
          'data_sensitivity     analyst rating 1–5 (5 = most sensitive)\n' +
          'open_risks           count of linked risks with an open status\n' +
          'open_findings        count of linked findings still open or in progress\n' +
          'severity             worst linked open risk (likelihood × impact)'
        }
        limitations="A rollup is only as complete as the links. A risk that was never attached to an asset cannot raise that asset's severity, and the counts say nothing about the magnitude of the underlying exposure."
      />

      {can('asset:write') ? (
        <Dialog
          open={formOpen}
          onClose={() => setFormOpen(false)}
          title="Register an asset"
          description="Only the name, type and the two ratings are required. Everything else can be filled in later."
          size="lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={createMutation.isPending}>
                Cancel
              </Button>
              <Button variant="primary" loading={createMutation.isPending} onClick={submit}>
                Add asset
              </Button>
            </>
          }
        >
          <AssetForm
            values={values}
            errors={errors}
            onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
            members={members.data ?? []}
            showReference
          />
          {createMutation.isError ? (
            <NoticeBanner tone="danger" title="The asset could not be saved" className="mt-3">
              {assetErrorMessage(createMutation.error)}
            </NoticeBanner>
          ) : null}
        </Dialog>
      ) : null}

      {can('asset:write') ? (
        <CSVImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          endpoint="/api/assets/import"
          queryKey={['assets']}
          invalidateKeys={[['dashboard'], ['ai']]}
          title="Import assets from a CSV file"
          description="Required columns: name and asset_type. Optional: asset_ref, description, environment, business_unit, owner_email, criticality (1–5), data_sensitivity (1–5), internet_exposed, financial_importance (blank means not valued), currency, dependencies, existing_controls and last_assessed_at (ISO-8601; blank defaults to the import time). Rows with a reference that already exists are reported rather than overwritten."
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function assetColumns(
  navigate: (to: string) => void,
  showRetired: boolean,
): Array<Column<Asset>> {
  const columns: Array<Column<Asset>> = [
    {
      key: 'ref',
      header: 'Asset',
      sortKey: 'name',
      cell: (asset) => (
        <span className="block max-w-md">
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              className="rounded text-xs font-medium text-primary hover:underline"
              onClick={(event) => {
                event.stopPropagation();
                navigate(`/assets/${asset.id}`);
              }}
            >
              {asset.asset_ref}
            </button>
            {!asset.is_active ? <Badge tone="unknown">Retired</Badge> : null}
          </span>
          <span className="mt-0.5 block truncate text-2xs text-muted">
            {asset.name}
            {asset.business_unit ? ` · ${asset.business_unit}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortKey: 'asset_type',
      hideOnMobile: true,
      cell: (asset) => (
        <span className="block text-xs">
          {humanise(asset.asset_type)}
          <span className="mt-0.5 block text-2xs text-muted">{humanise(asset.environment)}</span>
        </span>
      ),
    },
    {
      key: 'criticality',
      header: 'Criticality',
      sortKey: 'criticality',
      align: 'right',
      headerTitle: 'Analyst rating on a 1–5 scale, where 5 is the most critical.',
      cell: (asset) => <span className="text-xs tabular-nums">{asset.criticality}/5</span>,
    },
    {
      key: 'sensitivity',
      header: 'Data',
      sortKey: 'data_sensitivity',
      align: 'right',
      hideOnMobile: true,
      headerTitle: 'Data sensitivity rating on a 1–5 scale.',
      cell: (asset) => <span className="text-xs tabular-nums">{asset.data_sensitivity}/5</span>,
    },
    {
      key: 'exposure',
      header: 'Exposure',
      hideOnMobile: true,
      cell: (asset) =>
        asset.internet_exposed ? (
          <Badge tone="high">Internet exposed</Badge>
        ) : (
          <span className="text-xs text-muted">Internal</span>
        ),
    },
    {
      key: 'severity',
      header: 'Worst risk',
      headerTitle: 'Worst severity among the linked open risks.',
      cell: (asset) => <SeverityBadge severity={asset.severity} />,
    },
    {
      key: 'rollups',
      header: 'Linked',
      align: 'right',
      headerTitle: 'Open risks (left) and open findings (right), recomputed by the API.',
      cell: (asset) => (
        <span className="text-xs tabular-nums">
          {asset.open_risks ?? 0} <span className="text-muted">risks</span>
          <span className="mx-1 text-muted">·</span>
          {asset.open_findings ?? 0} <span className="text-muted">findings</span>
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      hideOnMobile: true,
      cell: (asset) => <span className="text-xs">{asset.owner_name ?? '—'}</span>,
    },
    ...(showRetired
      ? [
          {
            key: 'assessed',
            header: 'Last assessed',
            sortKey: 'last_assessed_at',
            hideOnMobile: true,
            cell: (asset: Asset) => (
              <span className="text-xs tabular-nums">
                {asset.last_assessed_at ? formatDate(asset.last_assessed_at) : '—'}
              </span>
            ),
          } as Column<Asset>,
        ]
      : []),
  ];
  return columns;
}

// ---------------------------------------------------------------------------
// Shared asset form (also used by the asset detail page's edit dialog)
// ---------------------------------------------------------------------------

export interface AssetFormValues {
  asset_ref: string;
  name: string;
  asset_type: string;
  environment: string;
  business_unit: string;
  owner_id: string;
  criticality: string;
  data_sensitivity: string;
  internet_exposed: boolean;
  financial_importance: string;
  currency: string;
  dependencies: string;
  existing_controls: string;
  last_assessed_at: string;
  is_active: boolean;
  description: string;
}

export const EMPTY_ASSET_FORM: AssetFormValues = {
  asset_ref: '',
  name: '',
  asset_type: '',
  environment: 'production',
  business_unit: '',
  owner_id: '',
  criticality: '3',
  data_sensitivity: '3',
  internet_exposed: false,
  financial_importance: '',
  currency: 'USD',
  dependencies: '',
  existing_controls: '',
  last_assessed_at: '',
  is_active: true,
  description: '',
};

export function formFromAsset(asset: Asset): AssetFormValues {
  return {
    asset_ref: asset.asset_ref,
    name: asset.name,
    asset_type: asset.asset_type,
    environment: asset.environment,
    business_unit: asset.business_unit ?? '',
    owner_id: asset.owner_id ? String(asset.owner_id) : '',
    criticality: String(asset.criticality),
    data_sensitivity: String(asset.data_sensitivity),
    internet_exposed: asset.internet_exposed,
    financial_importance: asset.financial_importance ?? '',
    currency: asset.currency || 'USD',
    dependencies: asset.dependencies ?? '',
    existing_controls: asset.existing_controls ?? '',
    last_assessed_at: asset.last_assessed_at ? asset.last_assessed_at.slice(0, 10) : '',
    is_active: asset.is_active,
    description: asset.description ?? '',
  };
}

export interface AssetFormErrors {
  name?: string;
  asset_type?: string;
  criticality?: string;
  data_sensitivity?: string;
  currency?: string;
}

export function validateAssetForm(values: AssetFormValues): AssetFormErrors {
  const errors: AssetFormErrors = {};
  if (values.name.trim().length < 2) errors.name = 'Enter at least two characters.';
  if (!values.asset_type) errors.asset_type = 'Choose an asset type.';

  const criticality = Number(values.criticality);
  if (!(criticality >= 1 && criticality <= 5)) {
    errors.criticality = 'Criticality must be between 1 and 5.';
  }
  const sensitivity = Number(values.data_sensitivity);
  if (!(sensitivity >= 1 && sensitivity <= 5)) {
    errors.data_sensitivity = 'Data sensitivity must be between 1 and 5.';
  }
  if (values.currency.trim().length !== 3) {
    errors.currency = 'Use a three-letter ISO-4217 code, for example USD.';
  }
  return errors;
}

/**
 * Build the request body. Money is sent as the decimal string the analyst
 * typed, never as a float, and an empty amount is sent as `null` so an unvalued
 * asset stays unvalued rather than becoming a zero.
 */
export function buildAssetPayload(
  values: AssetFormValues,
  mode: 'create' | 'update',
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: values.name.trim(),
    description: values.description.trim() || null,
    asset_type: values.asset_type,
    environment: values.environment,
    business_unit: values.business_unit.trim() || null,
    owner_id: values.owner_id ? Number(values.owner_id) : null,
    criticality: Number(values.criticality),
    data_sensitivity: Number(values.data_sensitivity),
    internet_exposed: values.internet_exposed,
    financial_importance: values.financial_importance.trim() || null,
    currency: values.currency.trim().toUpperCase(),
    dependencies: values.dependencies.trim() || null,
    existing_controls: values.existing_controls.trim() || null,
    last_assessed_at: values.last_assessed_at ? `${values.last_assessed_at}T00:00:00Z` : null,
    is_active: values.is_active,
  };

  if (mode === 'create' && values.asset_ref.trim()) {
    payload.asset_ref = values.asset_ref.trim();
  }
  return payload;
}

export function AssetForm({
  values,
  errors,
  onChange,
  members,
  showReference = false,
}: {
  values: AssetFormValues;
  errors: AssetFormErrors;
  onChange: (patch: Partial<AssetFormValues>) => void;
  members: MemberOut[];
  showReference?: boolean;
}) {
  const ownerOptions = members.map((member) => ({
    value: String(member.user_id),
    label: `${member.full_name} · ${humanise(member.role)}`,
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required htmlFor="asset-name" error={errors.name} className="sm:col-span-2">
          <Input
            id="asset-name"
            value={values.name}
            invalid={Boolean(errors.name)}
            placeholder="Short, recognisable name for the asset"
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </Field>

        {showReference ? (
          <Field
            label="Reference"
            htmlFor="asset-ref"
            hint="Leave blank to allocate the next reference automatically."
          >
            <Input
              id="asset-ref"
              value={values.asset_ref}
              onChange={(event) => onChange({ asset_ref: event.target.value })}
            />
          </Field>
        ) : null}

        <Field label="Type" required htmlFor="asset-type" error={errors.asset_type}>
          <Select
            id="asset-type"
            value={values.asset_type}
            invalid={Boolean(errors.asset_type)}
            placeholder="Choose a type…"
            options={toOptions(ASSET_TYPES)}
            onChange={(event) => onChange({ asset_type: event.target.value })}
          />
        </Field>

        <Field label="Environment" htmlFor="asset-environment">
          <Select
            id="asset-environment"
            value={values.environment}
            options={toOptions(ENVIRONMENTS)}
            onChange={(event) => onChange({ environment: event.target.value })}
          />
        </Field>

        <Field
          label="Criticality"
          required
          htmlFor="asset-criticality"
          error={errors.criticality}
          aside="1 = low · 5 = critical"
        >
          <Select
            id="asset-criticality"
            value={values.criticality}
            invalid={Boolean(errors.criticality)}
            options={SCALE_OPTIONS}
            onChange={(event) => onChange({ criticality: event.target.value })}
          />
        </Field>

        <Field
          label="Data sensitivity"
          required
          htmlFor="asset-sensitivity"
          error={errors.data_sensitivity}
          aside="1 = public · 5 = highly sensitive"
        >
          <Select
            id="asset-sensitivity"
            value={values.data_sensitivity}
            invalid={Boolean(errors.data_sensitivity)}
            options={SCALE_OPTIONS}
            onChange={(event) => onChange({ data_sensitivity: event.target.value })}
          />
        </Field>

        <Field
          label="Owner"
          htmlFor="asset-owner"
          hint={ownerOptions.length ? undefined : 'No other members to assign.'}
        >
          <Select
            id="asset-owner"
            value={values.owner_id}
            placeholder="Unassigned"
            options={ownerOptions}
            onChange={(event) => onChange({ owner_id: event.target.value })}
          />
        </Field>

        <Field label="Business unit" htmlFor="asset-business-unit">
          <Input
            id="asset-business-unit"
            value={values.business_unit}
            onChange={(event) => onChange({ business_unit: event.target.value })}
          />
        </Field>

        <Field
          label="Financial importance"
          htmlFor="asset-financial"
          error={errors.currency}
          hint="The asset's value or replacement cost. Leave blank if it has not been valued."
        >
          <div className="flex gap-2">
            <DecimalInput
              id="asset-financial"
              value={values.financial_importance}
              invalid={Boolean(errors.currency)}
              placeholder="Not valued"
              onChange={(next) => onChange({ financial_importance: next })}
            />
            <Input
              aria-label="Currency"
              value={values.currency}
              className="w-20 uppercase"
              maxLength={3}
              invalid={Boolean(errors.currency)}
              onChange={(event) => onChange({ currency: event.target.value })}
            />
          </div>
        </Field>

        <Field label="Last assessed" htmlFor="asset-assessed">
          <Input
            id="asset-assessed"
            type="date"
            value={values.last_assessed_at}
            onChange={(event) => onChange({ last_assessed_at: event.target.value })}
          />
        </Field>

        <div className="flex flex-col gap-3 pb-1 sm:col-span-2">
          <Checkbox
            label="Internet exposed"
            hint="Reachable from the public internet. Raises the priority of findings on this asset."
            checked={values.internet_exposed}
            onChange={(event) => onChange({ internet_exposed: event.target.checked })}
          />
          <Checkbox
            label="Active"
            hint="Retiring an asset hides it from active lists without deleting its linked records."
            checked={values.is_active}
            onChange={(event) => onChange({ is_active: event.target.checked })}
          />
        </div>

        <Field label="Description" htmlFor="asset-description" className="sm:col-span-2">
          <Textarea
            id="asset-description"
            rows={3}
            value={values.description}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </Field>

        <Field
          label="Dependencies"
          htmlFor="asset-dependencies"
          hint="Systems this asset depends on, and systems that depend on it."
        >
          <Textarea
            id="asset-dependencies"
            rows={3}
            value={values.dependencies}
            onChange={(event) => onChange({ dependencies: event.target.value })}
          />
        </Field>

        <Field label="Existing controls" htmlFor="asset-controls">
          <Textarea
            id="asset-controls"
            rows={3}
            value={values.existing_controls}
            onChange={(event) => onChange({ existing_controls: event.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

/**
 * Decimal amount input.
 *
 * Kept as a text field with a decimal guard so the exact string the analyst
 * typed is what is sent, rather than a float round-trip that could silently
 * change the last digit of a large amount.
 */
function DecimalInput({
  id,
  value,
  invalid,
  placeholder,
  onChange,
}: {
  id: string;
  value: string;
  invalid?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      id={id}
      inputMode="decimal"
      value={value}
      invalid={invalid}
      placeholder={placeholder}
      onChange={(event) => {
        const next = event.target.value;
        if (next === '' || /^\d*\.?\d*$/.test(next)) onChange(next);
      }}
    />
  );
}

export function assetErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}
