import { describe, expect, it } from 'vitest';
import {
  EM_DASH,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatPercentValue,
  formatRelative,
  humanise,
  isoDaysAgo,
  pluralise,
  toDateInput,
  toOptions,
  truncate,
} from './format';

/**
 * These tests pin the two presentation promises the platform makes about
 * numbers: money is never silently converted, and an absent value is shown as
 * absent rather than as zero.
 */
describe('formatMoney', () => {
  it('renders an em dash for a missing value instead of zero', () => {
    expect(formatMoney(null)).toBe(EM_DASH);
    expect(formatMoney(undefined)).toBe(EM_DASH);
    expect(formatMoney('')).toBe(EM_DASH);
  });

  it('renders a real zero as a zero amount', () => {
    // "no loss" and "not estimated" must not look the same.
    expect(formatMoney(0, 'USD')).not.toBe(EM_DASH);
    expect(formatMoney(0, 'USD')).toContain('0');
  });

  it('formats a decimal string with the currency it arrived with', () => {
    expect(formatMoney('1234.5', 'USD')).toBe('$1,235');
    expect(formatMoney('1234.5', 'EUR')).toContain('€');
  });

  it('never converts between currencies', () => {
    const usd = formatMoney('1000', 'USD');
    const inr = formatMoney('1000', 'INR');
    expect(usd).not.toContain('₹');
    expect(inr).toContain('₹');
    expect(inr).not.toContain('$');
  });

  it('keeps the raw value and code when the amount is not numeric', () => {
    // Better a visibly odd cell than a silently wrong number.
    expect(formatMoney('not-a-number', 'USD')).toBe('not-a-number USD');
  });

  it('supports a compact rendering for KPI tiles', () => {
    expect(formatMoney('1500000', 'USD', { compact: true })).toMatch(/\$1\.5M/);
  });

  it('does not render fractional cents by default', () => {
    expect(formatMoney('99.999', 'USD')).toBe('$100');
  });
});

describe('formatNumber', () => {
  it('renders an em dash for a missing value', () => {
    expect(formatNumber(null)).toBe(EM_DASH);
    expect(formatNumber(undefined)).toBe(EM_DASH);
  });

  it('rounds to whole numbers by default and groups thousands', () => {
    expect(formatNumber(1234.4)).toBe('1,234');
  });

  it('honours an explicit fraction-digit count', () => {
    expect(formatNumber(3.14159, { maximumFractionDigits: 2 })).toBe('3.14');
  });
});

describe('formatPercent and formatPercentValue', () => {
  it('treats the input as a fraction for formatPercent', () => {
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(0.123, 1)).toBe('12.3%');
  });

  it('treats the input as an already-scaled percentage for formatPercentValue', () => {
    expect(formatPercentValue(12.34)).toBe('12.3%');
  });

  it('renders an em dash for missing or non-finite values', () => {
    expect(formatPercent(null)).toBe(EM_DASH);
    expect(formatPercent(Number.NaN)).toBe(EM_DASH);
    expect(formatPercentValue(undefined)).toBe(EM_DASH);
  });
});

describe('date formatting', () => {
  it('treats a timestamp without an offset as UTC, not local time', () => {
    // Two machines must not disagree about when something happened.
    expect(formatDateTime('2026-03-04T12:00:00')).toBe(formatDateTime('2026-03-04T12:00:00Z'));
    expect(formatDate('2026-03-04T12:00:00')).toBe(formatDate('2026-03-04T12:00:00Z'));
  });

  it('renders an em dash for a missing or unparseable value', () => {
    expect(formatDate(null)).toBe(EM_DASH);
    expect(formatDate('not-a-date')).toBe(EM_DASH);
    expect(formatDateTime(undefined)).toBe(EM_DASH);
  });

  it('labels an unbounded range rather than implying a window', () => {
    expect(formatDateRange(null, null)).toBe('All time');
    expect(formatDateRange('2026-01-01', null)).toContain('Today');
    expect(formatDateRange(null, '2026-01-01')).toContain('Start');
  });

  it('renders relative times and falls back to an em dash when absent', () => {
    expect(formatRelative(null)).toBe(EM_DASH);
    expect(formatRelative('2099-01-01T00:00:00Z')).toMatch(/in /);
  });

  it('normalises a timestamp for date inputs', () => {
    expect(toDateInput('2026-03-04T12:00:00Z')).toBe('2026-03-04');
    expect(toDateInput(null)).toBe('');
  });

  it('produces ISO day strings for date filters', () => {
    expect(isoDaysAgo(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isoDaysAgo(7) < isoDaysAgo(0)).toBe(true);
  });
});

describe('humanise', () => {
  it('turns a backend enum into a readable label', () => {
    expect(humanise('under_assessment')).toBe('Under Assessment');
    expect(humanise('in-progress')).toBe('In Progress');
  });

  it('collapses runs of separators', () => {
    expect(humanise('cloud__only')).toBe('Cloud Only');
  });

  it('renders an em dash for a missing value', () => {
    expect(humanise(null)).toBe(EM_DASH);
    expect(humanise('')).toBe(EM_DASH);
  });
});

describe('truncate', () => {
  it('leaves short text untouched', () => {
    expect(truncate('short', 20)).toBe('short');
  });

  it('shortens long text and marks the ellipsis', () => {
    const result = truncate('a'.repeat(50), 10);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('renders an em dash for a missing value', () => {
    expect(truncate(null)).toBe(EM_DASH);
  });
});

describe('pluralise', () => {
  it('uses the singular for exactly one', () => {
    expect(pluralise(1, 'record')).toBe('record');
  });

  it('appends an s by default but honours an explicit plural', () => {
    expect(pluralise(0, 'record')).toBe('records');
    expect(pluralise(2, 'entry', 'entries')).toBe('entries');
  });
});

describe('toOptions', () => {
  it('labels each vocabulary value with the shared humanise helper', () => {
    expect(toOptions(['under_assessment', 'closed'])).toEqual([
      { value: 'under_assessment', label: 'Under Assessment' },
      { value: 'closed', label: 'Closed' },
    ]);
  });

  it('returns an empty list for a missing vocabulary', () => {
    expect(toOptions(null)).toEqual([]);
    expect(toOptions(undefined)).toEqual([]);
  });
});
