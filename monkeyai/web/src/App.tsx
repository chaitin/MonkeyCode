import { lazy, Suspense, useEffect } from "react"
import { CloudHostsPage } from "@/pages/admin/cloud-hosts-page"
import { DirectionProvider } from "@base-ui/react/direction-provider"
import { useTranslation } from "react-i18next"
import { Navigate, Outlet, Route, Routes, useLocation, useMatch } from "react-router-dom"

import { ClientPage } from "@/pages/client/client-page"
import { SkillTagsProvider } from "@/components/skill-tags-provider"
import { useBranding } from "@/hooks/use-branding"
import { Dashboard } from "@/components/dashboard"
import { LicenseGuard } from "@/components/license-guard"
import { useAuth } from "@/hooks/use-auth"
import {
  CLIENT_ROUTE,
  CONSOLE_PAGES,
  CONSOLE_PATH,
  CONSOLE_ROUTES,
  DEFAULT_CONSOLE_PATH,
  LOGIN_PATH,
} from "@/lib/routes"
import { ConsolePage } from "@/pages/admin/console-page"
import { BillingDetailsPage } from "@/pages/admin/billing-details-page"
import { BillingSettingsPage } from "@/pages/admin/billing-settings-page"
import { ExpertsPage } from "@/pages/admin/experts-page"
import { FeedbackPage } from "@/pages/admin/feedback-page"
import { KbPage } from "@/pages/admin/kb-page"
import { LandingPage } from "@/pages/landing-page"
import { LoginPage } from "@/pages/login-page"
import { DeviceAuthorizationPage } from "@/pages/device-authorization-page"
import { ClientLoginPage } from "@/pages/client-login-page"
import { ConversationHistoryPage } from "@/pages/admin/conversation-history-page"
import { ClientAnalysisPage } from "@/pages/admin/client-analysis-page"
import { MemberAnalysisPage } from "@/pages/admin/member-analysis-page"
import { TaskAnalysisPage } from "@/pages/admin/task-analysis-page"
import { MembersAndGroupsPage } from "@/pages/admin/members-and-groups-page"
import { ModelsPage } from "@/pages/admin/models-page"
import { OperationLogsPage } from "@/pages/admin/operation-logs-page"
import { OtherSettingsPage } from "@/pages/admin/other-settings-page"
import { OverviewPage } from "@/pages/admin/overview-page"
import { RealtimeStatusPage } from "@/pages/admin/realtime-status-page"
import { SecurityPage } from "@/pages/admin/security-page"
import { RulesPage } from "@/pages/admin/rules-page"
import { ResourceImportsPage } from "@/pages/admin/resource-imports-page"
import { SkillsPage } from "@/pages/admin/skills-page"
import { TaskHistoryPage } from "@/pages/admin/task-history-page"
import { ResourceAnalysisPage } from "@/pages/admin/resource-analysis-page"
import { SessionDetailPage } from "@/pages/admin/session-detail-page"
import { ToolsPage } from "@/pages/admin/tools-page"

const KbDocumentPage = lazy(() => import("@/pages/admin/kb-document-page"))
const KbDetailPage = lazy(() => import("@/pages/admin/kb-detail-page"))

function RequireAuth({ client = false }: { client?: boolean }) {
  const { isLoading, user } = useAuth()
  if (isLoading) return <PageLoading />
  if (!user) return <Navigate to={LOGIN_PATH} replace />
  if (client) return <Outlet />
  if (user.role === "group_admin") return <SkillTagsProvider><Outlet /></SkillTagsProvider>
  if (user.role !== "admin") return <Navigate to="/client" replace />

  return (
    <LicenseGuard>
      <SkillTagsProvider>
        <Outlet />
      </SkillTagsProvider>
    </LicenseGuard>
  )
}

function PageLoading() {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground"
      role="status"
    >
      正在检查登录状态…
    </main>
  )
}

