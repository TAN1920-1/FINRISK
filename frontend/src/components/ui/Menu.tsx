import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * Accessible dropdown.
 *
 * A small, dependency-free replacement for a headless menu library: the trigger
 * carries `aria-expanded`/`aria-haspopup`, the panel is closed by Escape or a
 * click outside, and focus returns to the trigger on close.
 */
export function Dropdown({
  trigger,
  children,
  align = 'right',
  className,
  panelClassName,
  label,
  width = 'w-72',
}: {
  /** Receives the props the trigger must spread to become the menu button. */
  trigger: (props: {
    onClick: () => void;
    'aria-expanded': boolean;
    'aria-haspopup': 'menu';
    ref: React.RefObject<HTMLButtonElement>;
  }) => ReactElement;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  className?: string;
  panelClassName?: string;
  label: string;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const triggerElement = trigger({
    onClick: () => setOpen((value) => !value),
    'aria-expanded': open,
    'aria-haspopup': 'menu',
    ref: triggerRef,
  });

  return (
    <div className={cn('relative', className)}>
      {isValidElement(triggerElement) ? cloneElement(triggerElement) : triggerElement}
      {open ? (
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          className={cn(
            'absolute z-40 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-raised animate-fade-in',
            align === 'right' ? 'right-0' : 'left-0',
            width,
            panelClassName,
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="py-1">
      {title ? (
        <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted">{title}</p>
      ) : null}
      {children}
    </div>
  );
}

export function MenuItem({
  onSelect,
  children,
  icon,
  danger = false,
  selected = false,
  disabled = false,
  description,
}: {
  onSelect: () => void;
  children: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
  selected?: boolean;
  disabled?: boolean;
  description?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        danger ? 'text-danger hover:bg-danger/10' : 'text-foreground hover:bg-surface-muted',
        selected && 'bg-surface-muted',
      )}
    >
      {icon ? <span className="mt-0.5 shrink-0 text-muted">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{children}</span>
        {description ? <span className="mt-0.5 block text-2xs text-muted">{description}</span> : null}
      </span>
    </button>
  );
}

export function MenuDivider() {
  return <div className="my-1 border-t border-border" role="separator" />;
}
