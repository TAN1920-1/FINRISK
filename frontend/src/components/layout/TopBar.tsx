import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Menu } from 'lucide-react';
import { NAV_GROUPS, findNavItem } from '@/app/navigation';
import { GlobalSearch } from './GlobalSearch';
import { OrganizationSelector } from './OrganizationSelector';
import { NotificationsMenu } from './NotificationsMenu';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

/**
 * Top bar.
 *
 * Holds the controls that apply to the whole application rather than to one
 * screen: navigation toggle, a breadcrumb trail, global search, the active
 * organization, the notification inbox, the theme switch and the account menu.
 * It is intentionally thin, so the page below owns the primary heading.
 */
export function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const location = useLocation();
  const activeItem = findNavItem(location.pathname);
  const activeGroup = activeItem
    ? NAV_GROUPS.find((group) => group.items.some((item) => item.to === activeItem.to))
    : undefined;

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-canvas/85 px-3 backdrop-blur-md sm:px-4">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-border-strong hover:text-foreground lg:hidden"
      >
        <Menu className="h-4 w-4" aria-hidden />
      </button>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-xs md:flex">
        <Link to="/overview" className="rounded text-muted transition-colors hover:text-foreground">
          Overview
        </Link>
        {activeGroup ? (
          <>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted/60" aria-hidden />
            <span className="text-muted">{activeGroup.label}</span>
          </>
        ) : null}
        {activeItem && activeItem.to !== '/overview' ? (
          <>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted/60" aria-hidden />
            <span className="truncate font-medium text-foreground" aria-current="page">
              {activeItem.label}
            </span>
          </>
        ) : null}
      </nav>

      <GlobalSearch className="min-w-0 flex-1 md:max-w-xl" />

      <div className="ml-auto flex items-center gap-2">
        <OrganizationSelector />
        <NotificationsMenu />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
