import { useState, type ReactNode } from 'react';
import { ChevronDown, FunctionSquare } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Methodology panel.
 *
 * Every score, band or estimate in the platform can be traced back to the rule
 * that produced it. This component is the single place that explanation is
 * rendered, and the backend supplies the text (`methodology`, `limitations`) so
 * the screen cannot describe the calculation differently from the code.
 */
export function MethodologyPanel({
  title = 'How this is calculated',
  methodology,
  limitations,
  formula,
  defaultOpen = false,
  className,
}: {
  title?: string;
  /** Plain-language description of the calculation, from the API. */
  methodology: ReactNode;
  /** What the number does not mean, from the API. */
  limitations?: ReactNode;
  formula?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn('rounded border border-border bg-surface-muted/50', className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted">
          <FunctionSquare className="h-3.5 w-3.5" aria-hidden />
          {title}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border px-3 py-3 text-xs">
          <div className="text-foreground">{methodology}</div>
          {formula ? (
            <pre className="overflow-x-auto rounded bg-surface p-2 font-mono text-2xs text-foreground">{formula}</pre>
          ) : null}
          {limitations ? (
            <p className="border-t border-border pt-2 text-muted">
              <span className="font-medium text-foreground">Limitations: </span>
              {limitations}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Inline explanation shown next to a single figure. */
export function HelpHint({ text, label }: { text: string; label?: string }) {
  return (
    <span
      title={text}
      aria-label={label ?? text}
      className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-border text-[9px] font-semibold text-muted"
    >
      i
    </span>
  );
}
