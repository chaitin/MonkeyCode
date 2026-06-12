import { Link, useLocation } from "react-router-dom"

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { IconReport, IconUsersGroup } from "@tabler/icons-react"
import { FolderGit2, KeyRound, LayoutDashboard, ListTodo, MessagesSquare, Settings, Sparkles } from "lucide-react"
import { IS_OFFLINE_EDITION } from "@/utils/edition"

export default function NavTeams() {
  const location = useLocation()

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
              <span>仪表盘</span>
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
              <span>项目</span>
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
              <span>任务</span>
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
              <span>对话</span>
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
              <span>成员与权限</span>
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
              <span>Skills</span>
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
              <span>设置</span>
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
                <span>License</span>
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
              <span>操作记录</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
