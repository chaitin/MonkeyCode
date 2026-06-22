import * as React from "react"
import { useTranslation } from "react-i18next"

import NavManager from "@/components/manager/nav-manager"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import NavTeams from "./nav-teams"

export default function ManagerSidebar({ 
  ...props 
}: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation()

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/">
                <img src="/logo-light.png" alt="MonkeyCode AI" className="size-8" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">MonkeyCode</span>
                  <span className="truncate text-xs">{t("managerShell.brand.subtitle")}</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavTeams />
      </SidebarContent>
      <SidebarFooter>
        <NavManager />
      </SidebarFooter>
    </Sidebar>
  )
}
