import { Link, useLocation } from "react-router-dom"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { IconReport, IconUsersGroup } from "@tabler/icons-react"
import { Bot, Box, FolderGit2, KeyRound, LayoutDashboard, ListTodo, MessagesSquare, MonitorCloud, ShieldCheck, User } from "lucide-react"
import { IS_OFFLINE_EDITION } from "@/utils/edition"

export default function NavTeams() {
  const location = useLocation()

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>企业管理</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/overview"}
            asChild
          >
            <Link to="/manager/overview">
              <LayoutDashboard />
              <span>概览</span>
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
              <span>成员管理</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/hosts"}
            asChild
          >
            <Link to="/manager/hosts">
              <MonitorCloud />
              <span>开发环境</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/models"}
            asChild
          >
            <Link to="/manager/models">
              <Bot />
              <span>AI 大模型</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/images"}
            asChild
          >
            <Link to="/manager/images">
              <Box />
              <span>系统镜像</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/manager"}
            asChild
          >
            <Link to="/manager/manager">
              <User />
              <span>管理员</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/oidc"}
            asChild
          >
            <Link to="/manager/oidc">
              <ShieldCheck />
              <span>企业登录</span>
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
