import type { ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import type { KpiValue } from '@/types/api';

export type KpiTone = 'primary' | 'secondary' | 'success' | 'warning' | 'danger';

/**
 * Mapping of KPI keys to their visual metadata.
 */
export const KPI_META: Record<string, { tone: KpiTone }> = {
  total_risks: { tone: 'primary' },
  open_risks: { tone: 'secondary' },
  critical_risks: { tone: 'danger' },
  high_risks: { tone: 'warning' },
  overdue_risks: { tone: 'danger' },
  expected_gross_exposure: { tone: 'danger' },
  expected_residual_exposure: { tone: 'warning' },
  potential_avoided_loss: { tone: 'success' },
  expected_loss_reduction_pct: { tone: 'success' },
  open_findings: { tone: 'secondary' },
  critical_findings: { tone: 'danger' },
  assets_total: { tone: 'primary' },
  assets_internet_exposed: { tone: 'warning' },
  mitigations_open: { tone: 'secondary' },
  mitigations_overdue: { tone: 'danger' },
  risks_created_30d: { tone: 'primary' },
};

/**
 * KPI card.
 *
 * The value always arrives from the API (`value`, `unit`, `currency`), so a
 * figure on a dashboard is never computed or invented in the browser. An
 * estimate is labelled as an estimate, a trend is only drawn when the API
 * actually supplied one, and the sparkline is only drawn when the caller
 * passes a real series for that same metric.
 */
export function KpiCard({
  kpi,
  series,
  className,
}: {
  kpi: KpiValue;
  /** A real history for this metric. Rendered only when at least two points. */
  series?: number[];
  className?: string;
}) {
  const display = formatKpiValue(kpi);
  const points = series && series.length >= 2 ? series : undefined;

  return (
    <div
      className={cn(
        'card group relative overflow-hidden p-4 flex flex-col justify-between',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground" title={kpi.label}>
          {kpi.label}
        </p>
        <span className={cn(
          'rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
          kpi.trend && kpi.trend > 0 ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'
        )}>
          {kpi.trend && kpi.trend > 0 ? 'Watch' : 'Optimal'}
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
          {display}
        </span>
        {kpi.currency || kpi.unit ? (
          <span className="text-xs font-medium text-muted-foreground">
            {kpi.currency || kpi.unit}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        {kpi.trend !== null && kpi.trend !== undefined ? (
          <TrendIndicator value={kpi.trend} />
        ) : (
          <div className="h-5" />
        )}
        {points ? (
          <Sparkline points={points} stroke="hsl(var(--primary))" />
        ) : null}
      </div>
    </div>
  );
}

/** Inline trend line for a KPI card. Pure SVG so it costs nothing to render. */
function Sparkline({ points, stroke }: { points: number[]; stroke: string }) {
  const width = 76;
  const height = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const path = points
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 overflow-visible"
      role="img"
      aria-label={`Trend across ${points.length} points, from ${min} to ${max}`}
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrendIndicator({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const rising = value > 0;
  const flat = value === 0;
  const Icon = flat ? ArrowRight : rising ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[13px] font-bold tabular-nums',
        flat
          ? 'text-muted-foreground'
          : rising
            ? 'text-danger'
            : 'text-success',
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {value > 0 ? '+' : ''}
      {value.toFixed(1)}%
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
