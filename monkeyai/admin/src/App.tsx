import { useEffect } from "react"
import { DirectionProvider } from "@base-ui/react/direction-provider"
import { useTranslation } from "react-i18next"
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom"

import { Dashboard } from "@/components/dashboard"
import { useAuth } from "@/hooks/use-auth"
import {
  CONSOLE_PAGES,
  CONSOLE_PATH,
  CONSOLE_ROUTES,
  DEFAULT_CONSOLE_PATH,
  LOGIN_PATH,
} from "@/lib/routes"
import { ConsolePage } from "@/pages/console-page"
import { BillingDetailsPage } from "@/pages/billing-details-page"
import { BillingSettingsPage } from "@/pages/billing-settings-page"
import { ExpertsPage } from "@/pages/experts-page"
import { KnowledgeBasesPage } from "@/pages/knowledge-bases-page"
import { LoginPage } from "@/pages/login-page"
import { ClientLoginPage } from "@/pages/client-login-page"
import { MembersAndGroupsPage } from "@/pages/members-and-groups-page"
import { ModelStatisticsPage } from "@/pages/model-statistics-page"
import { ModelsPage } from "@/pages/models-page"
import { OperationLogsPage } from "@/pages/operation-logs-page"
import { OtherSettingsPage } from "@/pages/other-settings-page"
import { RealtimeStatusPage } from "@/pages/realtime-status-page"
import { RulesPage } from "@/pages/rules-page"
import { SkillsPage } from "@/pages/skills-page"
import { TaskHistoryPage } from "@/pages/task-history-page"
import { TaskStatisticsPage } from "@/pages/task-statistics-page"
import { ToolsPage } from "@/pages/tools-page"

function RootRedirect() {
  const { isLoading, user } = useAuth()

  if (isLoading) return <PageLoading />

  return (
    <Navigate
      to={user?.role === "admin" ? DEFAULT_CONSOLE_PATH : LOGIN_PATH}
      replace
    />
  )
}

function RequireAuth() {
  const { isLoading, user } = useAuth()
  const location = useLocation()

  if (isLoading) return <PageLoading />

  if (user?.role !== "admin") {
    return (
      <Navigate
        to={LOGIN_PATH}
        replace
        state={{
          from: `${location.pathname}${location.search}${location.hash}`,
        }}
      />
    )
  }

  return <Outlet />
}

function PageLoading() {
  return (
    <main
      className="flex min-h-svh items-center justify-center bg-background text-sm text-muted-foreground"
      role="status"
    >
      正在检查登录状态…
    </main>
  )
}

export function App() {
  const { i18n, t } = useTranslation()

  useEffect(() => {
    document.title = t("app.documentTitle")
  }, [t])

  return (
    <DirectionProvider direction={i18n.dir()}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path={LOGIN_PATH} element={<LoginPage />} />
        <Route path="/client-login" element={<ClientLoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path={CONSOLE_PATH} element={<Dashboard />}>
            <Route
              index
              element={<Navigate to={DEFAULT_CONSOLE_PATH} replace />}
            />
            {CONSOLE_PAGES.map((page) => (
              <Route
                key={page.path}
                path={page.path.slice(CONSOLE_PATH.length + 1)}
                element={
                  page.path === CONSOLE_ROUTES.realtimeStatus ? (
                    <RealtimeStatusPage />
                  ) : page.path === CONSOLE_ROUTES.taskStatistics ? (
                    <TaskStatisticsPage />
                  ) : page.path === CONSOLE_ROUTES.modelStatistics ? (
                    <ModelStatisticsPage />
                  ) : page.path === CONSOLE_ROUTES.taskHistory ? (
                    <TaskHistoryPage />
                  ) : page.path === CONSOLE_ROUTES.models ? (
                    <ModelsPage />
                  ) : page.path === CONSOLE_ROUTES.knowledgeBases ? (
                    <KnowledgeBasesPage />
                  ) : page.path === CONSOLE_ROUTES.rules ? (
                    <RulesPage />
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
                  ) : page.path === CONSOLE_ROUTES.operationLogs ? (
                    <OperationLogsPage />
                  ) : page.path === CONSOLE_ROUTES.otherSettings ? (
                    <OtherSettingsPage />
                  ) : (
                    <ConsolePage />
                  )
                }
              />
            ))}
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
