import { NavLink, useLocation } from 'react-router-dom';
import { ShieldHalf, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NAV_GROUPS } from '@/app/navigation';
import { useAuth } from '@/app/AuthProvider';

/**
 * Persistent sidebar.
 *
 * Entries are filtered by the caller's capabilities purely for presentation.
 * The server enforces the same rules, so hiding a link is a convenience, not a
 * security control.
 */
export function Sidebar({
  open,
  onClose,
  className,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
}) {
  const { can } = useAuth();
  const location = useLocation();

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-slate-950/60 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/5 bg-sidebar text-slate-300 transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
          className,
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-14 items-center justify-between px-4">
          <NavLink to="/overview" className="flex items-center gap-2 rounded" onClick={onClose}>
            <span className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground">
              <ShieldHalf className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-sm font-semibold text-white">FinRisk AI</span>
              <span className="text-[10px] uppercase tracking-widest text-slate-400">
                Risk intelligence
              </span>
            </span>
          </NavLink>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded p-1 text-slate-400 transition-colors hover:text-white lg:hidden"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-6">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.permission || can(item.permission));
            if (!items.length) return null;
            return (
              <div key={group.label} className="mt-3">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const active =
                      location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          onClick={onClose}
                          title={item.hint}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-2.5 rounded px-2 py-1.5 text-xs transition-colors',
                            active
                              ? 'bg-primary/15 text-white'
                              : 'text-slate-300 hover:bg-white/5 hover:text-white',
                          )}
                        >
                          <item.icon
                            className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-slate-400')}
                            aria-hidden
                          />
                          <span className="truncate">{item.label}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <p className="border-t border-white/5 px-4 py-3 text-[10px] leading-relaxed text-slate-500">
          Scores are decision support. Financial figures are documented estimates, not forecasts.
        </p>
      </aside>
    </>
  );
}
