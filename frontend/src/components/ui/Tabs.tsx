import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
  /** Rendered at the end of the tab label, e.g. a record count. */
  badge?: ReactNode;
  disabled?: boolean;
}

/**
 * Tab set implemented with the ARIA tabs pattern: roving tabindex, arrow-key
 * navigation, and a single visible panel per tab.
 */
export function Tabs({
  items,
  initialId,
  className,
  panelClassName,
}: {
  items: TabItem[];
  initialId?: string;
  className?: string;
  panelClassName?: string;
}) {
  const [activeId, setActiveId] = useState(initialId ?? items[0]?.id ?? '');
  const baseId = useId();
  const active = items.find((item) => item.id === activeId) ?? items[0];

  const move = (direction: 1 | -1) => {
    const enabled = items.filter((item) => !item.disabled);
    const index = enabled.findIndex((item) => item.id === activeId);
    const next = enabled[(index + direction + enabled.length) % enabled.length];
    if (next) setActiveId(next.id);
  };

  if (!active) return null;

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label="Sections"
        className="flex flex-wrap items-center gap-1 border-b border-border"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            move(1);
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            move(-1);
          }
        }}
      >
        {items.map((item) => {
          const selected = item.id === active.id;
          return (
            <button
              key={item.id}
              id={`${baseId}-tab-${item.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => setActiveId(item.id)}
              className={cn(
                '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                selected
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted hover:text-foreground',
              )}
            >
              {item.label}
              {item.badge ? <span className="text-2xs text-muted">{item.badge}</span> : null}
            </button>
          );
        })}
      </div>
      <div
        id={`${baseId}-panel-${active.id}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${active.id}`}
        tabIndex={0}
        className={cn('pt-4', panelClassName)}
      >
        {active.content}
      </div>
    </div>
  );
}
