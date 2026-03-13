import { Fragment } from "react"
import { Outlet, useLocation } from "react-router-dom"
import UserSidebar from "@/components/console/nav/user-sidebar"
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
import { HelpCircle, Users } from "lucide-react"
import NavBalance from "@/components/console/nav/nav-balance"
import { DataProvider } from "@/components/console/data-provider"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"

export default function UserConsolePage() {
  const location = useLocation()

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
    "/console/settings": [
      { label: "配置", href: "/console/settings" },
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
  
  const breadcrumbSegments =
    breadcrumbSegmentsMap[normalizedPath] ?? [{ label: "用户控制台" }]

  return (

    <DataProvider>
      <SidebarProvider>
        <UserSidebar />
        <SidebarInset className="h-[calc(100vh-var(--spacing)*4)]">
          <header className="flex h-15 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-[orientation=vertical]:h-4"
              />
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem className="hidden lg:block">
                    <BreadcrumbLink href="/console">MonkeyCode AI</BreadcrumbLink>
                  </BreadcrumbItem>
                  {breadcrumbSegments.map((segment, index) => {
                    const isLast = index === breadcrumbSegments.length - 1
                    return (
                      <Fragment key={`${segment.label}-${index}`}>
                        {index === 0 && (
                          <BreadcrumbSeparator className="hidden lg:block" />
                        )}
                        {index > 0 && <BreadcrumbSeparator />}
                        <BreadcrumbItem>
                          {isLast ? (
                            <BreadcrumbPage>{segment.label}</BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink href={segment.href ?? "#"}>
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
            <div className="ml-auto flex items-center gap-2 px-4">
              <HoverCard openDelay={100} closeDelay={200}>
                <HoverCardTrigger asChild>
                  <Button className="hidden lg:flex" variant="ghost" size="sm">
                    <Users className="h-[1.2rem] w-[1.2rem]" />
                    微信交流群
                  </Button>
                </HoverCardTrigger>
                <HoverCardContent className="w-auto p-4" align="center">
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-sm font-medium">扫码加入微信技术交流群</p>
                    <img
                      src="/wechat.png"
                      alt="微信二维码"
                      className="w-40 h-40 rounded-md"
                    />
                  </div>
                </HoverCardContent>
              </HoverCard>
              <NavBalance variant="header" />
              <Button className="hidden lg:flex" variant="ghost" size="sm" asChild>
                <a href="https://monkeycode.docs.baizhi.cloud/" target="_blank">
                  <HelpCircle className="h-[1.2rem] w-[1.2rem]" />
                  帮助文档
                </a>
              </Button>
              {/*<ModeToggle />*/}
            </div>
          </header>
          <div className="flex h-full w-full flex-col gap-4 pb-4 overflow-y-hidden">
            <div className="h-full w-full px-4 overflow-y-auto">
              <Outlet/>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </DataProvider>
  )
}
