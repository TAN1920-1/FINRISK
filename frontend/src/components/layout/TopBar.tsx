import { Menu } from 'lucide-react';
import { GlobalSearch } from './GlobalSearch';
import { OrganizationSelector } from './OrganizationSelector';
import { NotificationsMenu } from './NotificationsMenu';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

/**
 * Top bar.
 *
 * Holds the controls that apply to the whole application rather than to one
 * screen: navigation toggle, global search, the active organization, the
 * notification inbox and the account menu. It is intentionally thin, so the
 * page below owns the primary heading.
 */
export function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-canvas/95 px-3 backdrop-blur sm:px-4">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="inline-flex h-9 w-9 items-center justify-center rounded border border-border bg-surface text-muted transition-colors hover:text-foreground lg:hidden"
      >
        <Menu className="h-4 w-4" aria-hidden />
      </button>

      <GlobalSearch className="min-w-0 flex-1 max-w-xl" />

      <div className="ml-auto flex items-center gap-2">
        <OrganizationSelector />
        <NotificationsMenu />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
