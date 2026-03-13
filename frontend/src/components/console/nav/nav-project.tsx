import { Link, useLocation } from "react-router-dom"
import { useState, useEffect, useCallback } from "react"

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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useCommonData } from "../data-provider"
import { IconChevronDown, IconChevronRight, IconCircleMinus, IconLoader, IconPlus, IconReload } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import AddProjectDialog from "../project/add-project"
import StartDevelopTaskDialog from "../project/start-develop-task-dialog"
import { isProjectRepoUnbound } from "@/utils/project"
import { Label } from "@/components/ui/label"
import { type DomainProjectTask } from "@/api/Api"
import { stripMarkdown } from "@/utils/common"
import { cn } from "@/lib/utils"
import { apiRequest } from "@/utils/requestUtils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const UNLINKED_TASKS_LIMIT = 5
const UNLINKED_TASKS_FETCH_SIZE = 50
const STORAGE_KEY = "nav-project-expanded"
const UNLINKED_KEY = "__unlinked__"

const loadExpandedFromStorage = (): Record<string, boolean> => {
  try {
    const cached = localStorage.getItem(STORAGE_KEY)
    if (cached) return JSON.parse(cached)
  } catch {}
  return {}
}

const saveExpandedToStorage = (state: Record<string, boolean>) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

export default function NavProject() {
  const location = useLocation()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [startTaskProject, setStartTaskProject] = useState<{ id: string; name?: string } | null>(null)
  const [unlinkedTasks, setUnlinkedTasks] = useState<DomainProjectTask[]>([])
  const [loadingUnlinkedTasks, setLoadingUnlinkedTasks] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(loadExpandedFromStorage)

  const { projects, loadingProjects, reloadProjects } = useCommonData()

  useEffect(() => {
    const stored = loadExpandedFromStorage()
    const next: Record<string, boolean> = {}
    const toSave: Record<string, boolean> = { ...stored }
    let changed = false

    for (const project of projects) {
      const projectId = project.id ?? ""
      const hasActiveTasks = (project.tasks || []).some(
        (t) => t.status === "pending" || t.status === "processing"
      )
      if (hasActiveTasks) {
        next[projectId] = true
      } else if (projectId in stored) {
        next[projectId] = stored[projectId]
      } else {
        next[projectId] = false
      }
      if (!(projectId in stored)) {
        toSave[projectId] = next[projectId]
        changed = true
      }
    }

    setExpandedProjects((prev) => {
      const merged = { ...prev, ...next }
      return merged
    })
    if (changed) saveExpandedToStorage(toSave)
  }, [projects])

  useEffect(() => {
    if (loadingUnlinkedTasks) return
    const stored = loadExpandedFromStorage()
    const hasActiveUnlinked = unlinkedTasks.some(
      (t) => t.status === "pending" || t.status === "processing"
    )
    const nextUnlinked = hasActiveUnlinked
      ? true
      : UNLINKED_KEY in stored
        ? stored[UNLINKED_KEY]
        : false
    const changed = !(UNLINKED_KEY in stored)
    setExpandedProjects((prev) => ({ ...prev, [UNLINKED_KEY]: nextUnlinked }))
    if (changed && unlinkedTasks.length > 0) {
      saveExpandedToStorage({ ...stored, [UNLINKED_KEY]: nextUnlinked })
    }
  }, [unlinkedTasks, loadingUnlinkedTasks])

  const handleProjectOpenChange = (projectId: string, open: boolean) => {
    setExpandedProjects((prev) => {
      const next = { ...prev, [projectId]: open }
      saveExpandedToStorage(next)
      return next
    })
  }

  const fetchUnlinkedTasks = useCallback(() => {
    setLoadingUnlinkedTasks(true)
    apiRequest("v1UsersTasksList", { page: 1, size: UNLINKED_TASKS_FETCH_SIZE, quick_start: true }, [], (resp) => {
      if (resp.code === 0) {
        const allTasks = resp.data?.tasks || []
        const unlinked = allTasks
          .sort((a: DomainProjectTask, b: DomainProjectTask) => (b.created_at || 0) - (a.created_at || 0))
          .slice(0, UNLINKED_TASKS_LIMIT)
        setUnlinkedTasks(unlinked)
      }
      setLoadingUnlinkedTasks(false)
    }, () => setLoadingUnlinkedTasks(false))
  }, [])

  useEffect(() => {
    fetchUnlinkedTasks()
  }, [fetchUnlinkedTasks])

  useEffect(() => {
    const timer = setInterval(() => {
      reloadProjects()
      fetchUnlinkedTasks()
    }, 30000)
    return () => clearInterval(timer)
  }, [reloadProjects, fetchUnlinkedTasks])

  const isUnlinkedActive = location.pathname === "/console/tasks"

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="flex items-center justify-between pr-0">
        <Label>开发项目</Label>
        <div className="flex items-center gap-0.5">
          <Button 
            variant="ghost" 
            size="icon" 
            className="size-5" 
            onClick={() => {
              reloadProjects()
              fetchUnlinkedTasks()
            }}
            disabled={loadingProjects}
          >
            <IconReload className={`size-3.5 ${loadingProjects ? 'animate-spin' : ''}`} />
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="size-5"
                onClick={() => setAddDialogOpen(true)}
              >
                <IconPlus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">创建项目</TooltipContent>
          </Tooltip>
        </div>
      </SidebarGroupLabel>
      <AddProjectDialog 
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSuccess={reloadProjects}
      />
      {startTaskProject && (
        <StartDevelopTaskDialog
          open={!!startTaskProject}
          onOpenChange={(open) => {
            if (!open) {
              setStartTaskProject(null)
              reloadProjects()
            }
          }}
          project={projects.find((p) => p.id === startTaskProject.id)}
        />
      )}
      <SidebarMenu>
        <Collapsible
            open={expandedProjects[UNLINKED_KEY] ?? false}
            onOpenChange={(open) => handleProjectOpenChange(UNLINKED_KEY, open)}
          >
            <SidebarMenuItem>
              <div
                className={cn(
                  "flex w-full items-center gap-1 overflow-hidden rounded-md p-1 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0",
                  isUnlinkedActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                )}
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 hover:text-primary"
                  >
                    {(expandedProjects[UNLINKED_KEY] ?? false) ? (
                      <IconChevronDown className="size-4" />
                    ) : (
                      <IconChevronRight className="size-4" />
                    )}
                  </button>
                </CollapsibleTrigger>
                <Link
                  to="/console/tasks"
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    isUnlinkedActive && "font-medium"
                  )}
                >
                  默认
                </Link>
              </div>
              <CollapsibleContent>
                {unlinkedTasks.length > 0 && (
                  <SidebarMenuSub className="ml-1 mr-0 border-none">
                    <SidebarMenuSubItem className="flex flex-col">
                      {unlinkedTasks.map((task: DomainProjectTask) => {
                        const TaskIcon =
                          task.status === "finished" || task.status === "error"
                            ? IconCircleMinus
                            : IconLoader
                        return (
                          <SidebarMenuSubButton
                            key={task.id}
                            size="sm"
                            isActive={location.pathname === `/console/task/develop/${task.id}`}
                            asChild
                            className={cn(
                              (task.status === "finished" || task.status === "error") && "!text-muted-foreground [&>svg]:!text-muted-foreground"
                            )}
                          >
                            <a
                              href={`/console/task/develop/${task.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <TaskIcon
                                className={cn(
                                  "size-3.5 shrink-0",
                                  (task.status === "pending" || task.status === "processing") && "animate-spin"
                                )}
                              />
                              <span className="truncate">{task.summary || stripMarkdown(task.content || "")}</span>
                            </a>
                          </SidebarMenuSubButton>
                        )
                      })}
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                )}
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        {projects.length > 0 ? projects.map((project) => {
          const projectId = project.id ?? ""
          const isExpanded = expandedProjects[projectId] ?? false
          const isProjectActive = location.pathname === `/console/project/${projectId}` || location.pathname.startsWith(`/console/project/${projectId}/`)
          return (
            <Collapsible
              key={projectId}
              open={isExpanded}
              onOpenChange={(open) => handleProjectOpenChange(projectId, open)}
            >
              <SidebarMenuItem>
                <div
                  className={cn(
                    "group/project-row flex w-full items-center gap-1 overflow-hidden rounded-md p-1 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0",
                    isProjectActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  )}
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 hover:text-primary"
                    >
                      {isExpanded ? <IconChevronDown className="size-4" /> : <IconChevronRight className="size-4" />}
                    </button>
                  </CollapsibleTrigger>
                  <Link
                    to={`/console/project/${projectId}`}
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      isProjectActive && "font-medium"
                    )}
                  >
                    {project.name}
                  </Link>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-5 shrink-0 text-muted-foreground/50 group-hover/project-row:text-sidebar-accent-foreground hover:text-primary"
                        disabled={isProjectRepoUnbound(project)}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setStartTaskProject({ id: projectId, name: project.name })
                        }}
                      >
                        <IconPlus className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">启动任务</TooltipContent>
                  </Tooltip>
                </div>
                <CollapsibleContent>
                  <SidebarMenuSub className="ml-1 mr-0 border-none">
                    <SidebarMenuSubItem className="flex flex-col">
                      {(project.tasks || []).map((task: DomainProjectTask) => {
                        const TaskIcon =
                          task.status === "finished" || task.status === "error"
                            ? IconCircleMinus
                            : IconLoader
                        return (
                          <SidebarMenuSubButton
                            key={task.id}
                            size="sm"
                            isActive={location.pathname === `/console/task/develop/${task.id}`}
                            asChild
                            className={cn(
                              (task.status === "finished" || task.status === "error") && "!text-muted-foreground [&>svg]:!text-muted-foreground"
                            )}
                          >
                            <a
                              href={`/console/task/develop/${task.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <TaskIcon
                                className={cn(
                                  "size-3.5 shrink-0",
                                  (task.status === "pending" || task.status === "processing") && "animate-spin"
                                )}
                              />
                              <span className="truncate">{task.summary || stripMarkdown(task.content || "")}</span>
                            </a>
                          </SidebarMenuSubButton>
                        )
                      })}
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          )
        }) : (
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
