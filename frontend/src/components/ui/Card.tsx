import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <section className={cn('card', className)} {...rest} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-4', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <footer
      className={cn('flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3', className)}
      {...rest}
    />
  );
}

/** Definition list used by every record detail panel. */
export function DescriptionList({
  items,
  columns = 2,
  className,
}: {
  items: Array<{ label: string; value: ReactNode; span?: boolean }>;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const grid =
    columns === 1 ? 'sm:grid-cols-1' : columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3', grid, className)}>
      {items.map((item) => (
        <div key={item.label} className={cn('min-w-0', item.span && 'sm:col-span-full')}>
          <dt className="text-2xs font-medium uppercase tracking-wide text-muted">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
