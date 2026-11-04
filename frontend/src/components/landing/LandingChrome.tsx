import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { BrandLockup, CtaLink, LogoMark, scrollToSection, useActiveSection } from './LandingPrimitives';

/**
 * Sticky marketing navigation.
 *
 * The bar is transparent over the hero and gains a translucent navy backing with
 * a hairline border once the page scrolls, so the hero reads as full-bleed while
 * the rest of the page stays legible.
 */

const NAV_ITEMS = [
  { id: 'home', label: 'Home' },
  { id: 'platform', label: 'Platform' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'workflow', label: 'How It Works' },
  { id: 'security', label: 'Security' },
  { id: 'transparency', label: 'About' },
] as const;

const SECTION_IDS = NAV_ITEMS.map((item) => item.id);

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const activeSection = useActiveSection([...SECTION_IDS]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock the page behind the mobile sheet so the menu cannot be scrolled past.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const handleNavigate = (id: string) => {
    setMenuOpen(false);
    scrollToSection(id);
  };

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ease-smooth',
        scrolled || menuOpen
          ? 'border-b border-border bg-canvas/85 backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent',
      )}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-5 sm:px-8"
      >
        <Link
          to="/"
          className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="FinRisk AI home"
        >
          <BrandLockup />
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => handleNavigate(item.id)}
                aria-current={activeSection === item.id ? 'true' : undefined}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200',
                  activeSection === item.id
                    ? 'text-foreground'
                    : 'text-muted hover:text-foreground',
                )}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-2 lg:flex">
          <Link
            to="/login"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors duration-200 hover:text-foreground"
          >
            Sign In
          </Link>
          <CtaLink to="/register" size="sm" className="gap-1.5">
            Get Started
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </CtaLink>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="landing-mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface/60 text-foreground transition-colors hover:border-border-strong lg:hidden"
        >
          {menuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>
      </nav>

      {/* Mobile sheet */}
      <div
        id="landing-mobile-menu"
        hidden={!menuOpen}
        className="border-t border-border bg-canvas/95 backdrop-blur-xl lg:hidden"
      >
        <ul className="mx-auto flex w-full max-w-7xl flex-col px-5 py-3 sm:px-8">
          {NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={cn(
                  'w-full rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors',
                  activeSection === item.id ? 'text-foreground' : 'text-muted hover:text-foreground',
                )}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-5 pb-5 sm:px-8">
          <CtaLink to="/register" className="w-full">
            Get Started
          </CtaLink>
          <CtaLink to="/login" variant="outline" className="w-full">
            Sign In
          </CtaLink>
        </div>
      </div>
    </header>
  );
}

/**
 * Footer.
 *
 * Only destinations that actually exist are rendered as links. Items whose
 * screens have not been built yet are shown as plain text rather than as links
 * that would land on a 404.
 */

interface FooterItem {
  label: string;
  /** A router path (`/login`) or an in-page anchor (`#platform`). */
  href?: string;
}

const FOOTER_COLUMNS: Array<{ heading: string; items: FooterItem[] }> = [
  {
    heading: 'Platform',
    items: [
      { label: 'Overview', href: '#platform' },
      { label: 'Risk Assessment', href: '#capabilities' },
      { label: 'Financial Modelling', href: '#financial' },
      { label: 'Risk Intelligence', href: '#analytics' },
      { label: 'Reporting', href: '#reporting' },
    ],
  },
  {
    heading: 'Resources',
    items: [{ label: 'FAQ', href: '#faq' }, { label: 'About', href: '#transparency' }, { label: 'Documentation' }, { label: 'Contact' }],
  },
  {
    heading: 'Account',
    items: [
      { label: 'Sign In', href: '/login' },
      { label: 'Get Started', href: '/register' },
    ],
  },
  {
    heading: 'Legal',
    items: [{ label: 'Privacy Policy' }, { label: 'Terms of Service' }],
  },
];

function FooterItemLink({ item }: { item: FooterItem }) {
  if (!item.href) {
    // Not implemented yet: shown for completeness, deliberately not a link.
    return (
      <span className="text-sm text-muted/60" title="Not yet available">
        {item.label}
      </span>
    );
  }

  const className =
    'inline-block text-sm text-muted transition-colors duration-200 hover:text-foreground';

  if (item.href.startsWith('#')) {
    const id = item.href.slice(1);
    return (
      <button type="button" onClick={() => scrollToSection(id)} className={className}>
        {item.label}
      </button>
    );
  }

  return (
    <Link to={item.href} className={className}>
      {item.label}
    </Link>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-border bg-surface/40">
      <div className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <LogoMark className="h-7 w-7" />
              <span className="text-[1.05rem] font-semibold tracking-tight text-foreground">
                FinRisk<span className="text-primary"> AI</span>
              </span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              An integrated financial and cyber risk intelligence platform designed to help organizations assess
              exposure, analyze potential impact, and manage risk with greater clarity.
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.heading}>
              <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-foreground">
                {column.heading}
              </h2>
              <ul className="mt-4 space-y-3">
                {column.items.map((item) => (
                  <li key={item.label}>
                    <FooterItemLink item={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-muted">© 2026 FinRisk AI. All rights reserved.</p>
          <p className="text-xs text-muted">
            Scores and scenario results are decision support — not forecasts or professional advice.
          </p>
        </div>
      </div>
    </footer>
  );
}
