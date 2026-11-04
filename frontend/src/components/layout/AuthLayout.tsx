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
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-10 flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-glow">
            <ShieldHalf className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">FinRisk AI</h1>
            <p className="text-[13px] text-muted-foreground mt-1">Intelligence-Driven Risk Management</p>
          </div>
        </div>

        <div className="card shadow-xl p-8 sm:p-10">
          <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{description}</p>
          <div className="mt-8">{children}</div>
        </div>

        {footer ? <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div> : null}

        <p className="mt-10 text-center text-[11px] font-medium leading-relaxed text-muted-foreground/60 uppercase tracking-widest">
          Decision Support • Institutional Grade • Secure Terminal
        </p>
      </div>
    </div>
  );
}
