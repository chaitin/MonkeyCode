import { 
  Bot,
  Github,
} from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export default function NavMain() {
  const location = useLocation()

  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton 
            isActive={location.pathname === "/console/tasks"}
            asChild
          >
            <Link to="/console/tasks">
              <Bot />
              <span>智能任务</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={location.pathname === "/console/gitbot"}
            asChild
          >
            <Link to="/console/gitbot">
              <Github />
              <span>代码审查</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
