import { useEffect, useState, type ChangeEvent } from 'react';
import { CalendarRange, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Input, Select } from './Form';

/** Search box that debounces its callback so typing does not fire a request per keystroke. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  label = 'Search',
  delay = 300,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  delay?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const timer = window.setTimeout(() => onChange(draft), delay);
    return () => window.clearTimeout(timer);
    // `value` is intentionally excluded: including it would cancel the pending
    // debounce every time the parent echoed an earlier keystroke back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, delay, onChange]);

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
      <Input
        type="search"
        value={draft}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        className="pl-8 pr-8"
      />
      {draft ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** Dropdown filter bound to a single query parameter. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = 'All',
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  allLabel?: string;
  className?: string;
}) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-2xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <Select
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
        options={options}
        placeholder={allLabel}
        className="min-w-[8rem]"
      />
    </label>
  );
}

/**
 * Inclusive date-range filter.
 *
 * Both ends are optional and the value is only pushed to the parent once both
 * fields parse, so a half-typed date never becomes a query parameter.
 */
export function DateRangeFilter({
  startDate,
  endDate,
  onChange,
  label = 'Reporting period',
  className,
}: {
  startDate: string;
  endDate: string;
  onChange: (range: { startDate: string; endDate: string }) => void;
  label?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState({ startDate, endDate });

  useEffect(() => {
    setDraft({ startDate, endDate });
  }, [startDate, endDate]);

  const commit = (next: { startDate: string; endDate: string }) => {
    setDraft(next);
    onChange(next);
  };

  const invalid = Boolean(draft.startDate && draft.endDate && draft.startDate > draft.endDate);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-muted">
        <CalendarRange className="h-3 w-3" aria-hidden />
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          aria-label={`${label} start`}
          value={draft.startDate}
          invalid={invalid}
          max={draft.endDate || undefined}
          onChange={(event) => commit({ ...draft, startDate: event.target.value })}
          className="w-[9.5rem]"
        />
        <span className="text-xs text-muted" aria-hidden>
          –
        </span>
        <Input
          type="date"
          aria-label={`${label} end`}
          value={draft.endDate}
          invalid={invalid}
          min={draft.startDate || undefined}
          onChange={(event) => commit({ ...draft, endDate: event.target.value })}
          className="w-[9.5rem]"
        />
      </div>
      {invalid ? (
        <span role="alert" className="text-2xs text-danger">
          The start date must not be later than the end date.
        </span>
      ) : null}
    </div>
  );
}

export interface ActiveFilter {
  key: string;
  label: string;
  onClear: () => void;
}

/** Removable chips summarising the filters currently narrowing a list. */
export function ActiveFilters({
  filters,
  onClearAll,
  className,
}: {
  filters: Array<ActiveFilter | null | undefined | false>;
  onClearAll?: () => void;
  className?: string;
}) {
  const active = filters.filter((filter): filter is ActiveFilter => Boolean(filter));
  if (!active.length) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="text-2xs uppercase tracking-wide text-muted">Filters</span>
      {active.map((filter) => (
        <span
          key={filter.key}
          className="inline-flex items-center gap-1 rounded border border-border bg-surface-muted px-1.5 py-0.5 text-2xs text-foreground"
        >
          {filter.label}
          <button
            type="button"
            onClick={filter.onClear}
            aria-label={`Remove filter ${filter.label}`}
            className="rounded text-muted transition-colors hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {onClearAll && active.length > 1 ? (
        <Button size="sm" variant="ghost" onClick={onClearAll}>
          Clear all
        </Button>
      ) : null}
    </div>
  );
}

/** Toolbar row that holds search, filters and export controls above a table. */
export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-end gap-3 border-b border-border px-4 py-3', className)}>
      {children}
    </div>
  );
}
