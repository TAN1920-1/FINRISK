import { useLocation } from 'react-router-dom';
import { Calendar, ChevronRight, Menu } from 'lucide-react';
import { GlobalSearch } from './GlobalSearch';
import { NotificationsMenu } from './NotificationsMenu';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { findNavItem } from '@/app/navigation';

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

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-surface px-4 backdrop-blur-md">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-border-strong hover:text-foreground lg:hidden"
      >
        <Menu className="h-4 w-4" aria-hidden />
      </button>

      <nav aria-label="Breadcrumb" className="hidden items-center gap-2 text-[13px] md:flex">
        <span className="text-muted">FinRisk</span>
        <ChevronRight className="h-3 w-3 text-muted/40" aria-hidden />
        <span className="font-semibold text-foreground">
          {activeItem?.label || 'Dashboard'}
        </span>
      </nav>

      <div className="flex flex-1 justify-center">
        <GlobalSearch className="w-full max-w-lg" />
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-muted md:flex">
          <Calendar className="h-3.5 w-3.5" />
          <span>YTD: Jan 01 - Present</span>
        </div>
        <div className="flex items-center gap-1.5 border-l border-border pl-3">
          <NotificationsMenu />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
