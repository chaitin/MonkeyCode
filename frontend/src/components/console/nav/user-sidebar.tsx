import * as React from "react"
import NavBalance from "./nav-balance"
import NavProject from "./nav-project"
import NavUser from "./nav-user"
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
    <Sidebar variant="inset" {...props}>
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
        <NavBalance hideTrigger />
        <div className="flex items-center gap-2">
          <NavUser className="min-w-0 flex-1" />
          <SidebarMenu className="w-auto shrink-0">
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="配置"
                isActive={settingsOpen}
                onClick={() => setSettingsOpen(true)}
                className="size-8 justify-center p-0"
              >
                <Settings className="size-4" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
