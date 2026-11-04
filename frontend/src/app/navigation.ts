import {
  Activity,
  Bot,
  Boxes,
  ClipboardList,
  FileBarChart,
  Gauge,
  History,
  Layers,
  PieChart,
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
 * Navigation items updated to match the Bloomberg Terminal aesthetic from the user prompt.
 * Group labels are kept for internal organization but can be hidden in the UI.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Intelligence',
    items: [
      {
        to: '/overview',
        label: 'Overview',
        icon: Gauge,
        hint: 'Organization-wide risk posture, exposure and activity',
        permission: 'risk:read',
      },
      {
        to: '/risks',
        label: 'Risk Assessment',
        icon: ShieldAlert,
        hint: 'The risk register: scoring, treatment and ownership',
        permission: 'risk:read',
      },
      {
        to: '/financial-exposure',
        label: 'Financial Analysis',
        icon: Boxes,
        hint: 'Scenario-based loss estimates by risk, asset and business unit',
        permission: 'financial:read',
      },
      {
        to: '/cybersecurity',
        label: 'Portfolio Analysis',
        icon: PieChart,
        hint: 'Vulnerability findings, enrichment and context-aware priority',
        permission: 'vulnerability:read',
      },
      {
        to: '/reports',
        label: 'Risk Reports',
        icon: FileBarChart,
        hint: 'Generate, review and download board and register reports',
        permission: 'report:read',
      },
      {
        to: '/audit-logs',
        label: 'Historical Analysis',
        icon: History,
        hint: 'Who changed what, and when',
        permission: 'audit:read',
      },
      {
        to: '/ai-insights',
        label: 'AI Insights',
        icon: Bot,
        hint: 'Model status, predictions and deterministic observations',
        permission: 'ai:read',
      },
      {
        to: '/risk-scenarios',
        label: 'Scenario Simulation',
        icon: Activity,
        hint: 'Model a what-if case and compare it against the register',
        permission: 'financial:read',
      },
    ],
  },
];

/** Pinned to the foot of the sidebar, below the analytical sections. */
export const SETTINGS_NAV_ITEM: NavItem = {
  to: '/settings',
  label: 'Settings',
  icon: Settings,
  hint: 'Organization, members, roles and your own account',
};

export const ALL_NAV_ITEMS: NavItem[] = [
  ...NAV_GROUPS.flatMap((group) => group.items),
  SETTINGS_NAV_ITEM,
];

/** Longest-prefix match so `/risks/12` still highlights "Risk Intelligence". */
export function findNavItem(pathname: string): NavItem | undefined {
  const matches = ALL_NAV_ITEMS.filter(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
  return matches.sort((a, b) => b.to.length - a.to.length)[0];
}
