import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronsUpDown, LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '@/app/AuthProvider';
import { useToast } from '@/app/ToastProvider';
import { humanise } from '@/lib/format';
import { Dropdown, MenuDivider, MenuItem, MenuSection } from '@/components/ui/Menu';
import { ConfirmDialog } from '@/components/ui/Dialog';

/** Account menu: identity, role, a link to settings and a confirmed sign-out. */
export function UserMenu() {
  const { user, role, logout } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  if (!user) return null;

  const initials = user.full_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <>
      <Dropdown
        label="Your account"
        width="w-64"
        trigger={(props) => (
          <button
            {...props}
            type="button"
            className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5 text-left transition-colors hover:border-border-strong"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              {initials || <UserRound className="h-3 w-3" aria-hidden />}
            </span>
            <span className="hidden min-w-0 flex-col leading-tight sm:flex">
              <span className="max-w-[9rem] truncate text-xs font-medium text-foreground">
                {user.full_name}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted">
                {role ? humanise(role) : 'member'}
              </span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuSection>
              <div className="px-3 py-1.5">
                <p className="truncate text-xs font-medium text-foreground">{user.full_name}</p>
                <p className="truncate text-2xs text-muted">{user.email}</p>
                <p className="mt-1 flex items-center gap-1 text-2xs text-muted">
                  <ShieldCheck className="h-3 w-3" aria-hidden />
                  {role ? humanise(role) : 'member'}
                </p>
              </div>
            </MenuSection>
            <MenuDivider />
            <MenuSection>
              <MenuItem
                icon={<Settings className="h-3.5 w-3.5" aria-hidden />}
                onSelect={() => {
                  close();
                  navigate('/settings');
                }}
              >
                Settings
              </MenuItem>
              <MenuItem
                icon={<LogOut className="h-3.5 w-3.5" aria-hidden />}
                danger
                onSelect={() => {
                  close();
                  setConfirming(true);
                }}
              >
                Sign out
              </MenuItem>
            </MenuSection>
          </>
        )}
      </Dropdown>

      <ConfirmDialog
        open={confirming}
        title="Sign out of FinRisk AI?"
        message="Your session token will be discarded and you will return to the sign-in screen."
        confirmLabel="Sign out"
        tone="danger"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false);
          await logout();
          push({ tone: 'info', title: 'Signed out' });
        }}
      />
    </>
  );
}
