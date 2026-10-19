import {
  Activity,
  Bot,
  Boxes,
  ClipboardList,
  FileBarChart,
  Gauge,
  Layers,
  PiggyBank,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Short line shown in the sidebar tooltip and the page description. */
  hint: string;
  /** Capability required to see the entry; hidden when the role lacks it. */
  permission?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * The eleven required sections, plus the preserved TILT vendor-assessment
 * module. Grouped so the sidebar stays readable at eleven-plus entries.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Monitor',
    items: [
      {
        to: '/overview',
        label: 'Overview',
        icon: Gauge,
        hint: 'Organization-wide risk posture, exposure and activity',
        permission: 'risk:read',
      },
      {
        to: '/ai-insights',
        label: 'AI Insights',
        icon: Bot,
        hint: 'Model status, predictions and deterministic observations',
        permission: 'ai:read',
      },
    ],
  },
  {
    label: 'Assess',
    items: [
      {
        to: '/risks',
        label: 'Risk Intelligence',
        icon: ShieldAlert,
        hint: 'The risk register: scoring, treatment and ownership',
        permission: 'risk:read',
      },
      {
        to: '/cybersecurity',
        label: 'Cybersecurity',
        icon: ShieldCheck,
        hint: 'Vulnerability findings, enrichment and context-aware priority',
        permission: 'vulnerability:read',
      },
      {
        to: '/assets',
        label: 'Asset Registry',
        icon: Boxes,
        hint: 'Systems, data stores and business processes in scope',
        permission: 'asset:read',
      },
    ],
  },
  {
    label: 'Quantify',
    items: [
      {
        to: '/financial-exposure',
        label: 'Financial Exposure',
        icon: PiggyBank,
        hint: 'Scenario-based loss estimates by risk, asset and business unit',
        permission: 'financial:read',
      },
      {
        to: '/risk-scenarios',
        label: 'Risk Scenarios',
        icon: Activity,
        hint: 'Model a what-if case and compare it against the register',
        permission: 'financial:read',
      },
    ],
  },
  {
    label: 'Treat',
    items: [
      {
        to: '/mitigation-plans',
        label: 'Mitigation Plans',
        icon: ClipboardList,
        hint: 'Remediation actions, owners, due dates and status',
        permission: 'mitigation:read',
      },
    ],
  },
  {
    label: 'Govern',
    items: [
      {
        to: '/reports',
        label: 'Reports',
        icon: FileBarChart,
        hint: 'Generate, review and download board and register reports',
        permission: 'report:read',
      },
      {
        to: '/audit-logs',
        label: 'Audit Logs',
        icon: ScrollText,
        hint: 'Who changed what, and when',
        permission: 'audit:read',
      },
      {
        to: '/settings',
        label: 'Settings',
        icon: Settings,
        hint: 'Organization, members, roles and your own account',
      },
    ],
  },
  {
    label: 'Preserved modules',
    items: [
      {
        to: '/vendor-assessments',
        label: 'Vendor Assessments',
        icon: Layers,
        hint: 'The retained TILT third-party questionnaire and cloud scorecard',
        permission: 'risk:read',
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Longest-prefix match so `/risks/12` still highlights "Risk Intelligence". */
export function findNavItem(pathname: string): NavItem | undefined {
  const matches = ALL_NAV_ITEMS.filter(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
  return matches.sort((a, b) => b.to.length - a.to.length)[0];
}
