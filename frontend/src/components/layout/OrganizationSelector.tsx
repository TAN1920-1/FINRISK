import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import { ApiError } from '@/lib/api';
import { Dropdown, MenuDivider, MenuItem, MenuSection } from '@/components/ui/Menu';
import { Button } from '@/components/ui/Button';

/**
 * Organization selector.
 *
 * Switching calls the API, which issues a token scoped to the chosen
 * organization; the client never assumes it can see an organization just
 * because its name is in a list.
 */
export function OrganizationSelector() {
  const { organizations, activeOrganization, switchOrganization } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: (organizationId: number) => switchOrganization(organizationId),
    onSuccess: async () => {
      // Every cached list is scoped to the previous organization; drop them all
      // rather than risk showing one tenant's rows under another's name.
      await queryClient.invalidateQueries();
      push({ tone: 'success', title: 'Organization switched' });
    },
    onError: (error: unknown) => {
      push({
        tone: 'error',
        title: 'Could not switch organization',
        description: error instanceof ApiError ? error.detail : undefined,
      });
    },
    onSettled: () => setPendingId(null),
  });

  if (!activeOrganization) return null;

  return (
    <Dropdown
      label="Active organization"
      width="w-72"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          className="flex max-w-[16rem] items-center gap-2 rounded border border-border bg-surface px-2 py-1.5 text-left transition-colors hover:border-border-strong"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-foreground">
              {activeOrganization.name}
            </span>
            <span className="block text-[10px] uppercase tracking-wide text-muted">
              {activeOrganization.role ?? 'member'} · {activeOrganization.currency}
              {activeOrganization.is_demo ? ' · demo data' : ''}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuSection title="Your organizations">
            {organizations.map((organization) => (
              <MenuItem
                key={organization.id}
                selected={organization.id === activeOrganization.id}
                disabled={mutation.isPending}
                onSelect={() => {
                  if (organization.id === activeOrganization.id) {
                    close();
                    return;
                  }
                  setPendingId(organization.id);
                  mutation.mutate(organization.id);
                  close();
                }}
                icon={
                  organization.id === activeOrganization.id ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Building2 className="h-3.5 w-3.5" aria-hidden />
                  )
                }
                description={
                  <>
                    {organization.role ?? 'member'} · data in {organization.currency}
                    {organization.is_demo ? ' · synthetic demo' : ''}
                  </>
                }
              >
                {organization.name}
              </MenuItem>
            ))}
          </MenuSection>
          <MenuDivider />
          <div className="p-2">
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-center"
              icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
              disabled={mutation.isPending || pendingId !== null}
              onClick={() => {
                close();
                window.location.assign('/settings?tab=organization');
              }}
            >
              Create or manage organizations
            </Button>
          </div>
        </>
      )}
    </Dropdown>
  );
}
