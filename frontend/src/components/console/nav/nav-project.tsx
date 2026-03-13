import { Link, useLocation } from "react-router-dom"
import { useState } from "react"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { useCommonData } from "../data-provider"
import { IconBook, IconCalendarCode, IconFolderCode, IconPlus, IconReload, IconSubtask } from "@tabler/icons-react"
import { FolderOpenDot } from "lucide-react"
import { Button } from "@/components/ui/button"
import AddProjectDialog from "../project/add-project"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

export default function NavProject() {
  const location = useLocation()
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  const { projects, loadingProjects, reloadProjects } = useCommonData()

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="flex items-center justify-between pr-0">
        <Label>开发项目</Label>
        <div className="flex items-center gap-0.5">
          <Button 
            variant="ghost" 
            size="icon" 
            className="size-5" 
            onClick={reloadProjects}
            disabled={loadingProjects}
          >
            <IconReload className={`size-3.5 ${loadingProjects ? 'animate-spin' : ''}`} />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            className="size-5"
            onClick={() => setAddDialogOpen(true)}
          >
            <IconPlus className="size-3.5" />
          </Button>
        </div>
      </SidebarGroupLabel>
      <AddProjectDialog 
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSuccess={reloadProjects}
      />
      <SidebarMenu>
        {projects.length > 0 ? projects.map((project) => (
          <SidebarMenuItem key={project.id}>
            <SidebarMenuButton asChild>
              <Link to={`/console/project/${project.id}`}>
              {(location.pathname === `/console/project/${project.id}` || location.pathname.startsWith(`/console/project/${project.id}/`)) ? <FolderOpenDot /> : <IconFolderCode />} 
                <span>{project.name}</span>
              </Link>
            </SidebarMenuButton>
            {(location.pathname === `/console/project/${project.id}` || location.pathname.startsWith(`/console/project/${project.id}/`)) && <SidebarMenuSub>
              <SidebarMenuSubItem className="flex flex-col gap-1">
                <SidebarMenuSubButton isActive={location.pathname.startsWith(`/console/project/${project.id}/info/`)} asChild>
                  <Link to={`/console/project/${project.id}/info/`}>
                    <IconBook />
                    项目
                  </Link>
                </SidebarMenuSubButton>
                <SidebarMenuSubButton isActive={location.pathname === `/console/project/${project.id}/issues`} asChild>
                  <Link to={`/console/project/${project.id}/issues`}>
                    <IconCalendarCode />
                    需求
                    <Badge variant="outline">{project.open_issue_count || 0}</Badge>
                  </Link>
                </SidebarMenuSubButton>
                <SidebarMenuSubButton isActive={location.pathname === `/console/project/${project.id}/tasks`} asChild>
                  <Link to={`/console/project/${project.id}/tasks`}>
                    <IconSubtask />
                    任务
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            </SidebarMenuSub>}
          </SidebarMenuItem>
        )) : (
          <SidebarMenuItem>
            <SidebarMenuButton disabled>
              暂无项目
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}
