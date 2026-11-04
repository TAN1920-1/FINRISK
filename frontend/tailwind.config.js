/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic surface tokens. Values live in src/index.css so the light and
        // dark themes stay in one place instead of being duplicated per component.
        canvas: 'hsl(var(--canvas) / <alpha-value>)',
        surface: 'hsl(var(--surface) / <alpha-value>)',
        'surface-muted': 'hsl(var(--surface-muted) / <alpha-value>)',
        'surface-raised': 'hsl(var(--surface-raised) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        'border-strong': 'hsl(var(--border-strong) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        muted: 'hsl(var(--muted-foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
          muted: 'hsl(var(--primary-muted) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        accent: 'hsl(var(--accent) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        danger: 'hsl(var(--danger) / <alpha-value>)',
        success: 'hsl(var(--success) / <alpha-value>)',
        warning: 'hsl(var(--warning) / <alpha-value>)',
        // Risk bands. One hue per severity so a reader can learn the mapping once.
        risk: {
          critical: 'hsl(var(--risk-critical) / <alpha-value>)',
          high: 'hsl(var(--risk-high) / <alpha-value>)',
          medium: 'hsl(var(--risk-medium) / <alpha-value>)',
          low: 'hsl(var(--risk-low) / <alpha-value>)',
          unknown: 'hsl(var(--risk-unknown) / <alpha-value>)',
        },
        // Dedicated sidebar scale: the chrome can contrast with the page canvas
        // (dark navy in dark mode, a pale rail in light mode) without either
        // theme having to hard-code its own text colours.
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar) / <alpha-value>)',
          foreground: 'hsl(var(--sidebar-foreground) / <alpha-value>)',
          muted: 'hsl(var(--sidebar-muted) / <alpha-value>)',
          active: 'hsl(var(--sidebar-active) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Geist', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        // Deliberately restrained scale: dense operational screens, not a landing page.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        DEFAULT: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05)',
        raised: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
        glow: '0 0 0 1px hsl(var(--primary) / 0.2), 0 0 16px -4px hsl(var(--primary) / 0.3)',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'grow-x': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out',
        'fade-in-up': 'fade-in-up 220ms cubic-bezier(0.32, 0.72, 0, 1) both',
        'grow-x': 'grow-x 500ms cubic-bezier(0.32, 0.72, 0, 1) both',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};
