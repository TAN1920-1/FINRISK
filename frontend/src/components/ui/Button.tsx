import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-foreground shadow-glow hover:brightness-110 active:brightness-95 disabled:bg-primary/50 disabled:shadow-none',
  secondary:
    'bg-surface-muted text-foreground border border-border hover:border-border-strong hover:bg-surface disabled:opacity-60',
  outline:
    'border border-border bg-surface text-foreground hover:bg-surface-muted hover:border-border-strong disabled:opacity-60 shadow-sm',
  ghost: 'bg-transparent text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-60',
  danger: 'bg-danger text-white shadow-card hover:brightness-110 disabled:opacity-60 disabled:shadow-none',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-xs',
  md: 'h-9 gap-2 px-3 text-sm',
  lg: 'h-11 gap-2 px-4 text-sm',
  icon: 'h-9 w-9 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, className, children, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center rounded-lg font-medium transition-[background-color,border-color,color,filter,box-shadow] duration-150 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
