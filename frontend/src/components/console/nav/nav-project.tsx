import { Link, useLocation, useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"

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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useCommonData } from "../data-provider"
import { IconChevronDown, IconChevronRight, IconCircleMinus, IconDotsVertical, IconLoader, IconPlus, IconReload, IconTrash } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import AddProjectDialog from "../project/add-project"
import StartDevelopTaskDialog from "../project/start-develop-task-dialog"
import { isProjectRepoUnbound } from "@/utils/project"
import { Label } from "@/components/ui/label"
import { type DomainProjectTask } from "@/api/Api"
import { stripMarkdown } from "@/utils/common"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"

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
  const navigate = useNavigate()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [startTaskProject, setStartTaskProject] = useState<{ id: string; name?: string } | null>(null)
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(loadExpandedFromStorage)
  const [taskToDelete, setTaskToDelete] = useState<DomainProjectTask | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { projects, loadingProjects, reloadProjects, unlinkedTasks, loadingUnlinkedTasks, reloadUnlinkedTasks } = useCommonData()

  const handleConfirmDeleteTask = () => {
    if (!taskToDelete?.id) {
      setTaskToDelete(null)
      return
    }
    const taskId = taskToDelete.id
    const isOnDeletedPage = location.pathname === `/console/task/${taskId}`
    setDeleting(true)
    apiRequest(
      "v1UsersTasksDelete",
      {},
      [taskId],
      (resp) => {
        setDeleting(false)
        setTaskToDelete(null)
        if (resp.code === 0) {
          toast.success("任务已删除")
          reloadProjects()
          reloadUnlinkedTasks()
          if (isOnDeletedPage) {
            navigate("/console/tasks")
          }
        } else {
          toast.error(resp.message || "删除失败")
        }
      },
      () => {
        setDeleting(false)
        setTaskToDelete(null)
      }
    )
  }

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

  // 选中项目或默认时自动展开二级菜单并持久化
  useEffect(() => {
    if (location.pathname === "/console/tasks") {
      setExpandedProjects((prev) => {
        if (prev[UNLINKED_KEY]) return prev
        const next = { ...prev, [UNLINKED_KEY]: true }
        saveExpandedToStorage(next)
        return next
      })
      return
    }
    const match = location.pathname.match(/^\/console\/project\/([^/]+)/)
    if (match) {
      const projectId = match[1]
      if (projectId && projectId !== UNLINKED_KEY) {
        setExpandedProjects((prev) => {
          if (prev[projectId]) return prev
          const next = { ...prev, [projectId]: true }
          saveExpandedToStorage(next)
          return next
        })
      }
    }
  }, [location.pathname])

  const handleProjectOpenChange = (projectId: string, open: boolean) => {
    setExpandedProjects((prev) => {
      const next = { ...prev, [projectId]: open }
      saveExpandedToStorage(next)
      return next
    })
  }

  useEffect(() => {
    const timer = setInterval(() => {
      reloadProjects()
      reloadUnlinkedTasks()
    }, 30000)
    return () => clearInterval(timer)
  }, [reloadProjects, reloadUnlinkedTasks])

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
              reloadUnlinkedTasks()
            }}
            disabled={loadingProjects || loadingUnlinkedTasks}
          >
            <IconReload className={`size-3.5 ${(loadingProjects || loadingUnlinkedTasks) ? 'animate-spin' : ''}`} />
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
                reloadUnlinkedTasks()
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
                  "group/default-row flex w-full items-center gap-1 overflow-hidden rounded-md p-1 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0",
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 shrink-0 text-muted-foreground/50 group-hover/default-row:text-sidebar-accent-foreground hover:text-primary"
                      asChild
                    >
                      <Link to="/console/tasks">
                        <IconPlus className="size-3.5" />
                      </Link>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">创建任务</TooltipContent>
                </Tooltip>
              </div>
              <CollapsibleContent>
                {unlinkedTasks.length > 0 && (
                  <SidebarMenuSub className="ml-1 mr-0 border-none">
                    <SidebarMenuSubItem className="flex flex-col gap-0.5">
                      {unlinkedTasks.map((task: DomainProjectTask, index) => {
                        const TaskIcon =
                          task.status === "finished" || task.status === "error"
                            ? IconCircleMinus
                            : IconLoader
                        return (
                          <SidebarMenuSubButton
                            key={`unlinked-${task.id ?? index}-${index}`}
                            size="sm"
                            isActive={location.pathname === `/console/task/${task.id}`}
                            asChild
                            className={cn(
                              (task.status === "finished" || task.status === "error") && "!text-muted-foreground [&>svg]:!text-muted-foreground",
                              "group/task-row"
                            )}
                          >
                            <div className="flex w-full min-w-0 items-center gap-1">
                              <Link
                                to={`/console/task/${task.id}`}
                                className="min-w-0 flex-1 flex items-center gap-2 truncate"
                              >
                                <TaskIcon
                                  className={cn(
                                    "size-3.5 shrink-0",
                                    (task.status === "pending" || task.status === "processing") && "animate-spin"
                                  )}
                                />
                                <span className="truncate">{task.summary || stripMarkdown(task.content || "")}</span>
                              </Link>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-5 shrink-0 opacity-0 group-hover/task-row:opacity-100 hover:opacity-100 text-muted-foreground/50 group-hover/task-row:text-sidebar-accent-foreground hover:text-primary"
                                    onClick={(e) => e.preventDefault()}
                                  >
                                    <IconDotsVertical className="size-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="py-1">
                                  <DropdownMenuItem
                                    onClick={() => setTaskToDelete(task)}
                                    className="text-destructive focus:text-destructive text-xs py-1 px-1.5 [&_svg]:size-3"
                                  >
                                    <IconTrash className="mr-1" />
                                    删除
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
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
                    <SidebarMenuSubItem className="flex flex-col gap-0.5">
                      {(project.tasks || []).map((task: DomainProjectTask, index) => {
                        const TaskIcon =
                          task.status === "finished" || task.status === "error"
                            ? IconCircleMinus
                            : IconLoader
                        return (
                          <SidebarMenuSubButton
                            key={`${projectId}-${task.id ?? index}-${index}`}
                            size="sm"
                            isActive={location.pathname === `/console/task/${task.id}`}
                            asChild
                            className={cn(
                              (task.status === "finished" || task.status === "error") && "!text-muted-foreground [&>svg]:!text-muted-foreground",
                              "group/task-row"
                            )}
                          >
                            <div className="flex w-full min-w-0 items-center gap-1">
                              <Link
                                to={`/console/task/${task.id}`}
                                className="min-w-0 flex-1 flex items-center gap-2 truncate"
                              >
                                <TaskIcon
                                  className={cn(
                                    "size-3.5 shrink-0",
                                    (task.status === "pending" || task.status === "processing") && "animate-spin"
                                  )}
                                />
                                <span className="truncate">{task.summary || stripMarkdown(task.content || "")}</span>
                              </Link>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-5 shrink-0 opacity-0 group-hover/task-row:opacity-100 hover:opacity-100 text-muted-foreground/50 group-hover/task-row:text-sidebar-accent-foreground hover:text-primary"
                                    onClick={(e) => e.preventDefault()}
                                  >
                                    <IconDotsVertical className="size-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="py-1">
                                  <DropdownMenuItem
                                    onClick={() => setTaskToDelete(task)}
                                    className="text-destructive focus:text-destructive text-xs py-1 px-1.5 [&_svg]:size-3"
                                  >
                                    <IconTrash className="mr-1" />
                                    删除
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
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
      <AlertDialog open={!!taskToDelete} onOpenChange={(open) => !open && setTaskToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除任务</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除任务「{taskToDelete ? (taskToDelete.summary || stripMarkdown(taskToDelete.content || "")) : ""}」吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmDeleteTask()
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "删除中..." : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarGroup>
  )
}
