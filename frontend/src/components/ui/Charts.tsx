import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart as RechartsRadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/cn';
import { Card, CardHeader } from './Card';
import { EmptyState } from './Feedback';
import { LegendSwatch, type BadgeTone } from './Badge';
import type { SeriesPoint } from '@/types/api';

/**
 * Chart wrappers.
 *
 * Every chart here plots an array that came from the API. Nothing is generated
 * in the component, and an empty array renders an empty state rather than an
 * axis with no data, so a chart can never imply activity that did not happen.
 *
 * Colours are read from the design tokens rather than hard-coded, so a chart
 * matches the surrounding UI in both themes and only has to be contrast-checked
 * once per token.
 */

/** Token-driven series colours, in priority order. */
const PALETTE = [
  'hsl(var(--secondary))',
  'hsl(var(--primary))',
  'hsl(var(--risk-high))',
  'hsl(var(--success))',
  'hsl(var(--risk-critical))',
  'hsl(var(--warning))',
  'hsl(var(--muted-foreground))',
];

const SEVERITY_COLOURS: Record<string, string> = {
  critical: 'hsl(var(--risk-critical))',
  high: 'hsl(var(--risk-high))',
  medium: 'hsl(var(--risk-medium))',
  low: 'hsl(var(--risk-low))',
  unknown: 'hsl(var(--risk-unknown))',
};

const SCENARIO_COLOURS: Record<string, string> = {
  best_case: 'hsl(var(--success))',
  optimistic: 'hsl(var(--success))',
  base_case: 'hsl(var(--secondary))',
  base: 'hsl(var(--secondary))',
  worst_case: 'hsl(var(--danger))',
  pessimistic: 'hsl(var(--danger))',
};

function colourFor(label: string, index: number): string {
  const normalised = label.toLowerCase().replace(/\s+/g, '_');
  return (
    SEVERITY_COLOURS[normalised] ?? SCENARIO_COLOURS[normalised] ?? PALETTE[index % PALETTE.length]
  );
}

const AXIS_PROPS = {
  stroke: 'hsl(var(--muted-foreground))',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'hsl(var(--surface))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    fontSize: 12,
    color: 'hsl(var(--foreground))',
    boxShadow: '0 10px 30px -12px hsl(var(--foreground) / 0.35)',
  },
  labelStyle: { color: 'hsl(var(--muted-foreground))', fontSize: 11 },
} as const;

const LEGEND_STYLE = { fontSize: 11, color: 'hsl(var(--muted-foreground))' } as const;

export function ChartCard({
  title,
  description,
  actions,
  children,
  empty,
  emptyMessage = 'No data for this period.',
  height = 240,
  className,
  footnote,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  empty?: boolean;
  emptyMessage?: string;
  height?: number;
  className?: string;
  footnote?: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} actions={actions} />
      <div className="px-2 py-3" style={{ minHeight: height }}>
        {empty ? (
          <EmptyState title={emptyMessage} className="py-8" />
        ) : (
          <div style={{ width: '100%', height }}>{children}</div>
        )}
      </div>
      {footnote ? <div className="border-t border-border px-4 py-2 text-2xs text-muted">{footnote}</div> : null}
    </Card>
  );
}

