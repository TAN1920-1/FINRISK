import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import type { KpiValue } from '@/types/api';

/**
 * KPI card.
 *
 * The value always arrives from the API (`value`, `unit`, `currency`), so a
 * figure on a dashboard is never computed or invented in the browser. An
 * estimate is labelled as an estimate, and a trend is only drawn when the API
 * actually supplied one.
 */
export function KpiCard({ kpi, className }: { kpi: KpiValue; className?: string }) {
  const unit = kpi.currency ?? kpi.unit ?? null;
  const display = formatKpiValue(kpi);

  return (
    <div className={cn('card flex flex-col justify-between p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-medium uppercase tracking-wide text-muted" title={kpi.label}>
          {kpi.label}
        </p>
        {kpi.help_text ? (
          <span title={kpi.help_text} className="text-muted" aria-label={kpi.help_text}>
            <Info className="h-3.5 w-3.5" aria-hidden />
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tabular-nums tracking-tight text-foreground">
          {display}
        </span>
        {unit ? <span className="text-xs text-muted">{unit}</span> : null}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {kpi.trend !== null && kpi.trend !== undefined ? <TrendIndicator value={kpi.trend} /> : null}
        {kpi.is_estimate ? (
          <span
            className="text-2xs text-muted"
            title="Derived from the documented loss model rather than observed data."
          >
            estimate
          </span>
        ) : null}
      </div>
    </div>
  );
}

function formatKpiValue(kpi: KpiValue): string {
  const unit = (kpi.unit ?? '').toLowerCase();
  if (unit === 'currency' || kpi.currency) {
    return new Intl.NumberFormat('en-US', {
      notation: Math.abs(kpi.value) >= 1_000_000 ? 'compact' : 'standard',
      maximumFractionDigits: Math.abs(kpi.value) >= 1_000_000 ? 1 : 0,
    }).format(kpi.value);
  }
  if (unit === 'percent') return `${kpi.value.toFixed(1)}%`;
  return formatNumber(kpi.value, { maximumFractionDigits: Number.isInteger(kpi.value) ? 0 : 1 });
}

/** Percentage change. Direction is labelled as well as coloured. */
export function TrendIndicator({
  value,
  suffix = 'vs previous period',
  className,
}: {
  value: number;
  suffix?: string;
  className?: string;
}) {
  const rising = value > 0;
  const flat = value === 0;
  const Icon = flat ? ArrowRight : rising ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-2xs',
        flat ? 'text-muted' : rising ? 'text-danger' : 'text-risk-low',
        className,
      )}
      title={`${value > 0 ? '+' : ''}${value.toFixed(1)}% ${suffix}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {value > 0 ? '+' : ''}
      {value.toFixed(1)}%
      <span className="text-muted">{suffix}</span>
    </span>
  );
}

/** Section wrapper with a title, used to group KPI grids and charts. */
export function SectionHeading({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
