import { Route, BrowserRouter, Routes, Navigate } from "react-router-dom"
import { ThemeProvider, ThemePathListener } from "@/components/theme-provider"
import LoginPage from "@/pages/login"
import WelcomePage from "@/pages/welcome"
import UserConsolePage from "@/pages/console/user/page"
import ManagerConsolePage from "@/pages/console/manager/page"
import SettingsPage from "@/pages/console/user/settings"
import TasksPage from "@/pages/console/user/tasks"
import IDEIDE from "@/pages/console/user/ide-ide"
import GitBotsPage from "@/pages/console/user/git-bots"
import TerminalPage from "@/pages/console/user/terminal"
import FileManagerPage from "@/pages/console/user/file-manager"
import { Toaster } from "@/components/ui/sonner"
import SharedTerminalPage from "@/pages/shared-terminal"
import TeamManagerMembers from "./pages/console/manager/members"
import TeamManagerDashboard from "./pages/console/manager/dashboard"
import TeamManagerModels from "@/pages/console/manager/models"
import TeamManagerImages from "@/pages/console/manager/images"
import TeamManagerLogs from "@/pages/console/manager/logs"
import TeamManagerHosts from "./pages/console/manager/hosts"
import ResetPasswordPage from "./pages/resetpassword"
import FindPasswordPage from "./pages/findpassword"
import TeamManagerManager from "./pages/console/manager/manager"
import TeamManagerOtherSettings from "./pages/console/manager/other-settings"
import ProjectPage from "./pages/console/user/project/project"
import PlaygroundPage from "./pages/playground"
import PlaygroundDetailPage from "./pages/playground-detail"
import PublicTaskPage from "./pages/public-task"
import PostCreatePage from "./pages/post-create"
import ProjectIssuesPage from "./pages/console/user/project/issues"
import ProjectTasksPage from "./pages/console/user/project/tasks"
import TaskDevelopPage from "./pages/console/user/task/task-dev"
import TaskDevelopNewPage from "./pages/console/user/task/task-dev-new"
import TaskViewPage from "./pages/console/user/task/task-view"

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="monkeycode-theme">
      <BrowserRouter>
        <ThemePathListener />
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
          <Route path="/playground/create" element={<PostCreatePage />} />
          <Route path="/playground/detail" element={<PlaygroundDetailPage />} />
          <Route path="/tasks/public" element={<PublicTaskPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/findpassword" element={<FindPasswordPage />} />
          <Route path="/resetpassword" element={<ResetPasswordPage />} />
          <Route path="/console" element={<UserConsolePage />}>
            <Route index element={<Navigate to="/console/tasks" replace />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="project/:projectId/info" element={<ProjectPage />} />
            <Route path="project/:projectId/issues" element={<ProjectIssuesPage />} />
            <Route path="project/:projectId/tasks" element={<ProjectTasksPage />} />
            <Route path="gitbot" element={<GitBotsPage />} />
            <Route path="ide" element={<IDEIDE />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="/console/terminal" element={<TerminalPage />} />
          <Route path="/console/files" element={<FileManagerPage />} />
          <Route path="/console/task/view" element={<TaskViewPage />} />
          <Route path="/console/task/develop/:taskId" element={<TaskDevelopPage />} />
          <Route path="/console/task/new/:taskId" element={<TaskDevelopNewPage />} />
          <Route path="/sharedterminal" element={<SharedTerminalPage />} />
          <Route path="/manager" element={<ManagerConsolePage />}>
            <Route index element={<Navigate to="/manager/dashboard" replace />} />
            <Route path="dashboard" element={<TeamManagerDashboard />} />
            <Route path="members" element={<TeamManagerMembers />} />
            <Route path="hosts" element={<TeamManagerHosts />} />
            <Route path="images" element={<TeamManagerImages />} />
            <Route path="models" element={<TeamManagerModels />} />
            <Route path="logs" element={<TeamManagerLogs />} />
            <Route path="manager" element={<TeamManagerManager />} />
            <Route path="other-settings" element={<TeamManagerOtherSettings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" />
    </ThemeProvider>
  )
}

export default App