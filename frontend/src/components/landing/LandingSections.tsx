import type { LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Banknote,
  BrainCircuit,
  Building2,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Coins,
  Eye,
  FileText,
  FlaskConical,
  Gauge,
  Globe,
  KeyRound,
  Layers,
  LineChart,
  ListChecks,
  Lock,
  Network,
  Radar,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { CtaLink, Eyebrow, Reveal, Section, SectionHeading, scrollToSection, useInViewOnce } from './LandingPrimitives';
import {
  DashboardPreview,
  MiniExportVisual,
  MiniLossVisual,
  MiniRegisterVisual,
  MiniSeverityVisual,
  MiniSourceVisual,
  MiniVendorVisual,
  MlInsightsCard,
  ReportPreview,
  RiskMatrix,
  ScenarioLineChart,
  ThreatIntelPanel,
} from './LandingVisuals';

/* ------------------------------------------------------------------ *
 * Shared pieces
 * ------------------------------------------------------------------ */

/** Card used by the platform, audience and security grids. */
function FeatureCard({
  icon: Icon,
  title,
  description,
  tone = 'primary',
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  tone?: 'primary' | 'secondary';
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('landing-card flex flex-col p-6', className)}>
      <span
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-xl border',
          tone === 'primary'
            ? 'border-primary/25 bg-primary/10 text-primary'
            : 'border-secondary/25 bg-secondary/10 text-secondary',
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
      {children}
    </div>
  );
}

