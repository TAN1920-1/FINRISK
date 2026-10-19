import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Line,
  LineChart,
  CartesianGrid,
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
 */

const SEVERITY_COLOURS: Record<string, string> = {
  critical: 'hsl(0 72% 52%)',
  high: 'hsl(24 86% 52%)',
  medium: 'hsl(40 88% 48%)',
  low: 'hsl(152 58% 40%)',
};

const PALETTE = [
  'hsl(217 76% 52%)',
  'hsl(178 62% 40%)',
  'hsl(262 60% 58%)',
  'hsl(24 86% 52%)',
  'hsl(152 58% 40%)',
  'hsl(340 65% 52%)',
  'hsl(215 16% 52%)',
];

function colourFor(label: string, index: number): string {
  return SEVERITY_COLOURS[label.toLowerCase()] ?? PALETTE[index % PALETTE.length];
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
    borderRadius: 6,
    fontSize: 12,
    color: 'hsl(var(--foreground))',
  },
  labelStyle: { color: 'hsl(var(--muted-foreground))', fontSize: 11 },
} as const;

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
        <Tooltip {...TOOLTIP_STYLE} formatter={(value: number) => [value, valueLabel]} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
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
        <Tooltip {...TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }} />
        <Bar dataKey="value" name={primaryLabel} fill="hsl(217 76% 52%)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="secondary" name={secondaryLabel} fill="hsl(178 62% 40%)" radius={[3, 3, 0, 0]} />
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
        {secondaryLabel ? (
          <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }} />
        ) : null}
        <Line
          type="monotone"
          dataKey="value"
          name={primaryLabel}
          stroke="hsl(217 76% 52%)"
          strokeWidth={2}
          dot={{ r: 2 }}
        />
        {secondaryLabel ? (
          <Line
            type="monotone"
            dataKey="secondary"
            name={secondaryLabel}
            stroke="hsl(178 62% 40%)"
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={{ r: 2 }}
          />
        ) : null}
      </LineChart>
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
