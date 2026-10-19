import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Boxes, CornerDownLeft, Search, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SeverityBadge } from '@/components/ui/Badge';
import type { Asset, Finding, Page, Risk } from '@/types/api';

/**
 * Global search.
 *
 * Runs the term against the real list endpoints (risks, assets, vulnerability
 * findings) rather than a client-side index, so a result can never appear for a
 * record the caller is not allowed to read. Each group is capped and links to
 * the record, and "open in the register" carries the term across as the filter.
 */

interface SearchResults {
  risks: Page<Risk> | null;
  assets: Page<Asset> | null;
  findings: Page<Finding> | null;
}

const EMPTY: SearchResults = { risks: null, assets: null, findings: null };

export function GlobalSearch({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Avoid a request per keystroke without swallowing the final value.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [term]);

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    enabled: debounced.length >= 2,
    staleTime: 15_000,
    queryFn: async (): Promise<SearchResults> => {
      const [risks, assets, findings] = await Promise.all([
        api.get<Page<Risk>>('/api/risks', { query: { q: debounced, page_size: 5 } }),
        api.get<Page<Asset>>('/api/assets', { query: { q: debounced, page_size: 5 } }),
        api.get<Page<Finding>>('/api/vulnerabilities/findings', {
          query: { q: debounced, page_size: 5 },
        }),
      ]);
      return { risks, assets, findings };
    },
  });

  const results = data ?? EMPTY;
  const totalHits =
    (results.risks?.total ?? 0) + (results.assets?.total ?? 0) + (results.findings?.total ?? 0);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  // A shortcut makes the search reachable without a mouse.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const body = useMemo(() => {
    if (debounced.length < 2) {
      return (
        <p className="px-3 py-4 text-xs text-muted">
          Type at least two characters to search risks, assets and vulnerability findings.
        </p>
      );
    }
    if (isFetching && !data) {
      return <p className="px-3 py-4 text-xs text-muted">Searching…</p>;
    }
    if (totalHits === 0) {
      return (
        <p className="px-3 py-4 text-xs text-muted">
          No risks, assets or findings match “{debounced}”.
        </p>
      );
    }
    return null;
  }, [debounced, isFetching, data, totalHits]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        value={term}
        aria-label="Search the register"
        placeholder="Search risks, assets, findings…"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            inputRef.current?.blur();
          }
          if (event.key === 'Enter' && debounced.length >= 2) {
            go(`/risks?q=${encodeURIComponent(debounced)}`);
          }
        }}
        className="h-9 w-full rounded border border-border bg-surface pl-8 pr-16 text-xs text-foreground placeholder:text-muted/70"
      />
      {term ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setTerm('');
            inputRef.current?.focus();
          }}
          className="absolute right-9 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1 py-0.5 text-[10px] text-muted md:block">
        ⌘K
      </kbd>

      {open && debounced.length >= 2 ? (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface shadow-raised">
          {body ?? (
            <div className="py-1">
              {results.risks?.items.length ? (
                <SearchGroup
                  title="Risks"
                  icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden />}
                  total={results.risks.total}
                  onOpenAll={() => go(`/risks?q=${encodeURIComponent(debounced)}`)}
                  allLabel="Open in the register"
                >
                  {results.risks.items.map((risk) => (
                    <SearchRow
                      key={risk.id}
                      onClick={() => go(`/risks/${risk.id}`)}
                      title={`${risk.risk_ref} · ${risk.title}`}
                      meta={<SeverityBadge severity={risk.severity} />}
                      detail={risk.asset_name ?? risk.business_unit ?? undefined}
                    />
                  ))}
                </SearchGroup>
              ) : null}

              {results.assets?.items.length ? (
                <SearchGroup
                  title="Assets"
                  icon={<Boxes className="h-3.5 w-3.5" aria-hidden />}
                  total={results.assets.total}
                  onOpenAll={() => go(`/assets?q=${encodeURIComponent(debounced)}`)}
                  allLabel="Open in the asset registry"
                >
                  {results.assets.items.map((asset) => (
                    <SearchRow
                      key={asset.id}
                      onClick={() => go(`/assets/${asset.id}`)}
                      title={`${asset.asset_ref} · ${asset.name}`}
                      detail={asset.business_unit ?? asset.asset_type}
                    />
                  ))}
                </SearchGroup>
              ) : null}

              {results.findings?.items.length ? (
                <SearchGroup
                  title="Vulnerability findings"
                  icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
                  total={results.findings.total}
                  onOpenAll={() => go(`/cybersecurity?q=${encodeURIComponent(debounced)}`)}
                  allLabel="Open in cybersecurity"
                >
                  {results.findings.items.map((finding) => (
                    <SearchRow
                      key={finding.id}
                      onClick={() => go(`/cybersecurity/${finding.id}`)}
                      title={finding.cve_id ? `${finding.cve_id} · ${finding.title}` : finding.title}
                      meta={
                        finding.priority_band ? (
                          <SeverityBadge severity={finding.priority_band} />
                        ) : undefined
                      }
                      detail={finding.asset_name ?? undefined}
                    />
                  ))}
                </SearchGroup>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SearchGroup({
  title,
  icon,
  total,
  onOpenAll,
  allLabel,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  total: number;
  onOpenAll: () => void;
  allLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">
          {icon}
          {title}
          <span className="font-normal">({total})</span>
        </span>
        <button
          type="button"
          onClick={onOpenAll}
          className="flex items-center gap-1 rounded text-[10px] text-primary hover:underline"
        >
          {allLabel}
          <CornerDownLeft className="h-3 w-3" aria-hidden />
        </button>
      </header>
      <div>{children}</div>
    </section>
  );
}

function SearchRow({
  title,
  detail,
  meta,
  onClick,
}: {
  title: string;
  detail?: string;
  meta?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-muted"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{title}</span>
        {detail ? <span className="block truncate text-2xs text-muted">{detail}</span> : null}
      </span>
      {meta}
    </button>
  );
}
