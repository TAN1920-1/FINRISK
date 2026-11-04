import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * Shared building blocks for the public landing page.
 *
 * The landing surface is deliberately dark-first: every colour is read from the
 * same semantic tokens the authenticated product uses, so the marketing page and
 * the application can never drift apart, and no component here hard-codes a hex
 * value.
 */

/**
 * Brand mark: a geometric shield holding a rising signal line.
 *
 * A shield communicates protection and the ascending line communicates financial
 * movement, which together describe the product without resorting to an emoji or
 * a stock glyph.
 */
export function LogoMark({ className }: { className?: string }) {
  const rawId = useId();
  const gradientId = `finrisk-mark-${rawId.replace(/:/g, '')}`;

  return (
    <svg viewBox="0 0 32 32" className={cn('h-8 w-8', className)} aria-hidden focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--primary))' }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--secondary))' }} />
        </linearGradient>
      </defs>
      <path
        d="M16 2.6 26.6 6.8v7.9c0 6.7-4.4 11.7-10.6 14.7C9.8 26.4 5.4 21.4 5.4 14.7V6.8L16 2.6Z"
        style={{ fill: 'hsl(var(--primary) / 0.12)', stroke: `url(#${gradientId})` }}
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path
        d="M10.2 19.6l3.5-4.1 2.9 2.5 4.9-6.1"
        style={{ stroke: `url(#${gradientId})` }}
        fill="none"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21.6" cy="11.8" r="1.7" style={{ fill: `url(#${gradientId})` }} />
    </svg>
  );
}

/** Mark plus wordmark, used in the navigation bar and the footer. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark className="h-7 w-7" />
      <span className="text-[1.05rem] font-semibold tracking-tight text-foreground">
        FinRisk<span className="text-primary"> AI</span>
      </span>
    </span>
  );
}

/** Small uppercase label that opens a section. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary', className)}>
      {children}
    </p>
  );
}

/**
 * Consistent page section: full-bleed background, one centred content column and
 * a scroll offset that keeps anchored headings clear of the sticky navigation.
 */
export function Section({
  id,
  className,
  contentClassName,
  children,
}: {
  id?: string;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn('relative scroll-mt-24 px-5 py-20 sm:px-8 lg:py-28', className)}>
      <div className={cn('mx-auto w-full max-w-7xl', contentClassName)}>{children}</div>
    </section>
  );
}

/** Eyebrow + heading + optional description, centred or left aligned. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: 'center' | 'left';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
        className,
      )}
    >
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="max-w-3xl text-balance text-[1.75rem] font-semibold leading-[1.15] tracking-tight text-foreground sm:text-[2.15rem] lg:text-[2.6rem]">
        {title}
      </h2>
      {description ? (
        <p className={cn('max-w-2xl text-[0.95rem] leading-relaxed text-muted', align === 'center' && 'mx-auto')}>
          {description}
        </p>
      ) : null}
    </div>
  );
}

/** Fires once, the first time the element enters the viewport. */
export function useInViewOnce<T extends HTMLElement>(rootMargin = '0px 0px -20% 0px') {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        });
      },
      { rootMargin, threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}

/**
 * Scroll-triggered reveal. Implemented with IntersectionObserver and a CSS
 * transition rather than an animation library, so the landing page adds no
 * runtime dependency to the product bundle.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, inView } = useInViewOnce<HTMLDivElement>();

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        'transition-[opacity,transform] duration-700 ease-smooth motion-reduce:transition-none',
        inView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Navigation-styled router link used by the marketing CTAs. */
export function CtaLink({
  to,
  children,
  variant = 'primary',
  size = 'md',
  className,
}: {
  to: string;
  children: ReactNode;
  variant?: 'primary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const variants = {
    primary: 'bg-primary text-primary-foreground shadow-glow hover:brightness-110',
    outline: 'border border-border bg-surface/60 text-foreground hover:border-border-strong hover:bg-surface-raised',
    ghost: 'text-muted hover:text-foreground',
  } as const;

  const sizes = {
    sm: 'h-9 px-3.5 text-sm',
    md: 'h-10 px-4 text-sm',
    lg: 'h-11 px-5 text-[0.95rem]',
  } as const;

  return (
    <Link
      to={to}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium transition-[background-color,border-color,color,filter,box-shadow,transform] duration-200 ease-smooth',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Smooth in-page anchor scroll, offset handled by each section's scroll-mt. */
export function scrollToSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Highlights the section currently occupying the middle of the viewport. */
export function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? '');
  const key = ids.join('|');

  useEffect(() => {
    const list = key.split('|').filter(Boolean);
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const current = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (current) setActive(current.target.id);
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: [0, 0.2, 0.5, 1] },
    );
    list.forEach((id) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [key]);

  return active;
}
