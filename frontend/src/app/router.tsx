import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { LoginPage } from '@/pages/Login';
import { RegisterPage } from '@/pages/Register';
import { NotFoundPage } from '@/pages/NotFound';
import { OverviewPage } from '@/pages/Overview';
import { AiInsightsPage } from '@/pages/AiInsights';
import { RiskRegisterPage } from '@/pages/RiskRegister';
import { RiskDetailPage } from '@/pages/RiskDetail';
import { FinancialExposurePage } from '@/pages/FinancialExposure';
import { RiskScenariosPage } from '@/pages/RiskScenarios';
import { CybersecurityPage } from '@/pages/Cybersecurity';
import { FindingDetailPage } from '@/pages/FindingDetail';
import { AssetRegistryPage } from '@/pages/AssetRegistry';
import { AssetDetailPage } from '@/pages/AssetDetail';
import { MitigationPlansPage } from '@/pages/MitigationPlans';
import { ReportsPage } from '@/pages/Reports';
import { AuditLogsPage } from '@/pages/AuditLogs';
import { SettingsPage } from '@/pages/Settings';
import { VendorAssessmentsPage } from '@/pages/VendorAssessments';
import { VendorDetailPage } from '@/pages/VendorDetail';

/**
 * Route table.
 *
 * Every authenticated path sits under a single `ProtectedRoute` so the session
 * check and the shell are mounted once, and each section is reachable directly
 * by URL. Detail routes are nested under their list route's path prefix so the
 * sidebar keeps the correct entry highlighted.
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    path: '/',
    element: <ProtectedRoute />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: 'overview', element: <OverviewPage /> },
      { path: 'ai-insights', element: <AiInsightsPage /> },
      { path: 'risks', element: <RiskRegisterPage /> },
      { path: 'risks/:riskId', element: <RiskDetailPage /> },
      { path: 'financial-exposure', element: <FinancialExposurePage /> },
      { path: 'risk-scenarios', element: <RiskScenariosPage /> },
      { path: 'cybersecurity', element: <CybersecurityPage /> },
      { path: 'cybersecurity/:findingId', element: <FindingDetailPage /> },
      { path: 'assets', element: <AssetRegistryPage /> },
      { path: 'assets/:assetId', element: <AssetDetailPage /> },
      { path: 'mitigation-plans', element: <MitigationPlansPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'audit-logs', element: <AuditLogsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'vendor-assessments', element: <VendorAssessmentsPage /> },
      { path: 'vendor-assessments/:vendorId', element: <VendorDetailPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
