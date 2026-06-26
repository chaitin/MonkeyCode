import * as React from "react"
import NavBalance from "./nav-balance"
import NavCheckin from "./nav-checkin"
import NavCommunity from "./nav-community"
import NavEssay from "./nav-essay"
import NavInvite from "./nav-invite"
import NavProject from "./nav-project"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useSettingsDialog } from "@/pages/console/user/settings-dialog-context"
import { ExternalLink, Settings } from "lucide-react"
import { IS_OFFLINE_EDITION, IS_ONLINE_EDITION } from "@/utils/edition"
import { useTranslation } from "react-i18next"
import { useAppRuntime } from "@/components/app-runtime-provider"

const CONSULT_PURCHASE_URL = "https://baizhi.cloud/consult"

export default function UserSidebar({ 
  ...props 
}: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation()
  const { open: settingsOpen, setOpen: setSettingsOpen } = useSettingsDialog()
  const { serverConfig } = useAppRuntime()
  const isCnRegion = serverConfig?.region === "cn"

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader className="md:p-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/">
                <img src="/logo-light.png" alt="MonkeyCode AI" className="size-8" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">MonkeyCode</span>
                  <span className="truncate text-xs text-foreground/60">{t("consoleShell.sidebar.brandSubtitle")}</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="p-2 md:p-0">
        <NavProject />
      </SidebarContent>
      <SidebarFooter className="md:p-0">
        {IS_ONLINE_EDITION && (
          <>
            <NavCheckin />
            {isCnRegion && (
              <>
                <NavInvite />
                <NavEssay />
              </>
            )}
          </>
        )}
        {IS_OFFLINE_EDITION && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t("consoleShell.sidebar.consultPurchase")}
                className="border border-amber-300/70 bg-amber-100 py-1 text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(245,158,11,0.18)] transition-colors hover:border-amber-400 hover:bg-amber-200 hover:text-amber-950 active:border-amber-500 active:bg-[#fcd76a] dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:border-amber-400 dark:hover:bg-amber-500/20 dark:active:border-amber-300 dark:active:bg-amber-500/26"
                asChild
              >
                <a href={CONSULT_PURCHASE_URL} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4 text-amber-700 dark:text-amber-300" />
                  <span className="font-medium">{t("consoleShell.sidebar.consultPurchase")}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        <div className="flex items-stretch gap-2 group-data-[collapsible=icon]:flex-col">
          {IS_ONLINE_EDITION && (
            <NavCommunity
              menuClassName="flex-[2]"
              itemClassName="h-full"
              buttonClassName="h-full py-1"
            />
          )}
          <SidebarMenu className="flex-1">
            <SidebarMenuItem className="h-full">
              <SidebarMenuButton
                tooltip={t("consoleShell.sidebar.settings")}
                isActive={settingsOpen}
                onClick={() => setSettingsOpen(true)}
                className="h-full py-1"
              >
                <Settings className="size-4" />
                <span>{t("consoleShell.sidebar.settings")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
        <NavBalance triggerMode="account" />
      </SidebarFooter>
    </Sidebar>
  )
}
