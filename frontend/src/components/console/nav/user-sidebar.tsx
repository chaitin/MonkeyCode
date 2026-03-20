import * as React from "react"
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
                  <span className="truncate font-medium">MonkeyCode AI</span>
                  <span className="truncate text-xs">智能开发平台</span>
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
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton 
            tooltip="配置"
            isActive={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings />
            <span>配置</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
