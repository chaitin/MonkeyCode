import { Route, BrowserRouter, Routes, Navigate, useParams } from "react-router-dom"
import { ThemeProvider, ThemePathListener } from "@/components/theme-provider"
import LoginPage from "@/pages/login"
import WelcomePage from "@/pages/welcome"
import UserConsolePage from "@/pages/console/user/page"
import ManagerConsolePage from "@/pages/console/manager/page"
import TasksPage from "@/pages/console/user/tasks"
import IDEIDE from "@/pages/console/user/ide-ide"
import GitBotsPage from "@/pages/console/user/git-bots"
import TerminalPage from "@/pages/console/user/terminal"
import FileManagerPage from "@/pages/console/user/file-manager"
import { Toaster } from "@/components/ui/sonner"
import SharedTerminalPage from "@/pages/shared-terminal"
import TeamManagerMembers from "./pages/console/manager/members"
import TeamManagerModels from "@/pages/console/manager/models"
import TeamManagerImages from "@/pages/console/manager/images"
import TeamManagerLogs from "@/pages/console/manager/logs"
import TeamManagerHosts from "./pages/console/manager/hosts"
import TeamManagerOverview from "./pages/console/manager/overview"
import TeamManagerProjects from "./pages/console/manager/projects"
import TeamManagerTasks from "./pages/console/manager/tasks"
import TeamManagerConversations from "./pages/console/manager/conversations"
import TeamManagerOIDC from "./pages/console/manager/oidc"
import TeamManagerLicense from "./pages/console/manager/license"
import TeamOIDCLoginPage from "./pages/team-oidc-login"
import ResetPasswordPage from "./pages/resetpassword"
import FindPasswordPage from "./pages/findpassword"
import TeamManagerManager from "./pages/console/manager/manager"
import PlaygroundPage from "./pages/playground"
import PublicTaskPage from "./pages/public-task"
import PostCreatePage from "./pages/post-create"
import ProjectOverviewPage from "./pages/console/user/project/overview"
import TaskDetailPage from "./pages/console/user/task/task-detail"
import PrivacyPolicyPage from "./pages/privacy-policy"
import UserAgreementPage from "./pages/user-agreement"
import { TooltipProvider } from "@/components/ui/tooltip"
import { IS_OFFLINE_EDITION } from "@/utils/edition"

function TaskDetailRoute() {
  const { taskId } = useParams()
  return <TaskDetailPage key={taskId} />
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="monkeycode-theme">
      <TooltipProvider>
        <BrowserRouter>
          <ThemePathListener />
          <Routes>
            <Route path="/" element={IS_OFFLINE_EDITION ? <Navigate to="/login" replace /> : <WelcomePage />} />
            <Route path="/playground" element={<PlaygroundPage />} />
            <Route path="/playground/create" element={<PostCreatePage />} />
            <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
            <Route path="/user-agreement" element={<UserAgreementPage />} />
            <Route path="/tasks/public" element={<PublicTaskPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/team-login/:teamId" element={<TeamOIDCLoginPage />} />
            <Route path="/findpassword" element={<FindPasswordPage />} />
            <Route path="/resetpassword" element={<ResetPasswordPage />} />
            <Route path="/console" element={<UserConsolePage />}>
              <Route index element={<Navigate to="/console/tasks" replace />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="task/:taskId" element={<TaskDetailRoute />} />
              <Route path="project/:projectId" element={<ProjectOverviewPage />} />
              <Route path="gitbot" element={<GitBotsPage />} />
              <Route path="ide" element={<IDEIDE />} />
            </Route>
            <Route path="/console/terminal" element={<TerminalPage />} />
            <Route path="/console/files" element={<FileManagerPage />} />
            <Route path="/sharedterminal" element={<SharedTerminalPage />} />
            <Route path="/manager" element={<ManagerConsolePage />}>
              <Route index element={<Navigate to="/manager/overview" replace />} />
              <Route path="overview" element={<TeamManagerOverview />} />
              <Route path="projects" element={<TeamManagerProjects />} />
              <Route path="tasks" element={<TeamManagerTasks />} />
              <Route path="conversations" element={<TeamManagerConversations />} />
              <Route path="members" element={<TeamManagerMembers />} />
              <Route path="hosts" element={<TeamManagerHosts />} />
              <Route path="images" element={<TeamManagerImages />} />
              <Route path="models" element={<TeamManagerModels />} />
              <Route path="logs" element={<TeamManagerLogs />} />
              <Route path="manager" element={<TeamManagerManager />} />
              <Route path="oidc" element={<TeamManagerOIDC />} />
              <Route
                path="license"
                element={
                  IS_OFFLINE_EDITION ? (
                    <TeamManagerLicense />
                  ) : (
                    <Navigate to="/manager/overview" replace />
                  )
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-center" />
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default App