export function App() {
  const { i18n, t } = useTranslation()
  const location = useLocation()

  const isClient = useMatch(CLIENT_ROUTE) !== null
  const { branding } = useBranding()

  useEffect(() => {
    if (isClient) {
      document.title = branding.product_name
    } else if (location.pathname !== LOGIN_PATH && location.pathname !== "/") {
      document.title = t("app.documentTitle")
    }
  }, [branding.product_name, isClient, location.pathname, t])

  return (
    <DirectionProvider direction={i18n.dir()}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path={LOGIN_PATH} element={<LoginPage />} />
        <Route path="/device" element={<DeviceAuthorizationPage />} />
        <Route path="/client-login" element={<ClientLoginPage />} />
        <Route element={<RequireAuth client />}>
          <Route path={CLIENT_ROUTE} element={<ClientPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path={CONSOLE_PATH} element={<Dashboard />}>
            <Route
              index
              element={<Navigate to={DEFAULT_CONSOLE_PATH} replace />}
            />
            <Route
              path="resources/knowledge-bases"
              element={<Navigate to={CONSOLE_ROUTES.kb} replace />}
            />
            {CONSOLE_PAGES.map((page) => (
              <Route
                key={page.path}
                path={page.path.slice(CONSOLE_PATH.length + 1)}
                element={
                  page.path === CONSOLE_ROUTES.overview ? (
                    <OverviewPage />
                  ) : page.path === CONSOLE_ROUTES.cloudHosts ? (
                    <CloudHostsPage />
                  ) : page.path === CONSOLE_ROUTES.realtimeStatus ? (
                    <RealtimeStatusPage />
                  ) : page.path === CONSOLE_ROUTES.taskHistory ? (
                    <TaskHistoryPage />
                  ) : page.path === CONSOLE_ROUTES.conversationHistory ? (
                    <ConversationHistoryPage />
                  ) : page.path === CONSOLE_ROUTES.memberAnalysis ? (
                    <MemberAnalysisPage />
                  ) : page.path === CONSOLE_ROUTES.taskAnalysis ? (
                    <TaskAnalysisPage />
                  ) : page.path === CONSOLE_ROUTES.resourceAnalysis ? (
                    <ResourceAnalysisPage />
                  ) : page.path === CONSOLE_ROUTES.clientAnalysis ? (
                    <ClientAnalysisPage />
                  ) : page.path === CONSOLE_ROUTES.models ? (
                    <ModelsPage />
                  ) : page.path === CONSOLE_ROUTES.kb ? (
                    <KbPage />
                  ) : page.path === CONSOLE_ROUTES.rules ? (
                    <RulesPage />
                  ) : page.path === CONSOLE_ROUTES.resourceImports ? (
                    <ResourceImportsPage />
                  ) : page.path === CONSOLE_ROUTES.skills ? (
                    <SkillsPage />
                  ) : page.path === CONSOLE_ROUTES.experts ? (
                    <ExpertsPage />
                  ) : page.path === CONSOLE_ROUTES.tools ? (
                    <ToolsPage />
                  ) : page.path === CONSOLE_ROUTES.billingDetails ? (
                    <BillingDetailsPage />
                  ) : page.path === CONSOLE_ROUTES.billingSettings ? (
                    <BillingSettingsPage />
                  ) : page.path === CONSOLE_ROUTES.membersAndGroups ? (
                    <MembersAndGroupsPage />
                  ) : page.path === CONSOLE_ROUTES.feedback ? (
                    <FeedbackPage />
                  ) : page.path === CONSOLE_ROUTES.operationLogs ? (
                    <OperationLogsPage />
                  ) : page.path === CONSOLE_ROUTES.security ? (
                    <SecurityPage />
                  ) : page.path === CONSOLE_ROUTES.otherSettings ? (
                    <OtherSettingsPage />
                  ) : (
                    <ConsolePage />
                  )
                }
              />
            ))}
            <Route
              path="resources/kb/:kbId"
              element={
                <Suspense fallback={<PageLoading />}>
                  <KbDetailPage />
                </Suspense>
              }
            />
            <Route
              path="resources/kb/:kbId/documents/:documentId"
              element={
                <Suspense fallback={<PageLoading />}>
                  <KbDocumentPage />
                </Suspense>
              }
            />
            <Route
              path={CONSOLE_ROUTES.sessionDetail.slice(CONSOLE_PATH.length + 1)}
              element={<SessionDetailPage />}
            />
            <Route
              path="*"
              element={<Navigate to={DEFAULT_CONSOLE_PATH} replace />}
            />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </DirectionProvider>
  )
}

export default App
