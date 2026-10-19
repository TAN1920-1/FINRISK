import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-xs text-muted', className)}>
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn('skeleton block h-4 w-full', className)} aria-hidden />;
}

/** Placeholder that mimics a data table so the layout does not jump on load. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Loading records" className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-3.5', columnIndex === 0 ? 'w-40' : columnIndex === 1 ? 'w-56' : 'w-20')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-label="Loading" className="card p-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-32" />
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className="mt-3 h-3 w-full" />
      ))}
    </div>
  );
}

/**
 * Empty state.
 *
 * Distinguishes "there is genuinely nothing here" from "your filters matched
 * nothing", because the two need different actions from the reader.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  filtered = false,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  filtered?: boolean;
  className?: string;
}) {
  const Icon = filtered ? Inbox : ShieldAlert;
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-muted">
        {icon ?? <Icon className="h-5 w-5" aria-hidden />}
      </span>
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="mt-1 max-w-md text-xs text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Error state shown when a request failed. The backend's own message is
 * displayed verbatim so a permission denial explains which role is required.
 */
export function ErrorState({
  error,
  onRetry,
  className,
  title = 'Could not load this view',
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  title?: string;
}) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'An unexpected error occurred while loading this view.';

  return (
    <div
      role="alert"
      className={cn('flex flex-col items-start gap-3 rounded border border-danger/40 bg-danger/5 p-4', className)}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted">{message}</p>
        </div>
      </div>
      {onRetry ? (
        <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Banner used wherever a figure is an estimate or a model output. */
export function NoticeBanner({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger';
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'border-primary/30 bg-primary-muted text-foreground',
    warning: 'border-risk-medium/40 bg-risk-medium/10 text-foreground',
    danger: 'border-danger/40 bg-danger/5 text-foreground',
  }[tone];

  return (
    <div className={cn('rounded border p-3 text-xs', styles, className)}>
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={cn(title && 'mt-1', 'text-muted')}>{children}</div>
    </div>
  );
}
