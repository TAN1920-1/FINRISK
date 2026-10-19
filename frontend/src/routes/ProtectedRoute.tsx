import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldHalf } from 'lucide-react';
import { useAuth } from '@/app/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';

/**
 * Gate for every authenticated route.
 *
 * While the stored session is being verified the app shows a splash rather than
 * bouncing to the sign-in screen, because a redirect during hydration would log
 * a returning user out on every reload. Once resolved, an anonymous visitor is
 * sent to `/login` with the attempted location kept in history state so the
 * sign-in flow can return them to it.
 */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldHalf className="h-5 w-5" aria-hidden />
        </span>
        <p role="status" className="text-xs text-muted">
          Restoring your session…
        </p>
      </div>
    );
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
