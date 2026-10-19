import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Page header. Renders the `<h1>` for the screen and, when the router supplied
 * breadcrumbs, an accessible trail above it. Actions live on the right so the
 * placement of a primary button is consistent across all eleven sections.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  meta,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Array<{ label: string; to?: string }>;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {breadcrumbs?.length ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-2xs text-muted">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 ? <span aria-hidden>/</span> : null}
                {crumb.to ? (
                  <a href={crumb.to} className="rounded transition-colors hover:text-foreground">
                    {crumb.label}
                  </a>
                ) : (
                  <span aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-xs text-muted">{description}</p> : null}
          {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
