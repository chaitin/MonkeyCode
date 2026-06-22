import { Link, useLocation } from "react-router-dom"

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { IconReport, IconUsersGroup } from "@tabler/icons-react"
import { Blocks, FolderGit2, KeyRound, LayoutDashboard, ListTodo, MessagesSquare, Settings, Sparkles } from "lucide-react"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { useTranslation } from "react-i18next"

export default function NavTeams() {
  const location = useLocation()
  const { t } = useTranslation()

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/overview"}
            asChild
          >
            <Link to="/manager/overview">
              <LayoutDashboard />
              <span>{t("managerShell.nav.overview")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/projects"}
            asChild
          >
            <Link to="/manager/projects">
              <FolderGit2 />
              <span>{t("managerShell.nav.projects")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/tasks"}
            asChild
          >
            <Link to="/manager/tasks">
              <ListTodo />
              <span>{t("managerShell.nav.tasks")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/conversations"}
            asChild
          >
            <Link to="/manager/conversations">
              <MessagesSquare />
              <span>{t("managerShell.nav.conversations")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/members"}
            asChild
          >
            <Link to="/manager/members">
              <IconUsersGroup />
              <span>{t("managerShell.nav.members")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/skills"}
            asChild
          >
            <Link to="/manager/skills">
              <Sparkles />
              <span>{t("managerShell.nav.skills")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/mcp"}
            asChild
          >
            <Link to="/manager/mcp">
              <Blocks />
              <span>{t("managerShell.nav.mcp")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/settings"}
            asChild
          >
            <Link to="/manager/settings">
              <Settings />
              <span>{t("managerShell.nav.settings")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {IS_OFFLINE_EDITION ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={location.pathname === "/manager/license"}
              asChild
            >
              <Link to="/manager/license">
                <KeyRound />
                <span>{t("managerShell.nav.license")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/logs"}
            asChild
          >
            <Link to="/manager/logs">
              <IconReport />
              <span>{t("managerShell.nav.logs")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
