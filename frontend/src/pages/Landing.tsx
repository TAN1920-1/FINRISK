import { LandingFooter, LandingNav } from '@/components/landing/LandingChrome';
import {
  AudienceSection,
  CapabilitiesSection,
  FaqSection,
  FinalCtaSection,
  FinancialShowcaseSection,
  HeroSection,
  PlatformSection,
  ReportingSection,
  RiskAnalyticsSection,
  SecuritySection,
  ThreatIntelligenceSection,
  TransparencySection,
  WorkflowSection,
} from '@/components/landing/LandingSections';

/**
 * Public landing page.
 *
 * This route is intentionally unauthenticated: it is the only page a visitor
 * sees before signing in, so it must explain the product without requiring an
 * account. All marketing copy is derived from the platform's real behaviour and
 * documented limitations — scores are decision support, not forecasts, and the
 * product previews are labelled as illustrative rather than live figures.
 */
export function LandingPage() {
  return (
    <div className="min-h-screen bg-canvas text-foreground">
      <LandingNav />
      <main id="main">
        <HeroSection />
        <PlatformSection />
        <CapabilitiesSection />
        <FinancialShowcaseSection />
        <RiskAnalyticsSection />
        <ThreatIntelligenceSection />
        <ReportingSection />
        <SecuritySection />
        <WorkflowSection />
        <TransparencySection />
        <AudienceSection />
        <FaqSection />
        <FinalCtaSection />
      </main>
      <LandingFooter />
    </div>
  );
}
