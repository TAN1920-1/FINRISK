import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';

/**
 * One shared query client.
 *
 * `retry` deliberately does not retry 4xx responses: a 403 means the server has
 * already decided, and hammering it three times only delays the message the user
 * needs to see.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export const queryKeys = {
  session: ['session'] as const,
  dashboard: (filters: unknown) => ['dashboard', filters] as const,
  assets: (filters: unknown) => ['assets', filters] as const,
  asset: (id: number | string) => ['asset', id] as const,
  assetOptions: ['assets', 'options'] as const,
  assetRisks: (id: number | string) => ['asset', id, 'risks'] as const,
  risks: (filters: unknown) => ['risks', filters] as const,
  risk: (id: number | string) => ['risk', id] as const,
  riskMeta: ['risks', 'meta'] as const,
  riskOptions: ['risks', 'options'] as const,
  mitigations: (filters: unknown) => ['mitigations', filters] as const,
  mitigation: (id: number | string) => ['mitigation', id] as const,
  mitigationMeta: ['mitigations', 'meta'] as const,
  scenarios: (filters: unknown) => ['scenarios', filters] as const,
  scenario: (id: number | string) => ['scenario', id] as const,
  scenarioMeta: ['scenarios', 'meta'] as const,
  scenarioCompare: (ids: string) => ['scenarios', 'compare', ids] as const,
  findings: (filters: unknown) => ['findings', filters] as const,
  finding: (id: number | string) => ['finding', id] as const,
  findingMeta: ['findings', 'meta'] as const,
  cve: (id: string) => ['cve', id] as const,
  importBatches: ['findings', 'imports'] as const,
  insights: (filters: unknown) => ['ai', 'insights', filters] as const,
  modelStatus: ['ai', 'status'] as const,
  models: ['ai', 'models'] as const,
  reportCatalog: ['reports', 'catalog'] as const,
  reports: (filters: unknown) => ['reports', filters] as const,
  auditLogs: (filters: unknown) => ['audit-logs', filters] as const,
  auditMeta: ['audit-logs', 'meta'] as const,
  notifications: (filters: unknown) => ['notifications', filters] as const,
  notificationSummary: ['notifications', 'summary'] as const,
  members: ['members'] as const,
  roles: ['roles'] as const,
  organization: ['organization'] as const,
  organizationSummary: ['organization', 'summary'] as const,
  vendors: (filters: unknown) => ['vendors', filters] as const,
  vendor: (id: number | string) => ['vendor', id] as const,
  templates: (kind: string) => ['templates', kind] as const,
};
