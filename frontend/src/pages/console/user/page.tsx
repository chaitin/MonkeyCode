import { BreadcrumbTaskProvider, useBreadcrumbTask } from "@/components/console/breadcrumb-task-context"
import { Fragment, useState } from "react"
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
import CommunityDialog from "@/components/console/nav/community-dialog"
import NavBalance from "@/components/console/nav/nav-balance"
import WalletDialog from "@/components/console/nav/wallet-dialog"
import { RefreshCw } from "lucide-react"
import { DataProvider } from "@/components/console/data-provider"
import FreeModelUsageIndicator from "@/components/console/nav/free-model-usage-indicator"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { ModeToggle } from "@/components/mode-toggle"
import { useTranslation } from "react-i18next"
import { SettingsDialogContext } from "./settings-dialog-context"

function UserConsoleContent() {
  const { t } = useTranslation()
  const location = useLocation()
  const { taskName } = useBreadcrumbTask() ?? { taskName: null }

  const breadcrumbSegmentsMap: Record<
    string,
    { label: string; href?: string }[]
  > = {
    "/console/dashboard": [
      { label: t("consoleShell.breadcrumbs.dashboard"), href: "/console/dashboard" },
    ],
    "/console/tasks": [
      { label: t("consoleShell.breadcrumbs.tasks"), href: "/console/tasks" },
    ],
    "/console/projects": [
      { label: t("consoleShell.breadcrumbs.projects"), href: "/console/projects" },
    ],
    "/console/vms": [
      { label: t("consoleShell.breadcrumbs.vms"), href: "/console/vms" },
    ],
    "/console/gitbot": [
      { label: t("consoleShell.breadcrumbs.gitBot"), href: "/console/gitbot" },
    ],
    "/console/ide": [
      { label: t("consoleShell.breadcrumbs.ide"), href: "/console/ide" },
    ],
  }

  const normalizedPath =
    location.pathname !== "/" ? location.pathname.replace(/\/$/, "") : location.pathname

  const taskDetailMatch = normalizedPath.match(/^\/console\/task\/(?!develop\/)(.+)$/)
  const breadcrumbSegments =
    breadcrumbSegmentsMap[normalizedPath] ??
    (taskDetailMatch
      ? [{ label: t("consoleShell.breadcrumbs.task"), href: "/console/tasks" }, { label: taskName ?? t("consoleShell.breadcrumbs.unknownTask") }]
      : [{ label: t("consoleShell.breadcrumbs.console") }])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [communityOpen, setCommunityOpen] = useState(false)
  const [balanceOpen, setBalanceOpen] = useState(false)

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
                className="mr-2 shrink-0 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
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
              {!IS_OFFLINE_EDITION && <FreeModelUsageIndicator />}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.location.reload()}
                title={t("consoleShell.actions.refreshPage")}
              >
                <RefreshCw className="h-[1.2rem] w-[1.2rem]" />
                {t("consoleShell.actions.refresh")}
              </Button>
              <ModeToggle />
            </div>
          </header>
          <div className="flex h-full w-full flex-col gap-4 pb-4 overflow-y-hidden">
            <div className="h-full w-full min-w-0 px-4 overflow-x-hidden overflow-y-auto">
              <Outlet/>
            </div>
          </div>
        </SidebarInset>
        <CommunityDialog open={communityOpen} onOpenChange={setCommunityOpen} />
        <NavBalance
          hideTrigger
          open={balanceOpen}
          onOpenChange={setBalanceOpen}
          initialSection="account"
        />
        <WalletDialog />
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
