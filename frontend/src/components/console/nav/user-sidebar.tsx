import * as React from "react"
import NavBalance from "./nav-balance"
import NavCommunity from "./nav-community"
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
import { useSettingsDialog } from "@/pages/console/user/page"
import { Settings } from "lucide-react"

export default function UserSidebar({ 
  ...props 
}: React.ComponentProps<typeof Sidebar>) {
  const { open: settingsOpen, setOpen: setSettingsOpen } = useSettingsDialog()

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/">
                <img src="/logo-colored.png" alt="MonkeyCode AI" className="size-8" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">MonkeyCode</span>
                  <span className="truncate text-xs">长亭百智云</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavProject />
      </SidebarContent>
      <SidebarFooter>
        <NavCommunity />
        <NavBalance triggerMode="account" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="配置"
              isActive={settingsOpen}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="size-4" />
              <span>配置</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
