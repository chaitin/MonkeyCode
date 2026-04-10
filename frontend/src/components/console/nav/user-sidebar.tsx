import * as React from "react"
import NavBalance from "./nav-balance"
import NavCheckin from "./nav-checkin"
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
      <SidebarHeader className="p-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/">
                <img src="/logo-colored.png" alt="MonkeyCode AI" className="size-8" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">MonkeyCode</span>
                  <span className="truncate text-xs text-foreground/60">长亭百智云</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavProject />
      </SidebarContent>
      <SidebarFooter className="p-0">
        <NavCheckin />
        <div className="flex items-stretch gap-2 group-data-[collapsible=icon]:flex-col">
          <NavCommunity
            menuClassName="flex-[2]"
            itemClassName="h-full"
            buttonClassName="h-full py-1"
          />
          <SidebarMenu className="flex-1">
            <SidebarMenuItem className="h-full">
              <SidebarMenuButton
                tooltip="配置"
                isActive={settingsOpen}
                onClick={() => setSettingsOpen(true)}
                className="h-full py-1"
              >
                <Settings className="size-4" />
                <span>配置</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
        <NavBalance triggerMode="account" />
      </SidebarFooter>
    </Sidebar>
  )
}
