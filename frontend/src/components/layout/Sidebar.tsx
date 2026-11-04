import { NavLink, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, ShieldHalf, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NAV_GROUPS, SETTINGS_NAV_ITEM, type NavItem } from '@/app/navigation';
import { useAuth } from '@/app/AuthProvider';

/**
 * Persistent sidebar.
 *
 * Entries are filtered by the caller's capabilities purely for presentation.
 * The server enforces the same rules, so hiding a link is a convenience, not a
 * security control.
 *
 * On desktop the rail collapses to an icon strip; the label of a collapsed item
 * is still reachable as a hover tooltip and as the accessible name, so the
 * compact mode never hides where a link goes.
 */
export function Sidebar({
  open,
  onClose,
  collapsed,
  onToggleCollapsed,
  className,
}: {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  className?: string;
}) {
  const { can } = useAuth();
  const location = useLocation();

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-[width,transform] duration-300 ease-smooth lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
          collapsed && 'lg:w-[4.5rem]',
          className,
        )}
        aria-label="Main navigation"
      >
        <div
          className={cn(
            'flex h-14 shrink-0 items-center border-b border-border px-3',
            collapsed ? 'lg:justify-center lg:px-2' : 'justify-between',
          )}
        >
          <NavLink
            to="/overview"
            className="flex min-w-0 items-center gap-2.5 rounded-md px-1 py-1"
            onClick={onClose}
            aria-label="FinRisk AI — go to overview"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-slate-950 shadow-glow">
              <ShieldHalf className="h-4 w-4" aria-hidden />
            </span>
            <span className={cn('flex min-w-0 flex-col leading-none', collapsed && 'lg:hidden')}>
              <span className="truncate text-sm font-semibold text-foreground">FinRisk AI</span>
              <span className="truncate text-[10px] uppercase tracking-widest text-sidebar-muted">
                Risk intelligence
              </span>
            </span>
          </NavLink>

          <div className={cn('flex items-center gap-1', collapsed && 'lg:hidden')}>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              className="hidden rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-active hover:text-foreground lg:inline-flex"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation"
              className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-active hover:text-foreground lg:hidden"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {/* When collapsed the toggle is the only way back, so it sits above the
            scroll area where it cannot be scrolled out of reach. */}
        {collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Expand navigation"
            className="mx-auto mt-2 hidden h-8 w-8 items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-sidebar-active hover:text-foreground lg:inline-flex"
          >
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
          </button>
        ) : null}

        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4 pt-2">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.permission || can(item.permission));
            if (!items.length) return null;
            return (
              <div key={group.label} className="mt-3 first:mt-1">
                <p
                  className={cn(
                    'px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted',
                    collapsed && 'lg:hidden',
                  )}
                >
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <SidebarLink
                      key={item.to}
                      item={item}
                      collapsed={collapsed}
                      onNavigate={onClose}
                      active={isActive(location.pathname, item.to)}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-border p-2">
          <ul>
            <SidebarLink
              item={SETTINGS_NAV_ITEM}
              collapsed={collapsed}
              onNavigate={onClose}
              active={isActive(location.pathname, SETTINGS_NAV_ITEM.to)}
            />
          </ul>
          <p
            className={cn(
              'px-2 pt-2 text-[10px] leading-relaxed text-sidebar-muted',
              collapsed && 'lg:hidden',
            )}
          >
            Scores are decision support. Financial figures are documented estimates, not forecasts.
          </p>
        </div>
      </aside>
    </>
  );
}

function isActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function SidebarLink({
  item,
  collapsed,
  active,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <li>
      <NavLink
        to={item.to}
        onClick={onNavigate}
        title={collapsed ? item.label : item.hint}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative flex items-center gap-2.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors',
          collapsed && 'lg:justify-center lg:px-0',
          active
            ? 'bg-sidebar-active text-foreground'
            : 'text-sidebar-muted hover:bg-sidebar-active/60 hover:text-foreground',
        )}
      >
        {active ? (
          <span
            className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
            aria-hidden
          />
        ) : null}
        <item.icon
          className={cn(
            'h-4 w-4 shrink-0 transition-colors',
            active ? 'text-primary' : 'text-sidebar-muted group-hover:text-foreground',
          )}
          aria-hidden
        />
        <span className={cn('truncate', collapsed && 'lg:hidden')}>{item.label}</span>

        {collapsed ? (
          <span
            role="tooltip"
            className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface-raised px-2 py-1 text-2xs font-medium text-foreground opacity-0 shadow-raised transition-opacity group-hover:opacity-100 lg:block"
          >
            {item.label}
          </span>
        ) : null}
      </NavLink>
    </li>
  );
}
