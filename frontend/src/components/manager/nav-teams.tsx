import { Link, useLocation } from "react-router-dom"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { IconChartBar, IconReport, IconSettings2, IconUsersGroup } from "@tabler/icons-react"
import { Bot, Box, MonitorCloud, User } from "lucide-react"

export default function NavTeams() {
  const location = useLocation()

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>企业管理</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/dashboard"}
            asChild
          >
            <Link to="/manager/dashboard">
              <IconChartBar />
              <span>仪表盘</span>
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
            isActive={location.pathname === "/manager/logs"}
            asChild
          >
            <Link to="/manager/logs">
              <IconReport />
              <span>操作记录</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/manager/other-settings"}
            asChild
          >
            <Link to="/manager/other-settings">
              <IconSettings2 />
              <span>其他配置</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
