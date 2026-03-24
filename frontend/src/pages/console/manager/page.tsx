import { Outlet, useLocation } from "react-router-dom"
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
import { HelpCircle, RefreshCw } from "lucide-react"
import ManagerSidebar from "@/components/manager/manager-sidebar"
import { Fragment } from "react/jsx-runtime"

export default function ManagerConsolePage() {
  const location = useLocation()

  const breadcrumbSegmentsMap: Record<
    string,
    { label: string; href?: string }[]
  > = {
    "/manager/dashboard": [
      { label: "仪表盘", href: "/manager/dashboard" },
    ],
    "/manager/members": [
      { label: "成员管理", href: "/manager/members" },
    ],
    "/manager/hosts": [
      { label: "开发环境", href: "/manager/hosts" },
    ],
    "/manager/models": [
      { label: "AI 大模型", href: "/manager/models" },
    ],
    "/manager/images": [
      { label: "镜像管理", href: "/manager/images" },
    ],
    "/manager/logs": [
      { label: "操作记录", href: "/manager/logs" },
    ],
    "/manager/other-settings": [
      { label: "其他配置", href: "/manager/other-settings" },
    ],
  }
  

  const normalizedPath =
    location.pathname !== "/" ? location.pathname.replace(/\/$/, "") : location.pathname
  
  const breadcrumbSegments =
    breadcrumbSegmentsMap[normalizedPath] ?? [{ label: "企业管理后台" }]

  return (
    <SidebarProvider>
      <ManagerSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#">
                    MonkeyCode AI
                  </BreadcrumbLink>
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
            <Button variant="ghost" size="sm" asChild>
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
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
