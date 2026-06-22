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
import { Settings } from "lucide-react"
import { IS_ONLINE_EDITION } from "@/utils/edition"
import { useTranslation } from "react-i18next"

export default function UserSidebar({ 
  ...props 
}: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation()
  const { open: settingsOpen, setOpen: setSettingsOpen } = useSettingsDialog()

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
            <NavInvite />
            <NavEssay />
          </>
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
