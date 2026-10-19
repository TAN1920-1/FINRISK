import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { humanise } from '@/lib/format';
import type { Severity } from '@/types/api';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'secondary'
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'unknown';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-border bg-surface-muted text-muted',
  primary: 'border-primary/30 bg-primary-muted text-primary',
  secondary: 'border-secondary/30 bg-secondary/10 text-secondary',
  critical: 'border-risk-critical/40 bg-risk-critical/10 text-risk-critical',
  high: 'border-risk-high/40 bg-risk-high/10 text-risk-high',
  medium: 'border-risk-medium/40 bg-risk-medium/15 text-risk-medium',
  low: 'border-risk-low/40 bg-risk-low/10 text-risk-low',
  unknown: 'border-border-strong bg-surface-muted text-muted',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const SEVERITY_TONE: Record<Severity, BadgeTone> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

/**
 * A severity is always shown with its label, never by colour alone, so the
 * badge stays readable for a colour-blind reader and in a greyscale print-out.
 */
export function SeverityBadge({
  severity,
  className,
  suffix,
}: {
  severity: Severity | string | null | undefined;
  className?: string;
  suffix?: string;
}) {
  const key = (severity ?? '').toLowerCase();
  const tone = (SEVERITY_TONE as Record<string, BadgeTone>)[key] ?? 'unknown';
  return (
    <Badge tone={tone} className={className}>
      {severity ? humanise(severity) : 'Not assessed'}
      {suffix ? ` ${suffix}` : ''}
    </Badge>
  );
}

/** A neutral status pill for lifecycle values such as `in_progress`. */
export function StatusBadge({
  status,
  tone,
  className,
}: {
  status: string | null | undefined;
  tone?: BadgeTone;
  className?: string;
}) {
  if (!status) return <Badge tone="unknown" className={className}>Unknown</Badge>;
  return (
    <Badge tone={tone ?? 'neutral'} className={className}>
      {humanise(status)}
    </Badge>
  );
}

const BAND_TONE: Record<string, string> = {
  critical: 'bg-risk-critical',
  high: 'bg-risk-high',
  medium: 'bg-risk-medium',
  low: 'bg-risk-low',
};

/**
 * Inherent risk score (likelihood x impact, 1..25) with its band.
 *
 * The numeric score is always rendered, because the colour is a convenience and
 * the number is the actual value.
 */
export function RiskScore({
  score,
  severity,
  size = 'md',
  className,
  label,
}: {
  score: number | null | undefined;
  severity?: Severity | string | null;
  size?: 'sm' | 'md';
  className?: string;
  label?: string;
}) {
  if (score === null || score === undefined) {
    return (
      <span
        className={cn('text-xs text-muted', className)}
        title="No score has been recorded for this record."
      >
        Not assessed
      </span>
    );
  }

  const tone = BAND_TONE[(severity ?? '').toLowerCase()] ?? 'bg-risk-unknown';

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className={cn(
          'inline-flex items-center justify-center rounded font-semibold tabular-nums text-white',
          tone,
          size === 'sm' ? 'h-5 min-w-[1.25rem] px-1 text-2xs' : 'h-6 min-w-[1.75rem] px-1.5 text-xs',
        )}
        aria-label={label ? `${label}: ${score} of 25` : `Risk score ${score} of 25`}
      >
        {score}
      </span>
      <span className="text-2xs text-muted">/25</span>
    </span>
  );
}

/** Small coloured dot + label for chart legends. */
export function LegendSwatch({ tone, label }: { tone: BadgeTone; label: string }) {
  const swatch = {
    critical: 'bg-risk-critical',
    high: 'bg-risk-high',
    medium: 'bg-risk-medium',
    low: 'bg-risk-low',
    unknown: 'bg-risk-unknown',
    neutral: 'bg-border-strong',
    primary: 'bg-primary',
    secondary: 'bg-secondary',
  }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs text-muted">
      <span className={cn('h-2 w-2 rounded-sm', swatch)} aria-hidden />
      {label}
    </span>
  );
}
