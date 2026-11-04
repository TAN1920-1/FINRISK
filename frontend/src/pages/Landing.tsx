import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  Zap,
  BarChart3,
  Globe,
  ArrowRight,
  ChevronRight,
  Shield,
  Activity,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Landing Page.
 *
 * Explains what FinRisk AI is, why it exists, and how it helps organizations
 * manage financial and operational risks with intelligence.
 */
export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 border-b border-border bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-glow">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight text-foreground">
              FinRisk <span className="text-primary">AI</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm font-medium text-muted hover:text-foreground">
              Sign in
            </Link>
            <Button variant="primary" size="sm" asChild>
              <Link to="/register">Start using</Link>
            </Button>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden px-4 py-20 sm:px-6 lg:px-8 lg:py-32">
          <div className="hero-surface absolute inset-0 -z-10" />
          <div className="mx-auto max-w-7xl">
            <div className="text-center">
              <h1 className="text-4xl font-extrabold tracking-tight text-foreground sm:text-6xl">
                Intelligence-Driven <span className="text-primary">Risk Management</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
                FinRisk AI is a premium, enterprise-grade financial intelligence platform designed
                to model, analyze, and mitigate complex organizational risks in real-time.
              </p>
              <div className="mt-10 flex items-center justify-center gap-4">
                <Button size="lg" variant="primary" asChild>
                  <Link to="/register" className="gap-2">
                    Get Started <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <a href="#how-it-works">Learn more</a>
                </Button>
              </div>
            </div>

            <div className="mt-20 flex justify-center">
              <div className="relative rounded-2xl border border-border bg-surface p-2 shadow-2xl lg:max-w-5xl">
                <img
                  src="https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=modern+enterprise+financial+dashboard+ui+clean+white+theme+glassmorphism+charts+data+visualization&image_size=landscape_16_9"
                  alt="FinRisk AI Dashboard Preview"
                  className="rounded-xl shadow-inner"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Motive & Why Section */}
        <section className="bg-surface py-24 sm:py-32">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  Why FinRisk AI?
                </h2>
                <p className="mt-4 text-lg text-muted">
                  Traditional risk management is reactive, siloed, and slow. We built FinRisk AI to
                  transform how organizations perceive and handle uncertainty.
                </p>
                <dl className="mt-10 space-y-8">
                  <div className="relative pl-12">
                    <dt className="text-base font-semibold text-foreground">
                      <div className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Lock className="h-5 w-5" />
                      </div>
                      Institutional Security
                    </dt>
                    <dd className="mt-2 text-sm text-muted">
                      Every record is scoped to your organization with strict access controls and a
                      tamper-proof audit trail.
                    </dd>
                  </div>
                  <div className="relative pl-12">
                    <dt className="text-base font-semibold text-foreground">
                      <div className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Activity className="h-5 w-5" />
                      </div>
                      Real-time Posture
                    </dt>
                    <dd className="mt-2 text-sm text-muted">
                      Move beyond static reports. Get an instant view of your risk score, exposure,
                      and financial stability.
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-4">
                  <img
                    src="https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=abstract+financial+data+visualization+teal+and+blue+gradients+modern+clean&image_size=portrait_4_3"
                    alt="Financial Data"
                    className="rounded-2xl shadow-lg"
                  />
                  <div className="rounded-2xl bg-primary p-6 text-primary-foreground">
                    <p className="text-2xl font-bold">100%</p>
                    <p className="text-xs opacity-80 uppercase tracking-wider">Visibility</p>
                  </div>
                </div>
                <div className="mt-8 space-y-4">
                  <div className="rounded-2xl bg-secondary p-6 text-secondary-foreground">
                    <p className="text-2xl font-bold">Real-time</p>
                    <p className="text-xs opacity-80 uppercase tracking-wider">Analysis</p>
                  </div>
                  <img
                    src="https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=cybersecurity+risk+analysis+abstract+clean+minimal&image_size=portrait_4_3"
                    alt="Cybersecurity Risk"
                    className="rounded-2xl shadow-lg"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="py-24 sm:py-32">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              How It Works
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">
              FinRisk AI streamlines the entire risk lifecycle, from discovery to resolution.
            </p>
            <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  title: 'Inventory',
                  description: 'Map your critical assets and business units to understand the blast radius.',
                  icon: Globe,
                },
                {
                  title: 'Identify',
                  description: 'Record risks, vulnerabilities, and findings with deep context and ownership.',
                  icon: Zap,
                },
                {
                  title: 'Analyze',
                  description: 'Model financial scenarios to quantify potential loss and exposure.',
                  icon: BarChart3,
                },
                {
                  title: 'Mitigate',
                  description: 'Track remediation plans and track improvements in your risk posture.',
                  icon: Shield,
                },
              ].map((step, index) => (
                <div key={index} className="group relative flex flex-col items-center p-6 text-center">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-surface border border-border text-primary shadow-sm group-hover:border-primary/30 group-hover:shadow-glow transition-all">
                    <step.icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="bg-primary px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-primary-foreground sm:text-4xl">
              Ready to secure your organization?
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-primary-foreground/80">
              Join leading organizations using FinRisk AI to transform uncertainty into intelligence.
            </p>
            <div className="mt-10 flex items-center justify-center gap-4">
              <Button size="lg" variant="secondary" asChild className="bg-surface text-foreground hover:bg-surface-muted border-none">
                <Link to="/register">Create Organization</Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10">
                <Link to="/login">Sign In</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <span className="text-sm font-bold tracking-tight text-foreground">
                FinRisk AI
              </span>
            </div>
            <p className="text-xs text-muted">
              © 2026 FinRisk AI. All rights reserved. Built for intelligence.
            </p>
            <div className="flex gap-6">
              <a href="#" className="text-xs text-muted hover:text-foreground">Terms</a>
              <a href="#" className="text-xs text-muted hover:text-foreground">Privacy</a>
              <a href="#" className="text-xs text-muted hover:text-foreground">Support</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
