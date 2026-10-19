/**
 * Presentation helpers.
 *
 * Two rules govern everything here:
 *
 * * **Money is never converted.** A decimal string is formatted with the
 *   currency it arrived with. If two figures have different currency codes the
 *   caller must not add them, and no helper in this file will do it silently.
 * * **A missing value is shown as missing.** `null` renders as an em dash, never
 *   as `0`, because "not estimated" and "no loss" are different statements.
 */

import type { FilterOption } from '@/types/api';

const EM_DASH = '—';

export function formatMoney(
  value: string | number | null | undefined,
  currency = 'USD',
  options: { compact?: boolean; maximumFractionDigits?: number } = {},
): string {
  if (value === null || value === undefined || value === '') return EM_DASH;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return `${value} ${currency}`;

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: options.compact ? 'compact' : 'standard',
    maximumFractionDigits: options.maximumFractionDigits ?? (options.compact ? 1 : 0),
    minimumFractionDigits: 0,
  });
  return formatter.format(numeric);
}

export function formatNumber(
  value: number | string | null | undefined,
  options: { maximumFractionDigits?: number; compact?: boolean } = {},
): string {
  if (value === null || value === undefined || value === '') return EM_DASH;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat('en-US', {
    notation: options.compact ? 'compact' : 'standard',
    maximumFractionDigits: options.maximumFractionDigits ?? 0,
  }).format(numeric);
}

export function formatPercent(
  value: number | null | undefined,
  fractionDigits = 0,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatPercentValue(
  value: number | null | undefined,
  fractionDigits = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return `${value.toFixed(fractionDigits)}%`;
}

/** Format an ISO-8601 timestamp in the viewer's locale, or a dash when absent. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return EM_DASH;
  const date = parseApiDate(value);
  if (!date) return EM_DASH;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return EM_DASH;
  const date = parseApiDate(value);
  if (!date) return EM_DASH;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start && !end) return 'All time';
  return `${start ? formatDate(start) : 'Start'} – ${end ? formatDate(end) : 'Today'}`;
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return EM_DASH;
  const date = parseApiDate(value);
  if (!date) return EM_DASH;

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(seconds, 'second');
}

/**
 * The API serialises UTC timestamps with an explicit offset. A value without an
 * offset is treated as UTC rather than as local time, so two machines cannot
 * disagree about when something happened.
 */
function parseApiDate(value: string): Date | null {
  const normalised = /Z$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `snake_case` or `kebab-case` to `Title Case`, for enum labels. */
export function humanise(value: string | null | undefined): string {
  if (!value) return EM_DASH;
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Convert a `YYYY-MM-DD` string to the value `input[type=date]` expects. */
export function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Truncate long free text for table cells without breaking words mid-token. */
export function truncate(value: string | null | undefined, max = 80): string {
  if (!value) return EM_DASH;
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/**
 * Turn a backend vocabulary (`["under_assessment", …]`) into select options.
 *
 * The meta endpoints return bare enum values rather than `{value,label}` pairs,
 * so every filter dropdown builds its options here and labels them with the
 * same `humanise` used by the badges.
 */
export function toOptions(values: readonly string[] | null | undefined): FilterOption[] {
  return (values ?? []).map((value) => ({ value, label: humanise(value) }));
}

export { EM_DASH };
