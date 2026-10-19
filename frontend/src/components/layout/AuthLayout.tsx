import type { ReactNode } from 'react';
import { ShieldHalf } from 'lucide-react';

/**
 * Centred card layout shared by the sign-in and registration screens.
 *
 * The panel also carries the platform's position on what its numbers mean, so
 * the disclaimer is present before a user ever reaches a dashboard.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldHalf className="h-5 w-5" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-foreground">FinRisk AI</p>
            <p className="text-2xs uppercase tracking-widest text-muted">Risk intelligence</p>
          </div>
        </div>

        <div className="card p-5 sm:p-6">
          <h1 className="text-base font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-xs text-muted">{description}</p>
          <div className="mt-5">{children}</div>
        </div>

        {footer ? <div className="mt-4 text-center text-xs text-muted">{footer}</div> : null}

        <p className="mt-6 text-center text-2xs leading-relaxed text-muted">
          Scores and financial figures are documented decision support, not forecasts.
        </p>
      </div>
    </div>
  );
}
