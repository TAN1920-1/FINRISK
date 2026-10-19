import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Save } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { formatDate, humanise, pluralise } from '@/lib/format';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import type { MemberOut, Message, OrganizationOut } from '@/types/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { BadgeTone } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import type { Column } from '@/components/ui/DataTable';
import { Tabs } from '@/components/ui/Tabs';
import { Dialog } from '@/components/ui/Dialog';
import { CardSkeleton, ErrorState, NoticeBanner } from '@/components/ui/Feedback';
import { Field, FormErrorSummary, Input, Select } from '@/components/ui/Form';

/**
 * Settings.
 *
 * Three things live here: the organization's own record, the people in it, and
 * the signed-in user's own credentials. Each panel is gated on the capability
 * the corresponding endpoint actually enforces, so a viewer sees the page but no
 * control that would be refused — and every message the server sends back
 * (including "You cannot remove your own administrator role.") is shown as it
 * arrived rather than being replaced with a friendlier lie.
 */
export function SettingsPage() {
  const { role, activeOrganization } = useAuth();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="The organization this workspace belongs to, the people who can sign in to it, and your own account."
        meta={
          <>
            <Badge tone="neutral">{humanise(role ?? 'unknown')}</Badge>
            {activeOrganization ? (
              <span className="text-2xs text-muted">{activeOrganization.name}</span>
            ) : null}
          </>
        }
      />

      <Tabs
        items={[
          { id: 'organization', label: 'Organization', content: <OrganizationPanel /> },
          { id: 'members', label: 'Members', content: <MembersPanel /> },
          { id: 'account', label: 'Your account', content: <AccountPanel /> },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

function OrganizationPanel() {
  const organization = useQuery({
    queryKey: queryKeys.organization,
    queryFn: () => api.get<OrganizationOut>('/api/organizations/current'),
  });

  if (organization.isPending) {
    return (
      <div className="space-y-4">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={3} />
      </div>
    );
  }

  if (organization.isError) {
    return (
      <ErrorState
        error={organization.error}
        onRetry={() => void organization.refetch()}
        title="Could not load the organization"
      />
    );
  }

  return <OrganizationForm organization={organization.data} />;
}

interface OrganizationFormValues {
  name: string;
  currency: string;
  industry: string;
  reporting_period_label: string;
}

function OrganizationForm({ organization }: { organization: OrganizationOut }) {
  const { can, refreshSession } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const editable = can('org:manage');

  const [values, setValues] = useState<OrganizationFormValues>({
    name: organization.name,
    currency: organization.currency,
    industry: organization.industry ?? '',
    reporting_period_label: organization.reporting_period_label ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.patch<OrganizationOut>('/api/organizations/current', payload),
    onSuccess: async (updated) => {
      push({
        tone: 'success',
        title: 'Organization updated',
        description: `${updated.name} was saved. The change is written to the audit trail.`,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.organization });
      // The shell header reads the organization from the session, so refresh it
      // rather than patching a local copy and letting the two drift apart.
      await refreshSession();
    },
  });

  const name = values.name.trim();
  const currency = values.currency.trim().toUpperCase();
  const industry = values.industry.trim();
  const periodLabel = values.reporting_period_label.trim();

  // Only the fields that actually changed are sent, so the audit entry names
  // the real edit instead of the whole form.
  const changes: Record<string, unknown> = {};
  if (name !== organization.name) changes.name = name;
  if (currency !== organization.currency) changes.currency = currency;
  if (industry !== (organization.industry ?? '')) changes.industry = industry || null;
  if (periodLabel !== (organization.reporting_period_label ?? '')) {
    changes.reporting_period_label = periodLabel || null;
  }
  const dirty = Object.keys(changes).length > 0;

  const submit = () => {
    const next: Record<string, string> = {};
    if (name.length < 2) next.name = 'Enter at least two characters.';
    if (!/^[A-Za-z]{3}$/.test(currency)) next.currency = 'Use a three-letter ISO 4217 code, such as USD.';
    setErrors(next);
    if (Object.keys(next).length) return;
    mutation.mutate(changes);
  };

  return (
    <div className="space-y-4">
      {organization.is_demo ? (
        <NoticeBanner tone="warning" title="This organization is a demonstration tenant">
          Its records were generated by the platform's demo seeder. Renaming it does not make the
          data real; replace the synthetic records before using them for any decision.
        </NoticeBanner>
      ) : null}

      <Card>
        <CardHeader
          title="Organization profile"
          description="The name appears in the header, in exported reports and on every audit entry."
          actions={
            editable ? (
              <Button
                variant="primary"
                icon={<Save className="h-3.5 w-3.5" aria-hidden />}
                loading={mutation.isPending}
                disabled={!dirty}
                onClick={submit}
              >
                Save changes
              </Button>
            ) : null
          }
        />
        <CardBody className="space-y-4">
          {!editable ? (
            <NoticeBanner tone="info" title="Read-only">
              Changing the organization profile requires the <code>org:manage</code> capability,
              which the {humanise('risk_manager')} role and above hold.
            </NoticeBanner>
          ) : null}

          <FormErrorSummary errors={Object.values(errors)} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="org-name" required error={errors.name}>
              <Input
                id="org-name"
                value={values.name}
                disabled={!editable}
                invalid={Boolean(errors.name)}
                onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
              />
            </Field>

            <Field
              label="Reporting currency"
              htmlFor="org-currency"
              required
              error={errors.currency}
              hint="ISO 4217, three letters. Amounts recorded in another currency are never converted."
            >
              <Input
                id="org-currency"
                value={values.currency}
                disabled={!editable}
                maxLength={3}
                className="uppercase"
                invalid={Boolean(errors.currency)}
                onChange={(event) => setValues((current) => ({ ...current, currency: event.target.value }))}
              />
            </Field>

            <Field label="Industry" htmlFor="org-industry" hint="Optional. Shown on report covers.">
              <Input
                id="org-industry"
                value={values.industry}
                disabled={!editable}
                placeholder="Not recorded"
                onChange={(event) => setValues((current) => ({ ...current, industry: event.target.value }))}
              />
            </Field>

            <Field
              label="Reporting period label"
              htmlFor="org-period"
              hint="Optional. The free-text period shown on reports, e.g. “FY2026 Q1”."
            >
              <Input
                id="org-period"
                value={values.reporting_period_label}
                disabled={!editable}
                placeholder="Not recorded"
                onChange={(event) =>
                  setValues((current) => ({ ...current, reporting_period_label: event.target.value }))
                }
              />
            </Field>
          </div>

          {mutation.isError ? (
            <NoticeBanner tone="danger" title="The change was not saved">
              {messageOf(mutation.error)}
            </NoticeBanner>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Record"
          description="Identifiers assigned by the platform. These are not editable."
        />
        <CardBody>
          <DescriptionList
            columns={3}
            items={[
              { label: 'Slug', value: <span className="font-mono text-xs">{organization.slug}</span> },
              {
                label: 'Members',
                value: `${organization.member_count ?? 0} ${pluralise(organization.member_count ?? 0, 'person', 'people')}`,
              },
              { label: 'Created', value: formatDate(organization.created_at) },
              {
                label: 'Organization ID',
                value: <span className="tabular-nums">{organization.id}</span>,
              },
              { label: 'Your role', value: <Badge tone={ROLE_TONE[String(organization.role)] ?? 'neutral'}>{humanise(organization.role ?? 'unknown')}</Badge> },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const ROLE_TONE: Record<string, BadgeTone> = {
  admin: 'primary',
  risk_manager: 'secondary',
  analyst: 'neutral',
  viewer: 'unknown',
};

const EMPTY_MEMBER_FORM: MemberFormValues = {
  email: '',
  full_name: '',
  password: '',
  role: 'viewer',
  job_title: '',
};

interface MemberFormValues {
  email: string;
  full_name: string;
  password: string;
  role: string;
  job_title: string;
}

function MembersPanel() {
  const { hasRole, user, refreshSession } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();

  // The endpoints decide this, not the client: PATCH /api/auth/members/{id} is
  // open to risk managers, POST /api/auth/members to administrators only.
  const canChangeRoles = hasRole('risk_manager');
  const canAddMembers = hasRole('admin');

  const [roleTarget, setRoleTarget] = useState<MemberOut | null>(null);
  const [roleDraft, setRoleDraft] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addValues, setAddValues] = useState<MemberFormValues>(EMPTY_MEMBER_FORM);
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});

  const members = useQuery({
    queryKey: queryKeys.members,
    queryFn: () => api.get<MemberOut[]>('/api/auth/members'),
  });

  const roles = useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => api.get<string[]>('/api/auth/roles'),
    staleTime: 30 * 60_000,
    enabled: canChangeRoles,
  });

  const roleOptions = (roles.data ?? []).map((value) => ({ value, label: humanise(value) }));

  const roleMutation = useMutation({
    mutationFn: (input: { membershipId: number; role: string }) =>
      api.patch<MemberOut>(`/api/auth/members/${input.membershipId}`, { role: input.role }),
    onSuccess: async (updated) => {
      setRoleTarget(null);
      push({
        tone: 'success',
        title: `${updated.full_name} is now ${humanise(updated.role)}`,
        description: 'The role change is written to the audit trail.',
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.members });
      await queryClient.invalidateQueries({ queryKey: queryKeys.organization });
      // Changing your own role changes your capabilities; re-read the session.
      if (user && updated.user_id === user.id) await refreshSession();
    },
  });

  const addMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<MemberOut>('/api/auth/members', payload),
    onSuccess: async (created) => {
      setAddOpen(false);
      setAddValues(EMPTY_MEMBER_FORM);
      setAddErrors({});
      push({
        tone: 'success',
        title: `${created.full_name} was added as ${humanise(created.role)}`,
        description:
          'No invitation email is sent in this build — give them the password out of band and ask them to change it.',
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.members });
      await queryClient.invalidateQueries({ queryKey: queryKeys.organization });
    },
    onError: (error) => setAddErrors(fieldErrorsOf(error)),
  });

  const submitAdd = () => {
    const next: Record<string, string> = {};
    if (!addValues.email.trim()) next.email = 'Enter the email address they will sign in with.';
    if (addValues.full_name.trim().length < 2) next.full_name = 'Enter their full name.';
    if (!addValues.password) next.password = 'Set an initial password.';
    setAddErrors(next);
    if (Object.keys(next).length) return;

    addMutation.mutate({
      email: addValues.email.trim(),
      full_name: addValues.full_name.trim(),
      password: addValues.password,
      role: addValues.role,
      job_title: addValues.job_title.trim() || null,
    });
  };

  return (
    <div className="space-y-4">
      <NoticeBanner tone="info" title="What a role can do">
        An <strong>administrator</strong> manages the organization and its members; a{' '}
        <strong>risk manager</strong> owns the register and can change roles; an{' '}
        <strong>analyst</strong> records and scores risks; a <strong>viewer</strong> can read
        everything and change nothing. The server enforces this on every request.
      </NoticeBanner>

      <Card>
        <CardHeader
          title="Members"
          description="Everyone who can sign in to this organization."
          actions={
            canAddMembers ? (
              <Button
                variant="primary"
                icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
                onClick={() => {
                  setAddValues(EMPTY_MEMBER_FORM);
                  setAddErrors({});
                  setAddOpen(true);
                }}
              >
                Add member
              </Button>
            ) : null
          }
        />
        <DataTable<MemberOut>
          caption="Organization members"
          columns={memberColumns({
            currentUserId: user?.id,
            onChangeRole: canChangeRoles ? openRole : undefined,
          })}
          rows={members.data ?? []}
          rowKey={(member) => member.id}
          loading={members.isPending}
          error={members.isError ? members.error : undefined}
          onRetry={() => void members.refetch()}
          emptyTitle="No members are recorded"
          emptyDescription="An organization with no members cannot be administered. Add the first colleague from here."
        />
      </Card>

      <Dialog
        open={Boolean(roleTarget)}
        onClose={() => setRoleTarget(null)}
        title={roleTarget ? `Change the role of ${roleTarget.full_name}` : 'Change role'}
        description="The new role takes effect on their next request. The change is written to the audit trail."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRoleTarget(null)} disabled={roleMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={roleMutation.isPending}
              disabled={!roleTarget || roleDraft === roleTarget.role}
              onClick={() => roleTarget && roleMutation.mutate({ membershipId: roleTarget.id, role: roleDraft })}
            >
              Save role
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Role" htmlFor="member-role" required>
            <Select
              id="member-role"
              value={roleDraft}
              options={roleOptions}
              onChange={(event) => setRoleDraft(event.target.value)}
            />
          </Field>
          {roleMutation.isError ? (
            <NoticeBanner tone="danger" title="The role was not changed">
              {messageOf(roleMutation.error)}
            </NoticeBanner>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a member"
        description="If the email already belongs to an account on this platform, that account is attached to this organization instead of a duplicate being created; its existing password is left untouched."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={addMutation.isPending}>
              Cancel
            </Button>
            <Button variant="primary" loading={addMutation.isPending} onClick={submitAdd}>
              Add member
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary errors={[...Object.values(addErrors), addMutation.isError ? messageOf(addMutation.error) : null]} />

          <Field label="Email address" htmlFor="member-email" required error={addErrors.email}>
            <Input
              id="member-email"
              type="email"
              autoComplete="off"
              value={addValues.email}
              invalid={Boolean(addErrors.email)}
              onChange={(event) => setAddValues((current) => ({ ...current, email: event.target.value }))}
            />
          </Field>

          <Field label="Full name" htmlFor="member-name" required error={addErrors.full_name}>
            <Input
              id="member-name"
              value={addValues.full_name}
              invalid={Boolean(addErrors.full_name)}
              onChange={(event) => setAddValues((current) => ({ ...current, full_name: event.target.value }))}
            />
          </Field>

          <Field
            label="Initial password"
            htmlFor="member-password"
            required
            error={addErrors.password}
            hint="At least 10 characters, mixing letters with digits or symbols. Tell them out of band and ask them to change it once they sign in."
          >
            <Input
              id="member-password"
              type="password"
              autoComplete="new-password"
              value={addValues.password}
              invalid={Boolean(addErrors.password)}
              onChange={(event) => setAddValues((current) => ({ ...current, password: event.target.value }))}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role" htmlFor="member-new-role" required error={addErrors.role}>
              <Select
                id="member-new-role"
                value={addValues.role}
                options={roleOptions}
                onChange={(event) => setAddValues((current) => ({ ...current, role: event.target.value }))}
              />
            </Field>
            <Field label="Job title" htmlFor="member-job" hint="Optional.">
              <Input
                id="member-job"
                value={addValues.job_title}
                onChange={(event) => setAddValues((current) => ({ ...current, job_title: event.target.value }))}
              />
            </Field>
          </div>
        </div>
      </Dialog>
    </div>
  );

  function openRole(member: MemberOut) {
    setRoleTarget(member);
    setRoleDraft(String(member.role));
  }
}

function memberColumns(handlers: {
  currentUserId?: number;
  onChangeRole?: (member: MemberOut) => void;
}): Array<Column<MemberOut>> {
  const { currentUserId, onChangeRole } = handlers;
  return [
    {
      key: 'name',
      header: 'Member',
      cell: (member) => (
        <span className="block">
          <span className="block text-xs font-medium text-foreground">
            {member.full_name}
            {currentUserId === member.user_id ? <span className="ml-1 text-2xs text-muted">(you)</span> : null}
          </span>
          <span className="block break-all text-2xs text-muted">{member.email}</span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (member) => (
        <Badge tone={ROLE_TONE[String(member.role)] ?? 'neutral'}>{humanise(member.role)}</Badge>
      ),
    },
    {
      key: 'job',
      header: 'Job title',
      hideOnMobile: true,
      cell: (member) => <span className="text-xs text-muted">{member.job_title ?? 'Not recorded'}</span>,
    },
    {
      key: 'joined',
      header: 'Joined',
      hideOnMobile: true,
      cell: (member) => <span className="text-xs tabular-nums">{formatDate(member.created_at)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (member) =>
        onChangeRole ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Change the role of ${member.full_name}`}
            onClick={() => onChangeRole(member)}
          >
            Change role
          </Button>
        ) : (
          <span className="text-2xs text-muted">Read-only</span>
        ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Your account
// ---------------------------------------------------------------------------

interface PasswordFormValues {
  current_password: string;
  new_password: string;
  confirm: string;
}

const EMPTY_PASSWORD_FORM: PasswordFormValues = {
  current_password: '',
  new_password: '',
  confirm: '',
};

function AccountPanel() {
  const { user, role, organizations, logout } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const [values, setValues] = useState<PasswordFormValues>(EMPTY_PASSWORD_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<Message>('/api/auth/password', payload),
    onSuccess: async (result) => {
      push({ tone: 'success', title: 'Password updated', description: result.message });
      // The server bumps the token version, so this token is already dead; end
      // the session deliberately rather than letting the next request 401.
      queryClient.clear();
      await logout();
    },
  });

  const submit = () => {
    const next: Record<string, string> = {};
    if (!values.current_password) next.current_password = 'Enter your current password.';
    if (values.new_password.length < 10) {
      next.new_password = 'Use at least 10 characters, mixing letters with digits or symbols.';
    }
    if (values.new_password !== values.confirm) next.confirm = 'The two new passwords do not match.';
    setErrors(next);
    if (Object.keys(next).length) return;

    mutation.mutate({
      current_password: values.current_password,
      new_password: values.new_password,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Your account" description="Your identity as the platform knows it." />
        <CardBody>
          <DescriptionList
            columns={2}
            items={[
              { label: 'Name', value: user?.full_name ?? 'Not recorded' },
              { label: 'Email', value: <span className="break-all">{user?.email ?? 'Not recorded'}</span> },
              { label: 'Role here', value: <Badge tone={ROLE_TONE[role ?? ''] ?? 'neutral'}>{humanise(role ?? 'unknown')}</Badge> },
              {
                label: 'Organizations',
                value: `${organizations.length} ${pluralise(organizations.length, 'organization')}`,
              },
              { label: 'Last signed in', value: user?.last_login_at ? formatDate(user.last_login_at) : 'Not recorded' },
              { label: 'Account created', value: user ? formatDate(user.created_at) : 'Not recorded' },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Change your password"
          description="Changing your password ends every existing session, including this one, so you sign in again afterwards."
        />
        <CardBody className="space-y-4">
          <NoticeBanner tone="warning" title="You will be signed out">
            The platform invalidates every token issued with the old password. Other devices are
            signed out, and so is this one; you will return to the sign-in screen.
          </NoticeBanner>

          <FormErrorSummary
            errors={[...Object.values(errors), mutation.isError ? messageOf(mutation.error) : null]}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Current password"
              htmlFor="current-password"
              required
              error={errors.current_password}
              className="sm:col-span-2"
            >
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={values.current_password}
                invalid={Boolean(errors.current_password)}
                onChange={(event) =>
                  setValues((current) => ({ ...current, current_password: event.target.value }))
                }
              />
            </Field>

            <Field label="New password" htmlFor="new-password" required error={errors.new_password}>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={values.new_password}
                invalid={Boolean(errors.new_password)}
                onChange={(event) => setValues((current) => ({ ...current, new_password: event.target.value }))}
              />
            </Field>

            <Field label="Confirm new password" htmlFor="confirm-password" required error={errors.confirm}>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={values.confirm}
                invalid={Boolean(errors.confirm)}
                onChange={(event) => setValues((current) => ({ ...current, confirm: event.target.value }))}
              />
            </Field>
          </div>

          <div className="flex justify-end">
            <Button
              variant="primary"
              icon={<KeyRound className="h-3.5 w-3.5" aria-hidden />}
              loading={mutation.isPending}
              onClick={submit}
            >
              Change password
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}

function fieldErrorsOf(error: unknown): Record<string, string> {
  if (error instanceof ApiError && error.fieldErrors) return error.fieldErrors;
  return {};
}
