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
import { RefreshCw } from "lucide-react"
import ManagerSidebar from "@/components/manager/manager-sidebar"
import { Fragment } from "react/jsx-runtime"
import { ModeToggle } from "@/components/mode-toggle"
import { useTranslation } from "react-i18next"

export default function ManagerConsolePage() {
  const location = useLocation()
  const { t } = useTranslation()

  const breadcrumbSegmentsMap: Record<
    string,
    { label: string; href?: string }[]
  > = {
    "/manager/overview": [
      { label: t("managerShell.nav.overview"), href: "/manager/overview" },
    ],
    "/manager/projects": [
      { label: t("managerShell.nav.projects"), href: "/manager/projects" },
    ],
    "/manager/tasks": [
      { label: t("managerShell.nav.tasks"), href: "/manager/tasks" },
    ],
    "/manager/conversations": [
      { label: t("managerShell.nav.conversations"), href: "/manager/conversations" },
    ],
    "/manager/members": [
      { label: t("managerShell.nav.members"), href: "/manager/members" },
    ],
    "/manager/skills": [
      { label: t("managerShell.nav.skills"), href: "/manager/skills" },
    ],
    "/manager/mcp": [
      { label: t("managerShell.nav.mcp"), href: "/manager/mcp" },
    ],
    "/manager/hosts": [
      { label: t("managerShell.nav.settings"), href: "/manager/settings" },
    ],
    "/manager/settings": [
      { label: t("managerShell.nav.settings"), href: "/manager/settings" },
    ],
    "/manager/models": [
      { label: t("managerShell.nav.settings"), href: "/manager/settings" },
    ],
    "/manager/images": [
      { label: t("managerShell.nav.settings"), href: "/manager/settings" },
    ],
    "/manager/oidc": [
      { label: t("managerShell.nav.settings"), href: "/manager/settings" },
    ],
    "/manager/logs": [
      { label: t("managerShell.nav.logs"), href: "/manager/logs" },
    ],
    "/manager/license": [
      { label: t("managerShell.nav.license"), href: "/manager/license" },
    ],
  }

  const normalizedPath =
    location.pathname !== "/" ? location.pathname.replace(/\/$/, "") : location.pathname

  const breadcrumbSegments =
    breadcrumbSegmentsMap[normalizedPath] ?? [{ label: t("managerShell.breadcrumb.fallback") }]

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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.location.reload()}
              title={t("managerShell.actions.refreshPage")}
            >
              <RefreshCw className="h-[1.2rem] w-[1.2rem]" />
              {t("managerShell.actions.refresh")}
            </Button>
            <ModeToggle />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