function ExploreLink({ target, label = 'Explore capability' }: { target: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => scrollToSection(target)}
      className="group mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-foreground"
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * 4 — Platform introduction
 * ------------------------------------------------------------------ */

const PLATFORM_CARDS: Array<{ icon: LucideIcon; title: string; description: string; tone: 'primary' | 'secondary' }> = [
  {
    icon: Wallet,
    title: 'Financial Risk Assessment',
    description:
      'Evaluate financial exposure and model potential loss scenarios using structured financial assumptions and configurable risk parameters.',
    tone: 'primary',
  },
  {
    icon: ShieldCheck,
    title: 'Cybersecurity Risk Intelligence',
    description:
      'Track vulnerability findings, understand severity, and monitor remediation activities across your organizational risk register.',
    tone: 'secondary',
  },
  {
    icon: Network,
    title: 'Third-Party Risk Management',
    description:
      'Evaluate vendors through structured TILT questionnaire assessments and maintain visibility into third-party risk exposure.',
    tone: 'primary',
  },
  {
    icon: BrainCircuit,
    title: 'Intelligent Risk Prioritisation',
    description:
      'Use optional machine-learning models to support risk prioritisation, with transparent scoring and a rule-based fallback.',
    tone: 'secondary',
  },
];

export function PlatformSection() {
  return (
    <Section id="platform" className="relative">
      <Reveal>
        <SectionHeading
          eyebrow="The Platform"
          title="Risk Doesn't Exist in Isolation."
          description="Financial exposure, cybersecurity vulnerabilities, operational weaknesses, and third-party dependencies can all impact an organization's stability. FinRisk AI brings these dimensions together in one centralized workspace, helping teams maintain visibility, evaluate potential impact, and manage risk through structured assessment and analytics."
        />
      </Reveal>

      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {PLATFORM_CARDS.map((card, index) => (
          <Reveal key={card.title} delay={index * 80}>
            <FeatureCard
              icon={card.icon}
              title={card.title}
              description={card.description}
              tone={card.tone}
              className="h-full"
            />
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * 5 — Core capabilities
 * ------------------------------------------------------------------ */

const CAPABILITIES: Array<{
  icon: LucideIcon;
  title: string;
  description: string;
  target: string;
  visual: ReactNode;
}> = [
  {
    icon: ListChecks,
    title: 'Centralized Risk Register',
    description:
      'Organize assets, document identified risks, evaluate likelihood and impact, and manage mitigation activities from a centralized workspace.',
    target: 'analytics',
    visual: <MiniRegisterVisual />,
  },
  {
    icon: CircleDollarSign,
    title: 'Financial Loss Modelling',
    description:
      'Model financial loss scenarios using configurable assumptions and understand their potential monetary implications.',
    target: 'financial',
    visual: <MiniLossVisual />,
  },
  {
    icon: ScanSearch,
    title: 'Vulnerability Management',
    description: 'Import and track vulnerability findings, review severity, and monitor remediation progress.',
    target: 'intelligence',
    visual: <MiniSeverityVisual />,
  },
  {
    icon: Building2,
    title: 'Vendor Risk Assessment',
    description:
      'Assess third-party vendors through structured questionnaires and maintain organized vendor risk records.',
    target: 'intelligence',
    visual: <MiniVendorVisual />,
  },
  {
    icon: Radar,
    title: 'External Risk Intelligence',
    description: 'Access advisory external checks using supported vulnerability and threat intelligence sources.',
    target: 'intelligence',
    visual: <MiniSourceVisual />,
  },
  {
    icon: FileText,
    title: 'Reporting & Analytics',
    description:
      'Generate structured PDF and CSV reports to support documentation, analysis, and risk management workflows.',
    target: 'reporting',
    visual: <MiniExportVisual />,
  },
];

export function CapabilitiesSection() {
  return (
    <Section id="capabilities" className="bg-surface/40">
      <Reveal>
        <SectionHeading
          eyebrow="What You Can Do"
          title="Everything You Need to Manage Risk."
          description="From maintaining risk records to analyzing potential financial exposure, FinRisk AI provides a connected set of tools for structured risk management."
        />
      </Reveal>

      <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((capability, index) => (
          <Reveal key={capability.title} delay={(index % 3) * 80}>
            <div className="landing-card flex h-full flex-col p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-raised text-primary">
                  <capability.icon className="h-4 w-4" aria-hidden />
                </span>
                <h3 className="text-sm font-semibold tracking-tight text-foreground">{capability.title}</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">{capability.description}</p>
              <div className="mt-4 rounded-xl border border-border bg-surface/50 p-3">{capability.visual}</div>
              <ExploreLink target={capability.target} />
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * 6 — Financial risk modelling showcase
 * ------------------------------------------------------------------ */

const FINANCIAL_BENEFITS: Array<{ icon: LucideIcon; title: string; description: string }> = [
  {
    icon: LineChart,
    title: 'Scenario-based analysis',
    description: 'Explore potential financial outcomes under different assumptions.',
  },
  {
    icon: Coins,
    title: 'Currency-aware records',
    description:
      'Maintain financial figures in their original ISO-4217 currency without silently combining different currencies.',
  },
  {
    icon: Eye,
    title: 'Transparent assumptions',
    description: 'Understand the assumptions behind every modeled financial figure.',
  },
];

function AssumptionsCard() {
  return (
    <div className="landing-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-foreground">Base-case assumptions</p>
        <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] text-muted">USD</span>
      </div>
      <dl className="mt-3 space-y-2.5">
        {[
          { label: 'Loss event probability', value: '35%' },
          { label: 'Single-loss exposure', value: 'USD 2,900,000' },
          { label: 'Control effectiveness', value: '0.60' },
        ].map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[11px] text-muted">{row.label}</dt>
            <dd className="text-[11px] font-semibold tabular-nums text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 border-t border-border pt-2 text-[10px] text-muted/80">
        Expected loss is derived from the values entered above.
      </p>
    </div>
  );
}

function ScenarioHistoryCard() {
  return (
    <div className="landing-card p-4">
      <p className="text-[11px] font-semibold text-foreground">Recorded scenarios</p>
      <ul className="mt-3 space-y-2.5">
        {[
          { label: 'FY25 · Base case', currency: 'USD', value: '1,040,000' },
          { label: 'FY25 · Adverse case', currency: 'EUR', value: '870,000' },
          { label: 'FY24 · Base case', currency: 'USD', value: '910,000' },
        ].map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="truncate text-muted">{row.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-foreground">
              <span className="mr-1 text-[10px] font-normal text-muted">{row.currency}</span>
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FinancialShowcaseSection() {
  return (
    <Section id="financial">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <Reveal>
          <SectionHeading
            align="left"
            eyebrow="Financial Intelligence"
            title="Turn Financial Uncertainty Into Measurable Scenarios."
            description="Explore how different financial assumptions influence potential exposure. Model loss scenarios, examine possible outcomes, and understand the financial implications behind your risk assessments."
          />
          <ul className="mt-10 space-y-7">
            {FINANCIAL_BENEFITS.map((benefit) => (
              <li key={benefit.title} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                  <benefit.icon className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{benefit.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{benefit.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={120}>
          <div className="space-y-4">
            <ScenarioLineChart />
            <div className="grid gap-4 sm:grid-cols-2">
              <AssumptionsCard />
              <ScenarioHistoryCard />
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * 7 — Risk scoring & intelligence
 * ------------------------------------------------------------------ */

export function RiskAnalyticsSection() {
  return (
    <Section id="analytics" className="bg-surface/40">
      <Reveal>
        <SectionHeading
          eyebrow="Risk Analytics"
          title="Prioritize What Matters Most."
          description="Use structured risk scoring and optional machine-learning assistance to organize risks, understand their relative severity, and identify areas that deserve attention."
        />
      </Reveal>

      <div className="mt-14 grid gap-5 lg:grid-cols-2">
        <Reveal>
          <RiskMatrix />
        </Reveal>
        <Reveal delay={120}>
          <div className="space-y-4">
            <MlInsightsCard />
            <p className="px-1 text-xs leading-relaxed text-muted">
              FinRisk AI can use an optional machine-learning model to support prioritisation based on the
              organization&apos;s recorded risk-scoring conventions.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * 8 — Cybersecurity & external intelligence
 * ------------------------------------------------------------------ */

const INTEL_POINTS: Array<{ icon: LucideIcon; title: string; description: string }> = [
  {
    icon: ScanSearch,
    title: 'Severity context',
    description: 'See how an external finding maps onto the severity bands already used in your register.',
  },
  {
    icon: Radar,
    title: 'Exploitation signals',
    description: 'Reference known-exploited advisories where the supported source publishes them.',
  },
  {
    icon: Globe,
    title: 'Public exposure checks',
    description: 'Review public DNS and resolution information as part of a vendor assessment.',
  },
  {
    icon: ClipboardList,
    title: 'Remediation tracking',
    description: 'Record findings alongside the internal remediation work already in progress.',
  },
];

export function ThreatIntelligenceSection() {
  return (
    <Section id="intelligence">
      <Reveal>
        <SectionHeading
          eyebrow="External Threat Intelligence"
          title="Gain Context Beyond Your Internal Risk Register."
          description="Bring external vulnerability and threat intelligence into your risk assessment workflow. Supported checks provide additional context for reviewing vendor and cybersecurity risks."
        />
      </Reveal>

      <div className="mt-14 grid gap-5 lg:grid-cols-[1.15fr_1fr] lg:items-start">
        <Reveal>
          <ThreatIntelPanel />
        </Reveal>
        <Reveal delay={120}>
          <div className="grid gap-4 sm:grid-cols-2">
            {INTEL_POINTS.map((point) => (
              <div key={point.title} className="landing-card p-5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-secondary/25 bg-secondary/10 text-secondary">
                  <point.icon className="h-4 w-4" aria-hidden />
                </span>
                <p className="mt-3 text-sm font-semibold text-foreground">{point.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{point.description}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 px-1 text-xs leading-relaxed text-muted">
            External intelligence checks are advisory, run on request, and depend on the availability and freshness of
            their respective sources.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * 9 — Reporting & analytics
 * ------------------------------------------------------------------ */

const REPORT_HIGHLIGHTS = [
  'PDF report exports',
  'CSV report exports',
  'Organized risk information',
  'Assessment and report history',
];

export function ReportingSection() {
  return (
    <Section id="reporting" className="bg-surface/40">
      <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-16">
        <Reveal>
          <SectionHeading
            align="left"
            eyebrow="Reporting & Insights"
            title="From Risk Data to Actionable Reports."
            description="Transform organized risk information into structured reports that support analysis, documentation, and informed organizational decisions."
          />
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {REPORT_HIGHLIGHTS.map((highlight) => (
              <li
                key={highlight}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-surface/60 px-3 py-2.5"
              >
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span className="text-xs font-medium text-foreground">{highlight}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs leading-relaxed text-muted">
            Report layout is fixed: the platform does not offer custom branding or templating.
          </p>
        </Reveal>

        <Reveal delay={120}>
          <ReportPreview />
        </Reveal>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * 10 — Security & organizational isolation
 * ------------------------------------------------------------------ */

const SECURITY_CARDS: Array<{ icon: LucideIcon; title: string; description: string }> = [
  {
    icon: Layers,
    title: 'Organizational Isolation',
    description: 'Every record belongs to an organization, and requests are scoped to the appropriate organization.',
  },
  {
    icon: Users,
    title: 'Role-Based Access',
    description: 'Permissions are managed through four roles: Admin, Risk Manager, Analyst, and Viewer.',
  },
  {
    icon: KeyRound,
    title: 'Secure Authentication',
    description: 'JWT-based authentication and Argon2id password hashing support secure account access.',
  },
  {
    icon: ScrollText,
    title: 'Auditability',
    description: 'An append-only, organization-scoped audit trail records supported organizational activities.',
  },
];

export function SecuritySection() {
  return (
    <Section id="security">
      <Reveal>
        <SectionHeading
          eyebrow="Built With Control In Mind"
          title="Your Organization. Your Data. Your Risk Workspace."
          description="FinRisk AI is designed with organization-level data isolation and role-based access control to help keep each organization's risk records within its own workspace."
        />
      </Reveal>

      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {SECURITY_CARDS.map((card, index) => (
          <Reveal key={card.title} delay={index * 80}>
            <div className="landing-card flex h-full flex-col p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-raised text-primary">
                <card.icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-sm font-semibold tracking-tight text-foreground">{card.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted">{card.description}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={160}>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 rounded-xl border border-border bg-surface/50 px-5 py-4 text-center">
          <Lock className="h-4 w-4 text-primary" aria-hidden />
          <p className="text-xs text-muted">
            No certifications or compliance accreditations are claimed — the platform documents what it enforces.
          </p>
        </div>
      </Reveal>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * 11 — How it works
 * ------------------------------------------------------------------ */

const WORKFLOW_STEPS: Array<{ step: string; title: string; description: string; icon: LucideIcon }> = [
  {
    step: '01',
    title: 'Organize',
    description: 'Create your organization, manage members, and establish your centralized risk workspace.',
    icon: Layers,
  },
  {
    step: '02',
    title: 'Assess',
    description: 'Record assets, financial assumptions, vendor information, vulnerabilities, and identified risks.',
    icon: ClipboardList,
  },
  {
    step: '03',
    title: 'Analyze',
    description: 'Evaluate risk scores, model financial scenarios, and prioritize findings using available analytical tools.',
    icon: LineChart,
  },
  {
    step: '04',
    title: 'Report',
    description: 'Generate structured reports and track mitigation and remediation activities.',
    icon: FileText,
  },
];

export function WorkflowSection() {
  const { ref, inView } = useInViewOnce<HTMLDivElement>('0px 0px -25% 0px');

  return (
    <Section id="workflow" className="bg-surface/40">
      <Reveal>
        <SectionHeading
          eyebrow="The Workflow"
          title="From Risk Identification to Informed Decisions."
          description="A structured workflow that helps organizations organize, assess, analyze, and report their risks."
        />
      </Reveal>

      <div ref={ref} className="relative mt-16 grid gap-10 lg:grid-cols-4 lg:gap-8">
        <div aria-hidden className="absolute left-7 right-7 top-7 hidden h-px bg-border lg:block">
          <div
            className={cn(
              'h-px origin-left bg-primary transition-transform duration-[1400ms] ease-smooth motion-reduce:transition-none',
              inView ? 'scale-x-100' : 'scale-x-0',
            )}
          />
        </div>

        {WORKFLOW_STEPS.map((step, index) => (
          <Reveal key={step.step} delay={index * 120} className="relative">
            <div className="flex flex-col">
              <span className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-canvas text-sm font-semibold tabular-nums text-primary">
                {step.step}
              </span>
              <span className="mt-5 flex items-center gap-2">
                <step.icon className="h-4 w-4 text-secondary" aria-hidden />
                <h3 className="text-sm font-semibold tracking-tight text-foreground">{step.title}</h3>
              </span>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">{step.description}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * 12 — Responsible analytics & transparency
 * ------------------------------------------------------------------ */

const PRINCIPLES: Array<{ icon: LucideIcon; title: string; description: string }> = [
  {
    icon: Gauge,
    title: 'Explainable scoring',
    description: 'Every risk score and severity band is accompanied by the rule that produced it.',
  },
  {
    icon: CircleDollarSign,
    title: 'Honest financial representation',
    description: 'Missing financial values remain distinct from zero-valued figures.',
  },
  {
    icon: Coins,
    title: 'Currency integrity',
    description: 'Financial amounts retain their original currency and are never silently converted or combined across currencies.',
  },
  {
    icon: FlaskConical,
    title: 'Clear demonstration data',
    description: 'Synthetic demonstration records are explicitly identified and are not presented as real organizational evidence.',
  },
  {
    icon: BrainCircuit,
    title: 'Responsible machine learning',
    description: 'Model outputs are distinguished from real-world probabilities, and model explanations are not presented as causal claims.',
  },
];

export function TransparencySection() {
  return (
    <Section id="transparency" className="relative overflow-hidden bg-sidebar">
      <div
        aria-hidden
        className="landing-aurora pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[52rem] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
      />
      <Reveal>
        <SectionHeading
          eyebrow="Transparency By Design"
          title="Trust the Analysis. Understand the Assumptions."
          description="Risk analysis is only as useful as the assumptions and rules behind it. FinRisk AI emphasizes transparent scoring, clear financial representations, and responsible interpretation of analytical outputs."
        />
      </Reveal>

      <div className="relative mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PRINCIPLES.map((principle, index) => (
          <Reveal
            key={principle.title}
            delay={index * 70}
            className={cn(index === 4 && 'md:col-span-2 lg:col-span-1')}
          >
            <div className="flex h-full items-start gap-4 rounded-2xl border border-border bg-surface/50 p-5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                <principle.icon className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-primary">
                  {String(index + 1).padStart(2, '0')} · {principle.title}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{principle.description}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * 13 — Who is it for
 * ------------------------------------------------------------------ */

const AUDIENCES: Array<{ icon: LucideIcon; title: string; description: string }> = [
  {
    icon: Banknote,
    title: 'Financial Analysts',
    description: 'Model financial scenarios and organize potential exposure for structured analysis.',
  },
  {
    icon: Gauge,
    title: 'Risk Management Teams',
    description: 'Maintain centralized risk records, evaluate severity, and track mitigation activities.',
  },
  {
    icon: ShieldCheck,
    title: 'Cybersecurity Teams',
    description: 'Organize vulnerability findings and monitor remediation workflows.',
  },
  {
    icon: Users,
    title: 'Business & Operations Teams',
    description: 'Evaluate organizational and third-party risks through structured assessment.',
  },
];

export function AudienceSection() {
  return (
    <Section id="audience">
      <Reveal>
        <SectionHeading
          eyebrow="Designed For Risk-Aware Teams"
          title="Built for Teams That Need Better Risk Visibility."
          description="FinRisk AI supports the people who own risk day to day. It is a decision-support workspace, not a replacement for specialized financial, cybersecurity, or enterprise risk professionals."
        />
      </Reveal>

      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {AUDIENCES.map((audience, index) => (
          <Reveal key={audience.title} delay={index * 80}>
            <div className="landing-card flex h-full flex-col p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-secondary/25 bg-secondary/10 text-secondary">
                <audience.icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 text-sm font-semibold tracking-tight text-foreground">{audience.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted">{audience.description}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * 14 — Frequently asked questions
 * ------------------------------------------------------------------ */

const FAQS = [
  {
    question: 'What is FinRisk AI?',
    answer:
      'FinRisk AI is a financial and cyber risk intelligence platform that combines risk registers, financial loss scenario modelling, vulnerability tracking, third-party vendor assessment, reporting, and optional machine-learning risk prioritisation.',
  },
  {
    question: 'What types of risks can I manage?',
    answer:
      'You can organize financial, cybersecurity, vulnerability, third-party, and other organizational risks within the centralized risk management workspace.',
  },
  {
    question: 'How does financial loss modelling work?',
    answer:
      'Financial modelling uses entered financial figures and configurable assumptions to calculate potential scenario outcomes. Results depend on the assumptions supplied and should not be interpreted as guaranteed forecasts.',
  },
  {
    question: 'Does FinRisk AI use machine learning?',
    answer:
      'Yes. The platform includes an optional machine-learning component for risk prioritisation. It can fall back to a rule-based baseline when sufficient training data is unavailable.',
  },
  {
    question: 'Can multiple organizations use the platform?',
    answer:
      'Yes. The platform uses organization-level data scoping, so records and requests are associated with their respective organizations.',
  },
  {
    question: 'Can I export reports?',
    answer: 'Yes. The reporting functionality supports PDF and CSV exports.',
  },
  {
    question: 'Does FinRisk AI provide real-time threat monitoring?',
    answer:
      'No continuous scheduled background monitoring is currently provided. External intelligence checks run on request and depend on the availability of supported sources.',
  },
  {
    question: 'Can FinRisk AI replace professional risk assessment?',
    answer:
      'No. FinRisk AI is designed to support risk analysis and decision-making. Its scores and scenario results should be interpreted alongside professional judgment and relevant organizational context.',
  },
];

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <Section id="faq" className="bg-surface/40">
      <Reveal>
        <SectionHeading eyebrow="FAQ" title="Questions? We've Got Answers." />
      </Reveal>

      <Reveal delay={100}>
        <div className="mx-auto mt-12 max-w-3xl divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/60">
          {FAQS.map((faq, index) => {
            const open = openIndex === index;
            return (
              <div key={faq.question}>
                <h3>
                  <button
                    type="button"
                    onClick={() => setOpenIndex(open ? null : index)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors duration-200 hover:bg-surface-raised/40"
                  >
                    <span className="text-sm font-medium text-foreground">{faq.question}</span>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 shrink-0 text-muted transition-transform duration-300 ease-smooth',
                        open && 'rotate-180 text-primary',
                      )}
                      aria-hidden
                    />
                  </button>
                </h3>
                <div
                  className={cn(
                    'grid transition-[grid-template-rows] duration-300 ease-smooth motion-reduce:transition-none',
                    open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                  )}
                >
                  <div className="overflow-hidden">
                    <p className="px-5 pb-5 text-sm leading-relaxed text-muted">{faq.answer}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Reveal>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * 15 — Final call to action
 * ------------------------------------------------------------------ */

export function FinalCtaSection() {
  return (
    <Section id="cta" className="relative overflow-hidden">
      <div
        aria-hidden
        className="landing-aurora pointer-events-none absolute left-1/2 top-1/2 h-[30rem] w-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-3xl"
      />
      <Reveal>
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-[1.85rem] font-semibold leading-[1.15] tracking-tight text-foreground sm:text-[2.4rem] lg:text-[3rem]">
            Make Risk Visibility Your Competitive Advantage.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted">
            Bring financial and cyber risk management into one unified workspace. Understand your exposure, evaluate
            potential impact, and make more informed decisions with FinRisk AI.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <CtaLink to="/register" size="lg" className="w-full gap-2 sm:w-auto">
              Get Started
              <ArrowRight className="h-4 w-4" aria-hidden />
            </CtaLink>
            <button
              type="button"
              onClick={() => scrollToSection('platform')}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface/60 px-5 text-[0.95rem] font-medium text-foreground transition-[background-color,border-color] duration-200 hover:border-border-strong hover:bg-surface-raised sm:w-auto"
            >
              Explore the Platform
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="mt-6 text-xs text-muted">
            One workspace. Multiple dimensions of risk. Better-informed decisions.
          </p>
        </div>
      </Reveal>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Hero
 * ------------------------------------------------------------------ */

export function HeroSection() {
  return (
    <section id="home" className="relative scroll-mt-24 overflow-hidden px-5 pb-20 pt-28 sm:px-8 lg:pb-28 lg:pt-36">
      <div aria-hidden className="landing-grid pointer-events-none absolute inset-0 -z-10" />
      <div
        aria-hidden
        className="landing-aurora pointer-events-none absolute -top-32 left-1/4 h-[32rem] w-[38rem] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
      />

      <div className="mx-auto grid w-full max-w-7xl gap-14 lg:grid-cols-[1.05fr_1.15fr] lg:items-center lg:gap-12">
        <Reveal>
          <Eyebrow>Financial &amp; Cyber Risk Intelligence</Eyebrow>
          <h1 className="mt-5 text-balance text-[2.1rem] font-semibold leading-[1.08] tracking-tight text-foreground sm:text-[2.9rem] lg:text-[3.35rem]">
            Understand Risk.
            <br />
            <span className="text-primary">Quantify Impact.</span>
            <br />
            Stay Ahead.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted">
            An integrated risk intelligence platform that helps organizations assess financial exposure, identify
            cybersecurity vulnerabilities, evaluate third-party risks, and make informed decisions through structured
            analytics and intelligent risk prioritisation.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => scrollToSection('platform')}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[0.95rem] font-medium text-primary-foreground shadow-glow transition-[filter] duration-200 hover:brightness-110"
            >
              Explore the Platform
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
            <CtaLink to="/register" variant="outline" size="lg">
              Get Started
            </CtaLink>
          </div>

          <p className="mt-6 flex items-center gap-2 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            Financial intelligence. Cyber risk visibility. Better-informed decisions.
          </p>
        </Reveal>

        <Reveal delay={140}>
          <DashboardPreview />
        </Reveal>
      </div>
    </section>
  );
}
