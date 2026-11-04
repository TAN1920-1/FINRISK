import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  Bug,
  CalendarClock,
  ClipboardList,
  Clock,
  Flame,
  Gauge,
  Globe,
  Info,
  Layers3,
  Percent,
  PiggyBank,
  ShieldAlert,
  ShieldX,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import type { KpiValue } from '@/types/api';

type KpiTone = 'primary' | 'secondary' | 'success' | 'warning' | 'danger';

const TONE_STYLES: Record<KpiTone, { icon: string; bar: string; stroke: string }> = {
  primary: { icon: 'bg-primary/12 text-primary', bar: 'bg-primary/50', stroke: 'hsl(var(--primary))' },
  secondary: {
    icon: 'bg-secondary/12 text-secondary',
    bar: 'bg-secondary/50',
    stroke: 'hsl(var(--secondary))',
  },
  success: { icon: 'bg-success/12 text-success', bar: 'bg-success/50', stroke: 'hsl(var(--success))' },
  warning: { icon: 'bg-warning/12 text-warning', bar: 'bg-warning/50', stroke: 'hsl(var(--warning))' },
  danger: { icon: 'bg-danger/12 text-danger', bar: 'bg-danger/50', stroke: 'hsl(var(--danger))' },
};

/**
 * Tone and icon per KPI key.
 *
 * The tone is a property of what the metric *means* — critical counts read as
 * danger, overdue counts as warning, money as the blue analytical accent — so
 * the same metric is coloured the same way on every screen.
 */
const KPI_META: Record<string, { icon: LucideIcon; tone: KpiTone }> = {
  total_risks: { icon: Layers3, tone: 'primary' },
  open_risks: { icon: ShieldAlert, tone: 'primary' },
  critical_risks: { icon: Flame, tone: 'danger' },
  high_risks: { icon: AlertTriangle, tone: 'warning' },
  overdue_risks: { icon: Clock, tone: 'warning' },
  expected_gross_exposure: { icon: Banknote, tone: 'secondary' },
  expected_residual_exposure: { icon: PiggyBank, tone: 'secondary' },
  potential_avoided_loss: { icon: TrendingDown, tone: 'success' },
  expected_loss_reduction_pct: { icon: Percent, tone: 'success' },
  open_findings: { icon: Bug, tone: 'primary' },
  critical_findings: { icon: ShieldX, tone: 'danger' },
  assets_total: { icon: Boxes, tone: 'primary' },
  assets_internet_exposed: { icon: Globe, tone: 'warning' },
  mitigations_open: { icon: ClipboardList, tone: 'primary' },
  mitigations_overdue: { icon: CalendarClock, tone: 'warning' },
  risks_created_30d: { icon: Activity, tone: 'secondary' },
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
  const unit = kpi.currency ?? kpi.unit ?? null;
  const display = formatKpiValue(kpi);
  const meta = KPI_META[kpi.key] ?? { icon: Gauge, tone: 'primary' as KpiTone };
  const tone = TONE_STYLES[meta.tone];
  const Icon = meta.icon;
  const points = series && series.length >= 2 ? series : undefined;

  return (
    <div
      className={cn(
        'card card-interactive group relative overflow-hidden p-4',
        className,
      )}
    >
      <span className={cn('absolute inset-x-0 top-0 h-0.5', tone.bar)} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', tone.icon)}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        {kpi.help_text ? (
          <span
            title={kpi.help_text}
            aria-label={kpi.help_text}
            className="cursor-help text-muted transition-colors hover:text-foreground"
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
          </span>
        ) : null}
      </div>

      <p className="mt-3 truncate text-2xs font-medium uppercase tracking-wide text-muted" title={kpi.label}>
        {kpi.label}
      </p>

      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
          {display}
        </span>
        {unit ? <span className="text-xs font-medium text-muted">{unit}</span> : null}
      </div>

      <div className="mt-2 flex min-h-[1.5rem] items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {kpi.trend !== null && kpi.trend !== undefined ? <TrendIndicator value={kpi.trend} /> : null}
          {kpi.is_estimate ? (
            <span
              className="rounded border border-border bg-surface-muted px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted"
              title="Derived from the documented loss model rather than observed data."
            >
              estimate
            </span>
          ) : null}
        </div>
        {points ? <Sparkline points={points} stroke={tone.stroke} /> : null}
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
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium tabular-nums',
        flat
          ? 'border-border bg-surface-muted text-muted'
          : rising
            ? 'border-danger/30 bg-danger/10 text-danger'
            : 'border-success/30 bg-success/10 text-success',
        className,
      )}
      title={`${value > 0 ? '+' : ''}${value.toFixed(1)}% ${suffix}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {value > 0 ? '+' : ''}
      {value.toFixed(1)}%
      <span className="sr-only">{suffix}</span>
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
