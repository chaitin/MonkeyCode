import { BreadcrumbTaskProvider, useBreadcrumbTask } from "@/components/console/breadcrumb-task-context"
import { createContext, Fragment, useContext, useState } from "react"
import { Outlet, useLocation } from "react-router-dom"
import UserSidebar from "@/components/console/nav/user-sidebar"
import { SettingsDialog } from "@/components/console/settings/settings-dialog"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { HelpCircle, RefreshCw, Users } from "lucide-react"
import NavBalance from "@/components/console/nav/nav-balance"
import { DataProvider } from "@/components/console/data-provider"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"

const SettingsDialogContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null)
export const useSettingsDialog = () => {
  const ctx = useContext(SettingsDialogContext)
  if (!ctx) throw new Error("useSettingsDialog must be used within SettingsDialogContext.Provider")
  return ctx
}

function UserConsoleContent() {
  const location = useLocation()
  const { taskName } = useBreadcrumbTask() ?? { taskName: null }

  const breadcrumbSegmentsMap: Record<
    string,
    { label: string; href?: string }[]
  > = {
    "/console/dashboard": [
      { label: "仪表盘", href: "/console/dashboard" },
    ],
    "/console/tasks": [
      { label: "新任务", href: "/console/tasks" },
    ],
    "/console/projects": [
      { label: "项目管理", href: "/console/projects" },
    ],
    "/console/vms": [
      { label: "开发环境", href: "/console/vms" },
    ],
    "/console/gitbot": [
      { label: "Git 机器人", href: "/console/gitbot" },
    ],
    "/console/ide": [
      { label: "IDE 辅助工具", href: "/console/ide" },
    ],
  }

  const normalizedPath =
    location.pathname !== "/" ? location.pathname.replace(/\/$/, "") : location.pathname

  // 动态路由的 breadcrumb：/console/task/:taskId（排除 develop）
  const taskDetailMatch = normalizedPath.match(/^\/console\/task\/(?!develop\/)(.+)$/)
  const breadcrumbSegments =
    breadcrumbSegmentsMap[normalizedPath] ??
    (taskDetailMatch
      ? [{ label: "任务", href: "/console/tasks" }, { label: taskName ?? "未知任务名称" }]
      : [{ label: "用户控制台" }])

  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <DataProvider>
      <SettingsDialogContext.Provider value={{ open: settingsOpen, setOpen: setSettingsOpen }}>
        <SidebarProvider>
          <UserSidebar />
        <SidebarInset className="h-[calc(100vh-var(--spacing)*4)] min-w-0 overflow-hidden">
          <header className="flex h-15 shrink-0 items-center gap-2 overflow-hidden">
            <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1 shrink-0" />
              <Separator
                orientation="vertical"
                className="mr-2 shrink-0 data-[orientation=vertical]:h-4"
              />
              <Breadcrumb className="flex min-w-0 flex-1 overflow-hidden">
                <BreadcrumbList className="min-w-0 flex-1 flex-nowrap break-normal">
                  <BreadcrumbItem className="hidden shrink-0 lg:block">
                    <BreadcrumbLink
                      href="/console"
                      className="whitespace-nowrap"
                    >
                      MonkeyCode AI
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  {breadcrumbSegments.map((segment, index) => {
                    const isLast = index === breadcrumbSegments.length - 1
                    return (
                      <Fragment key={`${segment.label}-${index}`}>
                        {index === 0 && (
                          <BreadcrumbSeparator className="hidden shrink-0 lg:block" />
                        )}
                        {index > 0 && <BreadcrumbSeparator className="shrink-0" />}
                        <BreadcrumbItem
                          className={isLast ? "min-w-0 shrink overflow-hidden" : "shrink-0"}
                        >
                          {isLast ? (
                            <BreadcrumbPage
                              className="block truncate"
                              title={segment.label}
                            >
                              {segment.label}
                            </BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink
                              href={segment.href ?? "#"}
                              className="whitespace-nowrap"
                            >
                              {segment.label}
                            </BreadcrumbLink>
                          )}
                        </BreadcrumbItem>
                      </Fragment>
                    )
                  })}
                </BreadcrumbList>
              </Breadcrumb>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2 px-4">
              <HoverCard openDelay={100} closeDelay={200}>
                <HoverCardTrigger asChild>
                  <Button className="hidden lg:flex" variant="ghost" size="sm">
                    <Users className="h-[1.2rem] w-[1.2rem]" />
                    技术交流群
                  </Button>
                </HoverCardTrigger>
                <HoverCardContent className="w-auto p-4" align="center">
                  <div className="flex flex-col items-center gap-4">
                    <p className="text-sm font-medium">扫码加入技术交流群</p>
                    <div className="flex flex-wrap justify-center gap-6">
                      <div className="flex flex-col items-center gap-2">
                        <img
                          src="/wechat.png"
                          alt="微信二维码"
                          className="w-32 h-32 rounded-md"
                        />
                        <span className="text-xs text-muted-foreground">微信群</span>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <img
                          src="/feishu.png"
                          alt="飞书群二维码"
                          className="w-32 h-32 rounded-md"
                        />
                        <span className="text-xs text-muted-foreground">飞书群</span>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <img
                          src="/dingtalk.png"
                          alt="钉钉群二维码"
                          className="w-32 h-32 rounded-md"
                        />
                        <span className="text-xs text-muted-foreground">钉钉群</span>
                      </div>
                    </div>
                  </div>
                </HoverCardContent>
              </HoverCard>
              <NavBalance variant="header" />
              <Button className="hidden lg:flex" variant="ghost" size="sm" asChild>
                <a href="https://monkeycode.docs.baizhi.cloud/" target="_blank">
                  <HelpCircle className="h-[1.2rem] w-[1.2rem]" />
                  帮助
                </a>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.location.reload()}
                title="刷新页面"
              >
                <RefreshCw className="h-[1.2rem] w-[1.2rem]" />
                刷新
              </Button>
              {/*<ModeToggle />*/}
            </div>
          </header>
          <div className="flex h-full w-full flex-col gap-4 pb-4 overflow-y-hidden">
            <div className="h-full w-full min-w-0 px-4 overflow-x-hidden overflow-y-auto">
              <Outlet/>
            </div>
          </div>
        </SidebarInset>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </SidebarProvider>
      </SettingsDialogContext.Provider>
    </DataProvider>
  )
}

export default function UserConsolePage() {
  return (
    <BreadcrumbTaskProvider>
      <UserConsoleContent />
    </BreadcrumbTaskProvider>
  )
}