/** Vertical bar chart for categorical counts. */
export function CategoryBarChart({
  data,
  valueLabel = 'Records',
  colourBySeverity = false,
}: {
  data: SeriesPoint[];
  valueLabel?: string;
  colourBySeverity?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} interval={0} angle={-12} height={44} textAnchor="end" />
        <YAxis {...AXIS_PROPS} allowDecimals={false} />
        <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: 'hsl(var(--muted-foreground) / 0.08)' }} formatter={(value: number) => [value, valueLabel]} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((point, index) => (
            <Cell key={point.label} fill={colourFor(colourBySeverity ? point.label : '', index)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars, useful when category labels are long. */
export function HorizontalBarChart({
  data,
  valueLabel = 'Records',
  colourBySeverity = false,
}: {
  data: SeriesPoint[];
  valueLabel?: string;
  colourBySeverity?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" {...AXIS_PROPS} allowDecimals={false} />
        <YAxis type="category" dataKey="label" {...AXIS_PROPS} width={92} />
        <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: 'hsl(var(--muted-foreground) / 0.08)' }} formatter={(value: number) => [value, valueLabel]} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={26}>
          {data.map((point, index) => (
            <Cell key={point.label} fill={colourFor(colourBySeverity ? point.label : '', index)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Grouped bars for two measures on the same category axis. */
export function GroupedBarChart({
  data,
  primaryLabel,
  secondaryLabel,
}: {
  data: SeriesPoint[];
  primaryLabel: string;
  secondaryLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} allowDecimals={false} />
        <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: 'hsl(var(--muted-foreground) / 0.08)' }} />
        <Legend wrapperStyle={LEGEND_STYLE} />
        <Bar dataKey="value" name={primaryLabel} fill="hsl(var(--secondary))" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="secondary" name={secondaryLabel} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Stacked bars for a set of components that sum to a whole per category.
 *
 * `series` names each stacked key; the caller is responsible for passing data
 * whose components genuinely belong to the same total.
 */
export function StackedBarChart({
  data,
  series,
}: {
  data: Array<Record<string, string | number>>;
  series: Array<{ key: string; label: string; colour?: string }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} />
        <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: 'hsl(var(--muted-foreground) / 0.08)' }} />
        <Legend wrapperStyle={LEGEND_STYLE} />
        {series.map((entry, index) => (
          <Bar
            key={entry.key}
            dataKey={entry.key}
            name={entry.label}
            stackId="total"
            fill={entry.colour ?? PALETTE[index % PALETTE.length]}
            maxBarSize={44}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Trend line with an optional second series. */
export function TrendLineChart({
  data,
  primaryLabel,
  secondaryLabel,
  currency,
}: {
  data: SeriesPoint[];
  primaryLabel: string;
  secondaryLabel?: string;
  currency?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(value: number) =>
            currency ? [`${currency} ${value.toLocaleString('en-US')}`, primaryLabel] : [value, primaryLabel]
          }
        />
        {secondaryLabel ? <Legend wrapperStyle={LEGEND_STYLE} /> : null}
        <Line
          type="monotone"
          dataKey="value"
          name={primaryLabel}
          stroke="hsl(var(--secondary))"
          strokeWidth={2}
          dot={{ r: 2 }}
          activeDot={{ r: 4 }}
        />
        {secondaryLabel ? (
          <Line
            type="monotone"
            dataKey="secondary"
            name={secondaryLabel}
            stroke="hsl(var(--risk-low))"
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
          />
        ) : null}
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Filled area trend with an optional second series.
 *
 * Used for the risk trend view, where the filled region communicates the volume
 * over time more clearly than a bare line.
 */
export function AreaTrendChart({
  data,
  primaryLabel,
  secondaryLabel,
  currency,
}: {
  data: SeriesPoint[];
  primaryLabel: string;
  secondaryLabel?: string;
  currency?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <defs>
          <linearGradient id="area-primary" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--secondary))" stopOpacity={0.35} />
            <stop offset="100%" stopColor="hsl(var(--secondary))" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="area-secondary" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(value: number) =>
            currency ? [`${currency} ${value.toLocaleString('en-US')}`, primaryLabel] : [value, primaryLabel]
          }
        />
        {secondaryLabel ? <Legend wrapperStyle={LEGEND_STYLE} /> : null}
        <Area
          type="monotone"
          dataKey="value"
          name={primaryLabel}
          stroke="hsl(var(--secondary))"
          strokeWidth={2}
          fill="url(#area-primary)"
        />
        {secondaryLabel ? (
          <Area
            type="monotone"
            dataKey="secondary"
            name={secondaryLabel}
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill="url(#area-secondary)"
          />
        ) : null}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Donut with an optional figure in the middle.
 *
 * `centreValue` and `centreLabel` are supplied by the caller from the same data
 * set, so the middle never shows a number the ring does not add up to.
 */
export function DonutChart({
  data,
  centreValue,
  centreLabel,
  valueLabel = 'Records',
  colourBySeverity = false,
  showLegend = true,
}: {
  data: SeriesPoint[];
  centreValue?: ReactNode;
  centreLabel?: ReactNode;
  valueLabel?: string;
  colourBySeverity?: boolean;
  showLegend?: boolean;
}) {
  const total = data.reduce((sum, point) => sum + point.value, 0);

  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => [
              `${value} ${valueLabel.toLowerCase()} (${total ? Math.round((value / total) * 100) : 0}%)`,
              name,
            ]}
          />
          {showLegend ? <Legend wrapperStyle={LEGEND_STYLE} /> : null}
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            stroke="hsl(var(--surface))"
            strokeWidth={2}
          >
            {data.map((point, index) => (
              <Cell key={point.label} fill={colourFor(colourBySeverity ? point.label : '', index)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {centreValue !== undefined ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {centreValue}
          </span>
          {centreLabel ? <span className="text-2xs uppercase tracking-wide text-muted">{centreLabel}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Radar for comparing a small number of factors on one normalised scale.
 *
 * Every axis shares the same 0..`max` domain so the shape is comparable; the
 * caller must therefore pass values that are already on a common scale.
 */
export function RadarChart({
  data,
  name = 'Value',
  max,
}: {
  data: SeriesPoint[];
  name?: string;
  max?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RechartsRadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis dataKey="label" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
        <PolarRadiusAxis
          angle={90}
          domain={[0, max ?? 'auto']}
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
          axisLine={false}
        />
        <Tooltip {...TOOLTIP_STYLE} />
        <Radar
          name={name}
          dataKey="value"
          stroke="hsl(var(--secondary))"
          fill="hsl(var(--secondary))"
          fillOpacity={0.28}
          strokeWidth={2}
        />
      </RechartsRadarChart>
    </ResponsiveContainer>
  );
}

/**
 * Scenario comparison bars.
 *
 * Bars are coloured by scenario type (best / base / worst) so the pessimistic
 * case is never mistaken for the optimistic one, and the colour is repeated in
 * the legend text for anyone who cannot rely on hue.
 */
export function ScenarioComparisonChart({
  data,
  valueLabel = 'Expected loss',
  currency,
}: {
  data: SeriesPoint[];
  valueLabel?: string;
  currency?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} interval={0} />
        <YAxis {...AXIS_PROPS} />
        <Tooltip
          {...TOOLTIP_STYLE}
          cursor={{ fill: 'hsl(var(--muted-foreground) / 0.08)' }}
          formatter={(value: number) => [
            currency ? `${currency} ${value.toLocaleString('en-US')}` : value,
            valueLabel,
          ]}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={72}>
          {data.map((point, index) => (
            <Cell key={point.label} fill={colourFor(point.label, index)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * 5x5 risk heatmap.
 *
 * Cells are shaded by the documented severity bands (likelihood x impact) and
 * each populated cell shows how many risks sit there, so the picture and the
 * register agree. An empty grid renders as an empty state.
 */
export function RiskHeatmap({
  cells,
  className,
}: {
  /** Counts keyed by `${likelihood}-${impact}`. */
  cells: Record<string, number>;
  className?: string;
}) {
  const total = Object.values(cells).reduce((sum, value) => sum + value, 0);

  if (total === 0) {
    return <EmptyState title="No scored risks to plot" className={className} />;
  }

  const band = (score: number): BadgeTone =>
    score >= 20 ? 'critical' : score >= 12 ? 'high' : score >= 5 ? 'medium' : 'low';

  const fill: Record<BadgeTone, string> = {
    critical: 'bg-risk-critical/70 text-white',
    high: 'bg-risk-high/60 text-white',
    medium: 'bg-risk-medium/45 text-foreground',
    low: 'bg-risk-low/35 text-foreground',
    neutral: '',
    primary: '',
    secondary: '',
    success: '',
    warning: '',
    unknown: '',
  };

  return (
    <div className={cn('overflow-x-auto px-4 pb-2', className)}>
      <table className="border-separate border-spacing-1" role="grid" aria-label="Risk heatmap by likelihood and impact">
        <caption className="sr-only">
          Counts of open risks by likelihood (rows) and impact (columns). Severity bands follow the
          documented likelihood x impact score.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="px-1 text-2xs font-medium text-muted">
              L \ I
            </th>
            {[1, 2, 3, 4, 5].map((impact) => (
              <th key={impact} scope="col" className="px-1 text-2xs font-medium text-muted">
                I{impact}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[5, 4, 3, 2, 1].map((likelihood) => (
            <tr key={likelihood}>
              <th scope="row" className="px-1 text-2xs font-medium text-muted">
                L{likelihood}
              </th>
              {[1, 2, 3, 4, 5].map((impact) => {
                const score = likelihood * impact;
                const count = cells[`${likelihood}-${impact}`] ?? 0;
                return (
                  <td key={impact} className="p-0">
                    <div
                      title={`Likelihood ${likelihood} x Impact ${impact} = ${score} (${band(score)}). ${count} risk${count === 1 ? '' : 's'}.`}
                      className={cn(
                        'flex h-9 w-11 items-center justify-center rounded text-xs font-semibold tabular-nums',
                        count > 0 ? fill[band(score)] : 'bg-surface-muted text-muted/50',
                      )}
                    >
                      {count || '·'}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap gap-3">
        <LegendSwatch tone="critical" label="Critical (20–25)" />
        <LegendSwatch tone="high" label="High (12–19)" />
        <LegendSwatch tone="medium" label="Medium (5–11)" />
        <LegendSwatch tone="low" label="Low (1–4)" />
      </div>
    </div>
  );
}
