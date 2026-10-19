import { useEffect, useState, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { findNavItem } from '@/app/navigation';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * Application shell.
 *
 * Provides the persistent chrome (sidebar, top bar) and the content column every
 * screen renders into. Each routed page is wrapped in its own error boundary,
 * labelled with the section name, so a render failure in one screen leaves the
 * navigation usable.
 */
export function AppShell({ children }: { children?: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // A navigation from the mobile drawer must not leave the drawer covering the
  // page it just opened.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  const activeItem = findNavItem(location.pathname);

  return (
    <div className="flex min-h-screen bg-canvas">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenNav={() => setNavOpen(true)} />

        <main
          id="main-content"
          tabIndex={-1}
          className={cn('mx-auto w-full max-w-[100rem] flex-1 px-3 py-5 sm:px-5 sm:py-6')}
        >
          <ErrorBoundary scope={activeItem?.label}>
            {children ?? <Outlet />}
          </ErrorBoundary>
        </main>

        <footer className="border-t border-border px-3 py-3 text-[10px] leading-relaxed text-muted sm:px-5">
          FinRisk AI presents prioritisation and documented estimates to support decisions. It is not a
          substitute for professional judgement, and financial figures are scenario estimates rather
          than forecasts.
        </footer>
      </div>
    </div>
  );
}
