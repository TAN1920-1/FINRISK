import { Fragment, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  FileDown,
  FileText,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Landing-page product previews.
 *
 * Everything in this module is a *static illustration* of the real application:
 * it mirrors the structure and vocabulary of the actual screens (risk score,
 * severity bands, loss scenarios, currency codes) but the figures are
 * representative examples, not live data. Each preview is therefore captioned
 * "illustrative interface preview" wherever it appears.
 *
 * All paint is token-driven so the previews follow the product palette exactly.
 */

/* ------------------------------------------------------------------ *
 * Chart geometry helpers
 * ------------------------------------------------------------------ */

const CHART = { width: 640, height: 240, left: 48, right: 16, top: 16, bottom: 28 } as const;
const PLOT_WIDTH = CHART.width - CHART.left - CHART.right;
const PLOT_HEIGHT = CHART.height - CHART.top - CHART.bottom;

function xAt(index: number, count: number): number {
  if (count <= 1) return CHART.left;
  return CHART.left + (index / (count - 1)) * PLOT_WIDTH;
}

function yAt(value: number, min: number, max: number): number {
  const span = max - min || 1;
  return CHART.top + (1 - (value - min) / span) * PLOT_HEIGHT;
}

/** Catmull-Rom style smoothing so the line reads as a chart, not a polyline. */
function smoothPath(values: number[], min: number, max: number): string {
  if (values.length === 0) return '';
  const points = values.map((value, index) => ({ x: xAt(index, values.length), y: yAt(value, min, max) }));
  if (points.length < 3) {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  }
  let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    const c1x = current.x + (next.x - previous.x) / 6;
    const c1y = current.y + (next.y - previous.y) / 6;
    const c2x = next.x - (after.x - current.x) / 6;
    const c2y = next.y - (after.y - current.y) / 6;
    path += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${next.x.toFixed(1)},${next.y.toFixed(1)}`;
  }
  return path;
}

function niceMax(values: number[]): number {
  const max = Math.max(...values, 1);
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / magnitude) * magnitude;
}

function compactMoney(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/* ------------------------------------------------------------------ *
 * Shared preview chrome
 * ------------------------------------------------------------------ */

/** The frame every preview sits in: a panel plus an honest caption. */
export function PreviewFrame({
  title,
  meta,
  children,
  footnote = 'Illustrative interface preview',
  className,
  bodyClassName,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  footnote?: string;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn('landing-card p-3 sm:p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="flex gap-1" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-risk-critical/60" />
            <span className="h-2 w-2 rounded-full bg-warning/60" />
            <span className="h-2 w-2 rounded-full bg-success/60" />
          </span>
          <span className="text-xs font-semibold tracking-tight text-foreground">{title}</span>
        </div>
        {meta ? <div className="flex items-center gap-2 text-[10px] text-muted">{meta}</div> : null}
      </div>
      <div className={cn('pt-3', bodyClassName)}>{children}</div>
      {footnote ? (
        <p className="mt-3 border-t border-border pt-2 text-[10px] uppercase tracking-wide text-muted/80">{footnote}</p>
      ) : null}
    </div>
  );
}

export function SeverityChip({ band, className }: { band: 'Critical' | 'High' | 'Moderate' | 'Low'; className?: string }) {
  const styles = {
    Critical: 'bg-risk-critical/15 text-risk-critical border-risk-critical/30',
    High: 'bg-risk-high/15 text-risk-high border-risk-high/30',
    Moderate: 'bg-risk-medium/15 text-risk-medium border-risk-medium/30',
    Low: 'bg-risk-low/15 text-risk-low border-risk-low/30',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        styles[band],
        className,
      )}
    >
      {band}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Small chart primitives
 * ------------------------------------------------------------------ */

/** Slim area sparkline used inside compact stat tiles. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const width = 96;
  const height = 30;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => ({
    x: (index / Math.max(values.length - 1, 1)) * width,
    y: height - ((value - min) / span) * (height - 6) - 3,
  }));
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('h-7 w-24', className)} aria-hidden focusable="false">
      <defs>
        <linearGradient id="landing-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--primary))', stopOpacity: 0.35 }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--primary))', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={area} style={{ fill: 'url(#landing-spark)' }} />
      <path d={line} fill="none" style={{ stroke: 'hsl(var(--primary))' }} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Upright micro bars, used for the severity distribution tiles. */
export function MiniBars({ values, tone }: { values: number[]; tone: 'primary' | 'secondary' | 'danger' }) {
  const max = Math.max(...values, 1);
  const fills = {
    primary: 'hsl(var(--primary) / 0.85)',
    secondary: 'hsl(var(--secondary) / 0.85)',
    danger: 'hsl(var(--risk-critical) / 0.85)',
  } as const;
  return (
    <div className="flex h-8 items-end gap-1" aria-hidden>
      {values.map((value, index) => (
        <span
          key={index}
          className="w-1.5 rounded-sm"
          style={{ height: `${Math.max(12, (value / max) * 100)}%`, background: fills[tone] }}
        />
      ))}
    </div>
  );
}

/** Horizontal progress meter with an accessible label. */
export function Meter({
  label,
  value,
  max = 100,
  tone = 'primary',
}: {
  label: string;
  value: number;
  max?: number;
  tone?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
}) {
  const percent = Math.round((value / max) * 100);
  const fills = {
    primary: 'hsl(var(--primary))',
    secondary: 'hsl(var(--secondary))',
    success: 'hsl(var(--success))',
    warning: 'hsl(var(--warning))',
    danger: 'hsl(var(--risk-critical))',
  } as const;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
        <span className="text-[11px] font-semibold tabular-nums text-foreground">{value}</span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-raised"
        role="img"
        aria-label={`${label}: ${percent}%`}
      >
        <div className="h-full rounded-full" style={{ width: `${percent}%`, background: fills[tone] }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Hero dashboard preview
 * ------------------------------------------------------------------ */

/**
 * The hero preview: a layered, enterprise-looking slice of the real dashboard.
 * It surfaces the score, the distribution, the loss scenario, vulnerability and
 * vendor panels and the prioritisation list, because those are what the product
 * is actually for.
 */
export function DashboardPreview() {
  const lossValues = [820000, 880000, 860000, 940000, 1020000, 990000, 1090000, 1160000, 1120000, 1240000, 1310000, 1380000];
  const lossMax = niceMax(lossValues);
  const lossLine = smoothPath(lossValues, 0, lossMax);
  const lossArea = `${lossLine} L${CHART.left + PLOT_WIDTH},${CHART.top + PLOT_HEIGHT} L${CHART.left},${CHART.top + PLOT_HEIGHT} Z`;

  return (
    <div className="relative">
      <div
        aria-hidden
        className="landing-aurora pointer-events-none absolute -inset-10 -z-10 rounded-full opacity-70 blur-2xl animate-pulse-soft"
      />

      <PreviewFrame
        title="Risk Overview"
        meta={
          <>
            <span className="rounded bg-surface-raised px-1.5 py-0.5">Demo Risk Org</span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
              Live
            </span>
          </>
        }
      >
        {/* Score + headline metrics */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-border bg-surface-raised/60 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted">Risk score</p>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">68</span>
              <span className="pb-1 text-[10px] text-muted">/ 100</span>
            </div>
            <SeverityChip band="High" className="mt-2" />
          </div>
          <div className="rounded-xl border border-border bg-surface-raised/60 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted">Open risks</p>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">148</span>
              <span className="inline-flex items-center pb-1 text-[10px] text-warning">
                <ArrowUpRight className="h-3 w-3" aria-hidden />12
              </span>
            </div>
            <MiniBars values={[6, 9, 7, 11, 8, 12, 10]} tone="primary" />
          </div>
          <div className="rounded-xl border border-border bg-surface-raised/60 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted">Critical findings</p>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-risk-critical">12</span>
              <span className="pb-1 text-[10px] text-muted">open</span>
            </div>
            <div className="mt-2 flex gap-1">
              <span className="h-1.5 flex-1 rounded-full bg-risk-critical/80" />
              <span className="h-1.5 flex-1 rounded-full bg-risk-high/70" />
              <span className="h-1.5 flex-1 rounded-full bg-risk-medium/50" />
              <span className="h-1.5 flex-1 rounded-full bg-risk-low/40" />
            </div>
          </div>
        </div>

        {/* Loss scenario + distribution */}
        <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-xl border border-border bg-surface-raised/40 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-foreground">Financial loss scenario</p>
                <p className="text-[10px] text-muted">Base case · USD</p>
              </div>
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">12 months</span>
            </div>
            <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} className="mt-2 w-full" aria-hidden focusable="false">
              <defs>
                <linearGradient id="landing-hero-loss" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: 'hsl(var(--secondary))', stopOpacity: 0.4 }} />
                  <stop offset="100%" style={{ stopColor: 'hsl(var(--secondary))', stopOpacity: 0 }} />
                </linearGradient>
              </defs>
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
                const y = CHART.top + fraction * PLOT_HEIGHT;
                return (
                  <line
                    key={fraction}
                    x1={CHART.left}
                    x2={CHART.left + PLOT_WIDTH}
                    y1={y}
                    y2={y}
                    style={{ stroke: 'hsl(var(--border))' }}
                    strokeDasharray="3 4"
                  />
                );
              })}
              {[0, 0.5, 1].map((fraction) => (
                <text
                  key={fraction}
                  x={CHART.left - 8}
                  y={CHART.top + (1 - fraction) * PLOT_HEIGHT + 3}
                  textAnchor="end"
                  style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                >
                  {compactMoney(fraction * lossMax)}
                </text>
              ))}
              <path d={lossArea} style={{ fill: 'url(#landing-hero-loss)' }} />
              <path
                d={lossLine}
                fill="none"
                style={{ stroke: 'hsl(var(--secondary))' }}
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>

          <div className="rounded-xl border border-border bg-surface-raised/40 p-3">
            <p className="text-[11px] font-semibold text-foreground">Risk distribution</p>
            <div className="mt-3 space-y-2.5">
              <Meter label="Critical" value={12} max={148} tone="danger" />
              <Meter label="High" value={31} max={148} tone="warning" />
              <Meter label="Moderate" value={58} max={148} tone="primary" />
              <Meter label="Low" value={47} max={148} tone="success" />
            </div>
          </div>
        </div>

        {/* Vulnerability, vendor and prioritisation panels */}
        <div className="mt-3 hidden gap-3 sm:grid sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface-raised/40 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
              <ShieldAlert className="h-3.5 w-3.5 text-risk-critical" aria-hidden />
              Vulnerability tracking
            </p>
            <ul className="mt-2 space-y-1.5">
              {[
                { label: 'RCE · external', band: 'Critical' as const },
                { label: 'TLS configuration', band: 'High' as const },
                { label: 'Outdated library', band: 'Moderate' as const },
              ].map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] text-muted">{row.label}</span>
                  <SeverityChip band={row.band} />
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-surface-raised/40 p-3">
            <p className="text-[11px] font-semibold text-foreground">Vendor assessment</p>
            <ul className="mt-2 space-y-2">
              {[
                { label: 'Cloud provider', score: 82 },
                { label: 'Payments vendor', score: 64 },
                { label: 'Managed IT', score: 47 },
              ].map((row) => (
                <li key={row.label}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[10px] text-muted">{row.label}</span>
                    <span className="text-[10px] font-semibold tabular-nums text-foreground">{row.score}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${row.score}%`, background: 'hsl(var(--primary))' }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-surface-raised/40 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
              <TrendingUp className="h-3.5 w-3.5 text-primary" aria-hidden />
              Prioritisation
            </p>
            <ol className="mt-2 space-y-1.5">
              {[
                { rank: 1, label: 'Customer data breach', band: 'Critical' as const },
                { rank: 2, label: 'Payment outage', band: 'High' as const },
                { rank: 3, label: 'Vendor SLA gap', band: 'High' as const },
              ].map((row) => (
                <li key={row.rank} className="flex items-center gap-2">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-surface text-[9px] font-semibold text-muted">
                    {row.rank}
                  </span>
                  <span className="truncate text-[10px] text-muted">{row.label}</span>
                  <SeverityChip band={row.band} className="ml-auto shrink-0" />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </PreviewFrame>

      {/* Floating accent cards. Hidden below xl so they never cause overflow. */}
      <div className="pointer-events-none absolute -left-6 top-24 hidden animate-float xl:block">
        <div className="rounded-xl border border-border bg-surface/95 px-3 py-2 shadow-raised backdrop-blur">
          <p className="text-[9px] uppercase tracking-wide text-muted">Currency integrity</p>
          <p className="mt-0.5 text-[11px] font-semibold text-foreground">USD · EUR kept separate</p>
        </div>
      </div>
      <div className="pointer-events-none absolute -right-5 bottom-24 hidden animate-float-slow xl:block">
        <div className="rounded-xl border border-border bg-surface/95 px-3 py-2 shadow-raised backdrop-blur">
          <p className="text-[9px] uppercase tracking-wide text-muted">Scoring rule</p>
          <p className="mt-0.5 text-[11px] font-semibold text-foreground">L×I shown with every score</p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Interactive scenario chart (financial showcase)
 * ------------------------------------------------------------------ */

const SCENARIO_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SCENARIOS = [
  {
    key: 'best',
    label: 'Best case',
    colour: 'hsl(var(--success))',
    values: [470000, 455000, 480000, 465000, 500000, 490000, 515000, 505000, 520000, 510000, 530000, 525000],
  },
  {
    key: 'base',
    label: 'Base case',
    colour: 'hsl(var(--primary))',
    values: [820000, 845000, 815000, 880000, 905000, 890000, 940000, 965000, 950000, 990000, 1010000, 1040000],
  },
  {
    key: 'adverse',
    label: 'Adverse case',
    colour: 'hsl(var(--secondary))',
    values: [1180000, 1210000, 1240000, 1300000, 1340000, 1380000, 1420000, 1460000, 1500000, 1540000, 1590000, 1640000],
  },
  {
    key: 'worst',
    label: 'Worst case',
    colour: 'hsl(var(--risk-critical))',
    values: [1720000, 1760000, 1820000, 1880000, 1950000, 2020000, 2100000, 2180000, 2260000, 2340000, 2420000, 2510000],
  },
] as const;

/**
 * Scenario explorer with toggleable series and a hover tooltip.
 *
 * The chart plots user-supplied assumptions, so the caption states plainly that
 * the figures are scenario arithmetic rather than forecasts.
 */
export function ScenarioLineChart() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ best: false, base: true, adverse: true, worst: false });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // Normalised to a number so the JSX below never has to re-narrow a nullable state.
  const hoveredIndex = hoverIndex ?? -1;

  const visible = SCENARIOS.filter((scenario) => enabled[scenario.key]);
  const domain = useMemo(() => {
    const pool = visible.length > 0 ? visible.flatMap((scenario) => [...scenario.values]) : [1000000];
    return niceMax(pool);
  }, [visible]);

  const toggle = (key: string) => {
    setEnabled((current) => {
      const next = { ...current, [key]: !current[key] };
      // Never leave the chart empty: the last enabled series stays on.
      return Object.values(next).some(Boolean) ? next : current;
    });
  };

  const handleMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    const viewX = fraction * CHART.width;
    const ratio = (viewX - CHART.left) / PLOT_WIDTH;
    const index = Math.round(ratio * (SCENARIO_MONTHS.length - 1));
    setHoverIndex(Math.min(Math.max(index, 0), SCENARIO_MONTHS.length - 1));
  };

  return (
    <PreviewFrame
      title="Financial scenario explorer"
      meta={<span className="rounded bg-surface-raised px-1.5 py-0.5">USD</span>}
      footnote="Scenario arithmetic from entered assumptions — not a forecast"
    >
      <div className="flex flex-wrap gap-1.5">
        {SCENARIOS.map((scenario) => (
          <button
            key={scenario.key}
            type="button"
            aria-pressed={enabled[scenario.key]}
            onClick={() => toggle(scenario.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors duration-200',
              enabled[scenario.key]
                ? 'border-border-strong bg-surface-raised text-foreground'
                : 'border-border text-muted hover:text-foreground',
            )}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: scenario.colour, opacity: enabled[scenario.key] ? 1 : 0.4 }}
              aria-hidden
            />
            {scenario.label}
          </button>
        ))}
      </div>

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
          className="w-full"
          role="img"
          aria-label="Scenario comparison of potential financial loss across twelve months"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            {SCENARIOS.map((scenario) => (
              <linearGradient key={scenario.key} id={`landing-area-${scenario.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: scenario.colour, stopOpacity: 0.28 }} />
                <stop offset="100%" style={{ stopColor: scenario.colour, stopOpacity: 0 }} />
              </linearGradient>
            ))}
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const y = CHART.top + fraction * PLOT_HEIGHT;
            return (
              <Fragment key={fraction}>
                <line
                  x1={CHART.left}
                  x2={CHART.left + PLOT_WIDTH}
                  y1={y}
                  y2={y}
                  style={{ stroke: 'hsl(var(--border))' }}
                  strokeDasharray="3 4"
                />
                <text
                  x={CHART.left - 8}
                  y={y + 3}
                  textAnchor="end"
                  style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                >
                  {compactMoney(fraction * domain)}
                </text>
              </Fragment>
            );
          })}

          {SCENARIO_MONTHS.map((month, index) =>
            index % 2 === 0 ? (
              <text
                key={month}
                x={xAt(index, SCENARIO_MONTHS.length)}
                y={CHART.height - 8}
                textAnchor="middle"
                style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
              >
                {month}
              </text>
            ) : null,
          )}

          {visible.map((scenario) => {
            const line = smoothPath([...scenario.values], 0, domain);
            return (
              <Fragment key={scenario.key}>
                <path
                  d={`${line} L${CHART.left + PLOT_WIDTH},${CHART.top + PLOT_HEIGHT} L${CHART.left},${CHART.top + PLOT_HEIGHT} Z`}
                  style={{ fill: `url(#landing-area-${scenario.key})` }}
                />
                <path
                  d={line}
                  fill="none"
                  style={{ stroke: scenario.colour }}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </Fragment>
            );
          })}

          {hoveredIndex >= 0 ? (
            <g>
              <line
                x1={xAt(hoveredIndex, SCENARIO_MONTHS.length)}
                x2={xAt(hoveredIndex, SCENARIO_MONTHS.length)}
                y1={CHART.top}
                y2={CHART.top + PLOT_HEIGHT}
                style={{ stroke: 'hsl(var(--border-strong))' }}
              />
              {visible.map((scenario) => (
                <circle
                  key={scenario.key}
                  cx={xAt(hoveredIndex, SCENARIO_MONTHS.length)}
                  cy={yAt(scenario.values[hoveredIndex], 0, domain)}
                  r="3.5"
                  style={{ fill: scenario.colour, stroke: 'hsl(var(--surface))' }}
                  strokeWidth="2"
                />
              ))}
            </g>
          ) : null}
        </svg>

        {hoveredIndex >= 0 ? (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[9.5rem] -translate-x-1/2 rounded-lg border border-border bg-surface/95 p-2.5 shadow-raised backdrop-blur"
            style={{
              left: `${Math.min(Math.max((xAt(hoveredIndex, SCENARIO_MONTHS.length) / CHART.width) * 100, 14), 86)}%`,
            }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              {SCENARIO_MONTHS[hoveredIndex]}
            </p>
            <ul className="mt-1 space-y-0.5">
              {visible.map((scenario) => (
                <li key={scenario.key} className="flex items-center justify-between gap-3 text-[10px]">
                  <span className="flex items-center gap-1.5 text-muted">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: scenario.colour }} aria-hidden />
                    {scenario.label}
                  </span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {compactMoney(scenario.values[hoveredIndex])}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </PreviewFrame>
  );
}

/* ------------------------------------------------------------------ *
 * Interactive risk matrix
 * ------------------------------------------------------------------ */

const BAND_LABELS = ['Low', 'Moderate', 'High', 'Critical'] as const;
type BandLabel = (typeof BAND_LABELS)[number];

function bandFor(score: number): BandLabel {
  if (score >= 20) return 'Critical';
  if (score >= 12) return 'High';
  if (score >= 5) return 'Moderate';
  return 'Low';
}

const BAND_FILL: Record<BandLabel, string> = {
  Low: 'bg-risk-low/25 hover:bg-risk-low/40',
  Moderate: 'bg-risk-medium/30 hover:bg-risk-medium/50',
  High: 'bg-risk-high/45 hover:bg-risk-high/65',
  Critical: 'bg-risk-critical/60 hover:bg-risk-critical/80',
};

/**
 * 5x5 likelihood × impact heatmap with an inspection panel.
 *
 * Hovering or focusing a cell reports its likelihood, impact, resulting score
 * and severity band, which is the same rule the product applies when it scores a
 * risk record.
 */
export function RiskMatrix() {
  const [cell, setCell] = useState<{ likelihood: number; impact: number } | null>(null);
  const score = cell ? cell.likelihood * cell.impact : null;
  const band = score !== null ? bandFor(score) : null;

  return (
    <div className="landing-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-tight text-foreground">Likelihood × Impact matrix</p>
          <p className="mt-0.5 text-xs text-muted">Hover a cell to inspect the score and band.</p>
        </div>
        <div
          className="min-w-[10.5rem] rounded-lg border border-border bg-surface-raised/60 px-3 py-2 text-right"
          aria-live="polite"
        >
          {cell && score !== null && band ? (
            <>
              <p className="text-[10px] uppercase tracking-wide text-muted">
                L{cell.likelihood} × I{cell.impact}
              </p>
              <p className="mt-0.5 flex items-center justify-end gap-2">
                <span className="text-lg font-semibold tabular-nums text-foreground">{score}</span>
                <SeverityChip band={band} />
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted">No cell selected</p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between pl-8 text-[10px] uppercase tracking-wide text-muted">
          <span>Likelihood ↑</span>
          <span>Impact →</span>
        </div>
        <div className="grid grid-cols-[1.5rem_repeat(5,minmax(0,1fr))] gap-1.5">
          {[5, 4, 3, 2, 1].map((likelihood) => (
            <Fragment key={likelihood}>
              <span className="flex items-center justify-center text-[10px] font-medium text-muted">{likelihood}</span>
              {[1, 2, 3, 4, 5].map((impact) => {
                const cellScore = likelihood * impact;
                const cellBand = bandFor(cellScore);
                const selected = cell?.likelihood === likelihood && cell?.impact === impact;
                return (
                  <button
                    key={impact}
                    type="button"
                    onMouseEnter={() => setCell({ likelihood, impact })}
                    onFocus={() => setCell({ likelihood, impact })}
                    onMouseLeave={() => setCell(null)}
                    onBlur={() => setCell(null)}
                    aria-label={`Likelihood ${likelihood}, impact ${impact}: score ${cellScore}, ${cellBand} band`}
                    className={cn(
                      'flex h-9 items-center justify-center rounded text-[11px] font-semibold tabular-nums text-foreground transition-[background-color,box-shadow,transform] duration-150 sm:h-10',
                      BAND_FILL[cellBand],
                      selected && 'scale-[1.06] ring-2 ring-primary ring-offset-2 ring-offset-surface',
                    )}
                  >
                    {cellScore}
                  </button>
                );
              })}
            </Fragment>
          ))}
          <span aria-hidden />
          {[1, 2, 3, 4, 5].map((impact) => (
            <span key={impact} className="text-center text-[10px] font-medium text-muted">
              {impact}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-3">
        {BAND_LABELS.map((label) => (
          <span key={label} className="flex items-center gap-1.5 text-[10px] text-muted">
            <span className={cn('h-2.5 w-2.5 rounded-sm', BAND_FILL[label].split(' ')[0])} aria-hidden />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * ML prioritisation card
 * ------------------------------------------------------------------ */

const ATTRIBUTIONS = [
  { label: 'Likelihood', weight: 0.34 },
  { label: 'Impact', weight: 0.28 },
  { label: 'Asset criticality', weight: 0.22 },
  { label: 'Control coverage', weight: 0.16 },
];

/**
 * Prioritisation card.
 *
 * The fallback state is shown explicitly because the model only trains once the
 * register holds enough scored rows; below that threshold prioritisation uses
 * the documented likelihood × impact rule.
 */
export function MlInsightsCard() {
  return (
    <div className="landing-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-tight text-foreground">Prioritisation model</p>
          <p className="mt-0.5 text-xs text-muted">Optional machine-learning assistance</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[10px] font-medium text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
          Rule-based baseline
        </span>
      </div>

      <div className="mt-4 flex items-center gap-4 rounded-xl border border-border bg-surface-raised/50 p-3">
        <div className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90" aria-hidden focusable="false">
            <circle cx="18" cy="18" r="15.5" fill="none" style={{ stroke: 'hsl(var(--border))' }} strokeWidth="3.5" />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              style={{ stroke: 'hsl(var(--primary))' }}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray={`${(82 / 100) * 97.4} 97.4`}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-base font-semibold tabular-nums text-foreground">
            82
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-muted">Prioritisation indicator</p>
          <p className="mt-0.5 flex items-center gap-2">
            <SeverityChip band="Critical" />
            <span className="text-xs text-muted">Highest-ranked open risk</span>
          </p>
          <p className="mt-1 truncate text-xs text-foreground">Third-party · Operational</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[10px] uppercase tracking-wide text-muted">Feature attribution</p>
        <ul className="mt-2 space-y-2">
          {ATTRIBUTIONS.map((item) => (
            <li key={item.label}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-muted">{item.label}</span>
                <span className="text-[11px] font-semibold tabular-nums text-foreground">
                  {(item.weight * 100).toFixed(0)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-raised">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${item.weight * 100}%`, background: 'hsl(var(--secondary))' }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-surface-raised/40 p-2.5">
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        <p className="text-[11px] leading-relaxed text-muted">
          Falls back to the documented <span className="text-foreground">likelihood × impact</span> rule when the
          register does not yet hold enough scored rows to train.
        </p>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-muted/80">
        Model outputs reflect the organization&apos;s scoring convention and are not calibrated real-world
        probabilities or causal explanations.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * External intelligence panel
 * ------------------------------------------------------------------ */

const SOURCES = [
  { name: 'NVD', detail: 'National Vulnerability Database' },
  { name: 'CISA KEV', detail: 'Known Exploited Vulnerabilities' },
  { name: 'Public DNS', detail: 'Record and resolution checks' },
  { name: 'Ransomwatch', detail: 'Public listing references' },
];

const FINDINGS = [
  { id: 'CVE-2024-XXXX', title: 'Remote code execution', band: 'Critical' as const, status: 'Open' },
  { id: 'CVE-2024-XXXX', title: 'Improper certificate validation', band: 'High' as const, status: 'In remediation' },
  { id: 'CVE-2024-XXXX', title: 'Information disclosure', band: 'Moderate' as const, status: 'Resolved' },
];

/** Advisory external checks, presented as a request-driven workflow. */
export function ThreatIntelPanel() {
  return (
    <PreviewFrame
      title="External checks"
      meta={<span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px]">Run on request</span>}
      footnote="Advisory results depend on the availability of each source"
    >
      <div className="grid grid-cols-2 gap-2">
        {SOURCES.map((source) => (
          <div key={source.name} className="rounded-lg border border-border bg-surface-raised/40 p-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-soft" aria-hidden />
              {source.name}
            </p>
            <p className="mt-0.5 text-[10px] leading-snug text-muted">{source.detail}</p>
          </div>
        ))}
      </div>

      <ul className="mt-3 space-y-2">
        {FINDINGS.map((finding, index) => (
          <li
            key={`${finding.title}-${index}`}
            className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised/40 px-3 py-2"
          >
            <AlertTriangle
              className={cn(
                'h-4 w-4 shrink-0',
                finding.band === 'Critical' ? 'text-risk-critical' : finding.band === 'High' ? 'text-risk-high' : 'text-risk-medium',
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium text-foreground">{finding.title}</p>
              <p className="text-[10px] text-muted">{finding.id}</p>
            </div>
            <SeverityChip band={finding.band} />
            <span className="hidden w-24 shrink-0 text-right text-[10px] text-muted sm:block">{finding.status}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 rounded-lg border border-border bg-surface-raised/40 p-3">
        <p className="text-[10px] uppercase tracking-wide text-muted">Vendor scan</p>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <span className="text-[11px] text-foreground">Managed IT Services</span>
          <span className="text-[10px] text-muted">2 findings · 1 open</span>
        </div>
        <div className="mt-2">
          <Meter label="Remediation progress" value={64} tone="primary" />
        </div>
      </div>
    </PreviewFrame>
  );
}

/* ------------------------------------------------------------------ *
 * Report preview
 * ------------------------------------------------------------------ */

/** A document-shaped preview of the exported risk report. */
export function ReportPreview() {
  return (
    <div className="landing-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-primary">Organizational Risk Report</p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-foreground">Demo Risk Org</h3>
          <p className="text-[11px] text-muted">Reporting period · 01 Jan – 31 Dec · Generated on request</p>
        </div>
        <div className="flex gap-1.5">
          <span className="inline-flex items-center gap-1 rounded border border-border bg-surface-raised px-2 py-1 text-[10px] font-medium text-muted">
            <FileText className="h-3 w-3" aria-hidden />PDF
          </span>
          <span className="inline-flex items-center gap-1 rounded border border-border bg-surface-raised px-2 py-1 text-[10px] font-medium text-muted">
            <FileDown className="h-3 w-3" aria-hidden />CSV
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">Risk summary</p>
          <dl className="mt-2 grid grid-cols-3 gap-2">
            {[
              { label: 'Total', value: '148' },
              { label: 'Open', value: '96' },
              { label: 'Critical', value: '12' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-border bg-surface-raised/40 p-2.5">
                <dt className="text-[10px] text-muted">{stat.label}</dt>
                <dd className="text-lg font-semibold tabular-nums text-foreground">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">Severity breakdown</p>
          <div className="mt-2 space-y-2">
            <Meter label="Critical" value={12} max={148} tone="danger" />
            <Meter label="High" value={31} max={148} tone="warning" />
            <Meter label="Moderate" value={58} max={148} tone="primary" />
            <Meter label="Low" value={47} max={148} tone="success" />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface-raised/40 p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted">Financial scenario summary</p>
          <ul className="mt-2 space-y-1.5">
            {[
              { label: 'Base case expected loss', currency: 'USD', value: '1,040,000' },
              { label: 'Adverse case', currency: 'EUR', value: '870,000' },
              { label: 'Avoided loss (avoided)', currency: 'USD', value: '310,000' },
            ].map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="truncate text-muted">{row.label}</span>
                <span className="shrink-0 font-semibold tabular-nums text-foreground">
                  <span className="mr-1 text-[10px] font-normal text-muted">{row.currency}</span>
                  {row.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-border bg-surface-raised/40 p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted">Vulnerability & mitigation</p>
          <ul className="mt-2 space-y-1.5">
            {[
              { label: 'Findings open', value: '23' },
              { label: 'Findings resolved', value: '41' },
              { label: 'Mitigations in progress', value: '18' },
              { label: 'Mitigations overdue', value: '3' },
            ].map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="truncate text-muted">{row.label}</span>
                <span className="font-semibold tabular-nums text-foreground">{row.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-4 border-t border-border pt-3 text-[10px] uppercase tracking-wide text-muted/80">
        Illustrative interface preview · PDF layout is fixed with no custom branding
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Small illustrative visuals for the capability cards
 * ------------------------------------------------------------------ */

/** Register rows: severity dot, title and score. */
export function MiniRegisterVisual() {
  return (
    <div className="space-y-1.5" aria-hidden>
      {[
        { label: 'Data breach', band: 'Critical' as const, score: 24 },
        { label: 'Payment outage', band: 'High' as const, score: 16 },
        { label: 'Vendor SLA gap', band: 'Moderate' as const, score: 9 },
      ].map((row) => (
        <div key={row.label} className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised/40 px-2.5 py-1.5">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              row.band === 'Critical' ? 'bg-risk-critical' : row.band === 'High' ? 'bg-risk-high' : 'bg-risk-medium',
            )}
          />
          <span className="flex-1 truncate text-[11px] text-muted">{row.label}</span>
          <span className="text-[11px] font-semibold tabular-nums text-foreground">{row.score}</span>
        </div>
      ))}
    </div>
  );
}

/** Loss curve mini-visual with a values axis. */
export function MiniLossVisual() {
  const values = [30, 42, 38, 55, 62, 58, 74, 88];
  return (
    <div className="rounded-lg border border-border bg-surface-raised/40 p-2.5" aria-hidden>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted">USD</span>
        <span className="text-[11px] font-semibold tabular-nums text-foreground">1,040,000</span>
      </div>
      <Sparkline values={values} className="mt-1.5 h-8 w-full" />
    </div>
  );
}

/** Severity chips row. */
export function MiniSeverityVisual() {
  return (
    <div className="flex flex-wrap gap-1.5" aria-hidden>
      {(['Critical', 'High', 'Moderate', 'Low'] as const).map((band) => (
        <SeverityChip key={band} band={band} />
      ))}
      <span className="inline-flex items-center rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-muted">
        Resolved
      </span>
    </div>
  );
}

/** Vendor score dial. */
export function MiniVendorVisual() {
  const score = 78;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised/40 p-2.5" aria-hidden>
      <div className="relative h-12 w-12 shrink-0">
        <svg viewBox="0 0 36 36" className="h-12 w-12 -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" style={{ stroke: 'hsl(var(--border))' }} strokeWidth="3.5" />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            style={{ stroke: 'hsl(var(--primary))' }}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 97.4} 97.4`}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums text-foreground">
          {score}
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] text-foreground">Managed IT Services</p>
        <p className="text-[10px] text-muted">TILT · Cloud questionnaire</p>
      </div>
    </div>
  );
}

/** Intelligence source pills. */
export function MiniSourceVisual() {
  return (
    <div className="flex flex-wrap gap-1.5" aria-hidden>
      {['NVD', 'CISA KEV', 'Public DNS', 'Ransomwatch'].map((source) => (
        <span
          key={source}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2 py-1 text-[10px] text-muted"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-soft" />
          {source}
        </span>
      ))}
    </div>
  );
}

/** Export file chips. */
export function MiniExportVisual() {
  return (
    <div className="flex gap-2" aria-hidden>
      {[
        { label: 'risk-report.pdf', icon: FileText },
        { label: 'risk-register.csv', icon: FileDown },
      ].map((file) => (
        <span
          key={file.label}
          className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-surface-raised/40 px-2.5 py-2 text-[10px] text-muted"
        >
          <file.icon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">{file.label}</span>
        </span>
      ))}
    </div>
  );
}
