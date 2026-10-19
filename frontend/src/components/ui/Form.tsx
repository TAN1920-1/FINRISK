import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Form primitives.
 *
 * Every control is wrapped in `Field`, which owns the label, the hint and the
 * error message and wires them together with `aria-describedby` and
 * `aria-invalid`. Validation messages are therefore announced, not just
 * coloured red.
 */

const CONTROL_BASE =
  'w-full rounded border bg-surface px-2.5 text-sm text-foreground placeholder:text-muted/70 transition-colors disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted';

const CONTROL_STATE = {
  normal: 'border-border hover:border-border-strong focus:border-primary',
  invalid: 'border-danger focus:border-danger',
};

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
  /** Rendered to the right of the label, e.g. a unit or a limit. */
  aside?: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, children, className, aside }: FieldProps) {
  const generatedId = useId();
  const controlId = htmlFor ?? generatedId;
  const describedBy = [hint ? `${controlId}-hint` : null, error ? `${controlId}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={controlId} className="text-xs font-medium text-foreground">
          {label}
          {required ? (
            <span className="ml-0.5 text-danger" aria-hidden>
              *
            </span>
          ) : null}
        </label>
        {aside ? <span className="text-2xs text-muted">{aside}</span> : null}
      </div>
      <div aria-describedby={describedBy || undefined}>{children}</div>
      {hint && !error ? (
        <p id={`${controlId}-hint`} className="text-2xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${controlId}-error`} role="alert" className="flex items-start gap-1 text-2xs text-danger">
          <AlertCircle className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_BASE, 'h-9', invalid ? CONTROL_STATE.invalid : CONTROL_STATE.normal, className)}
      {...rest}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_BASE, 'py-2', invalid ? CONTROL_STATE.invalid : CONTROL_STATE.normal, className)}
      {...rest}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, options, placeholder, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_BASE, 'h-9 pr-8', invalid ? CONTROL_STATE.invalid : CONTROL_STATE.normal, className)}
      {...rest}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
});

export function Checkbox({
  label,
  hint,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary accent-[hsl(var(--primary))]"
        {...rest}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-xs font-medium text-foreground">
          {label}
        </label>
        {hint ? <p className="text-2xs text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}

/**
 * Summary shown above a form when the server rejected more than one field.
 * Uses `aria-live` so a screen reader hears it as soon as it appears.
 */
export function FormErrorSummary({ errors }: { errors: Array<string | null | undefined> }) {
  const messages = errors.filter((message): message is string => Boolean(message));
  if (!messages.length) return null;
  return (
    <div role="alert" aria-live="assertive" className="rounded border border-danger/40 bg-danger/10 p-3">
      <p className="text-xs font-medium text-danger">Please correct the following:</p>
      <ul className="mt-1 list-inside list-disc text-2xs text-danger">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
