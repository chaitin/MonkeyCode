import { Link, useLocation, useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
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
import { useCommonData } from "../data-provider"
import { IconChevronDown, IconChevronRight, IconDots, IconFolder, IconFolderOpen, IconFolderPlus, IconLoader, IconPlus, IconPointFilled } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import AddProjectDialog from "../project/add-project"
import StartDevelopTaskDialog from "../project/start-develop-task-dialog"
import CreateDefaultTaskDialog from "../task/create-default-task-dialog"
import { TaskActionsDropdown } from "../task/task-actions-dropdown"
import { isProjectRepoUnbound } from "@/utils/project"
import { type DomainProjectTask } from "@/api/Api"
import { getTaskDisplayName } from "@/utils/common"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { FolderOpen, ListTodo } from "lucide-react"

type SidebarTaskItemProps = {
  task: DomainProjectTask
  isActive: boolean
  onStop: (task: DomainProjectTask) => void
  onDelete: (task: DomainProjectTask) => void
  onRenameSuccess: () => void
}

function SidebarTaskItem({ task, isActive, onStop, onDelete, onRenameSuccess }: SidebarTaskItemProps) {
  const isPending = task.status === "pending"
  const isProcessing = task.status === "processing"
  const isFinished = task.status === "finished" || task.status === "error"
  const canStop = isPending || isProcessing
  const TaskIcon =
    isFinished
      ? IconPointFilled
      : isProcessing
        ? IconPointFilled
        : IconLoader

  return (
    <SidebarMenuSubButton
      size="md"
      isActive={isActive}
      asChild
      className="group/task-row py-4"
    >
      <div className="flex w-full min-w-0 items-center gap-1">
        <Link
          to={`/console/task/${task.id}`}
          className="min-w-0 flex-1 flex items-center gap-2 truncate"
        >
          <TaskIcon
            className={cn(
              "size-3.5 shrink-0",
              isPending && "animate-spin text-primary",
              isProcessing && "text-green-500",
              isFinished && "text-muted-foreground/40"
            )}
          />
          <span className="truncate">{getTaskDisplayName(task)}</span>
        </Link>
        <TaskActionsDropdown
          task={task}
          onStop={onStop}
          onDelete={onDelete}
          onRenameSuccess={onRenameSuccess}
          triggerClassName="opacity-0 group-hover/task-row:opacity-100 hover:opacity-100 text-muted-foreground/50 group-hover/task-row:text-sidebar-accent-foreground hover:text-primary"
        />
      </div>
    </SidebarMenuSubButton>
  )
}

export default function NavProject() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isMobile, setOpen, state } = useSidebar()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [defaultTaskDialogOpen, setDefaultTaskDialogOpen] = useState(false)
  const [startTaskProject, setStartTaskProject] = useState<{ id: string; name?: string } | null>(null)
  const [taskToDelete, setTaskToDelete] = useState<DomainProjectTask | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [taskToStop, setTaskToStop] = useState<DomainProjectTask | null>(null)
  const [stopping, setStopping] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(false)

  const { projects, reloadProjects, unlinkedTasks, reloadUnlinkedTasks, historicalTasks, reloadHistoricalTasks } = useCommonData()

  const renderTaskList = (tasks: DomainProjectTask[], keyPrefix: string) => (
    tasks.map((task: DomainProjectTask, index) => {
      return (
        <SidebarTaskItem
          key={`${keyPrefix}-${task.id ?? index}-${index}`}
          task={task}
          isActive={location.pathname === `/console/task/${task.id}`}
          onStop={setTaskToStop}
          onDelete={setTaskToDelete}
          onRenameSuccess={() => {
            reloadProjects()
            reloadUnlinkedTasks()
            reloadHistoricalTasks()
          }}
        />
      )
    })
  )

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
          reloadHistoricalTasks()
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

  const handleConfirmStopTask = () => {
    if (!taskToStop?.id) {
      setTaskToStop(null)
      return
    }
    setStopping(true)
    apiRequest(
      "v1UsersTasksStopUpdate",
      { id: taskToStop.id },
      [],
      (resp) => {
        setStopping(false)
        setTaskToStop(null)
        if (resp.code === 0) {
          toast.success("任务已终止")
          reloadProjects()
          reloadUnlinkedTasks()
          reloadHistoricalTasks()
        } else {
          toast.error(resp.message || "终止失败")
        }
      },
      () => {
        setStopping(false)
        setTaskToStop(null)
      }
    )
  }

  useEffect(() => {
    const timer = setInterval(() => {
      reloadProjects()
      reloadUnlinkedTasks()
      reloadHistoricalTasks()
    }, 30000)
    return () => clearInterval(timer)
  }, [reloadProjects, reloadUnlinkedTasks, reloadHistoricalTasks])

  const isUnlinkedActive = location.pathname === "/console/tasks"
  const isCollapsed = !isMobile && state === "collapsed"

  return (
    <SidebarGroup className="mt-4 p-0">
      <CreateDefaultTaskDialog
        open={defaultTaskDialogOpen}
        onOpenChange={setDefaultTaskDialogOpen}
      />
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
      {isCollapsed ? (
        <SidebarMenu className="gap-2">
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="空项目" isActive={isUnlinkedActive} asChild>
              <Link to="/console/tasks">
                <ListTodo />
                <span>空项目</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={projects.length > 0 ? "展开项目列表" : "创建项目"}
              isActive={location.pathname.startsWith("/console/project/")}
              onClick={() => {
                if (projects.length > 0) {
                  setOpen(true)
                } else {
                  setAddDialogOpen(true)
                }
              }}
            >
              <FolderOpen />
              <span>{projects.length > 0 ? "项目列表" : "创建项目"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      ) : (
        <SidebarMenu className="gap-2">
            <SidebarMenuItem>
              <SidebarMenuSub className="border-none px-0 mx-0">
                <SidebarMenuSubItem className="flex flex-col gap-0.5">
                  {renderTaskList(unlinkedTasks, "unlinked")}
                </SidebarMenuSubItem>
              </SidebarMenuSub>
              <SidebarMenuSub className="border-none px-0 mx-0">
                <SidebarMenuSubItem className="flex flex-col gap-0.5">
                  <SidebarMenuSubButton
                    asChild
                    size="md"
                    className="group/task-row py-4 text-sidebar-foreground/70 [&>svg]:size-3.5 [&>svg]:text-sidebar-foreground/70 hover:text-sidebar-accent-foreground hover:[&>svg]:text-sidebar-accent-foreground"
                  >
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-center gap-2 truncate"
                      onClick={() => setDefaultTaskDialogOpen(true)}
                    >
                      <IconPlus className="size-3.5 shrink-0" />
                      <span className="truncate">启动任务</span>
                    </button>
                  </SidebarMenuSubButton>
                  <button
                    type="button"
                    className="group/history-row flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    onClick={() => setHistoryExpanded((expanded) => !expanded)}
                  >
                    {historyExpanded ? (
                      <IconFolderOpen className="size-3.5 shrink-0 opacity-40" />
                    ) : (
                      <IconFolder className="size-3.5 shrink-0 opacity-40" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-left">历史任务</span>
                    {historyExpanded ? (
                      <IconChevronDown className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/history-row:opacity-50" />
                    ) : (
                      <IconChevronRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/history-row:opacity-50" />
                    )}
                  </button>
                  {historyExpanded && renderTaskList(historicalTasks, "history")}
                  {historyExpanded && (
                    <SidebarMenuSubButton
                      asChild
                      size="md"
                      isActive={location.pathname === "/console/tasks"}
                      className="group/task-row py-4"
                    >
                      <div className="flex w-full min-w-0 items-center gap-1">
                        <Link
                          to="/console/tasks"
                          className="min-w-0 flex-1 flex items-center gap-2 truncate"
                        >
                          <IconDots className="size-3.5 shrink-0" />
                          <span className="truncate">查看更多</span>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5 shrink-0 opacity-0 pointer-events-none"
                          tabIndex={-1}
                          aria-hidden="true"
                        />
                      </div>
                    </SidebarMenuSubButton>
                  )}
                </SidebarMenuSubItem>
              </SidebarMenuSub>
            </SidebarMenuItem>
            {projects.length > 0 && <Separator className="my-2" />}
            {projects.length > 0 ? projects.map((project) => {
              const projectId = project.id ?? ""
              const isProjectActive =
                location.pathname === `/console/project/${projectId}` ||
                location.pathname.startsWith(`/console/project/${projectId}/`) ||
                (project.tasks || []).some((task) => location.pathname === `/console/task/${task.id}`)
              return (
                <SidebarMenuItem key={projectId}>
                  <div
                    className={cn(
                      "group/project-row flex w-full items-center gap-1 overflow-hidden rounded-md pl-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0 my-1",
                      isProjectActive && "font-medium text-primary"
                    )}
                  >
                    <Link
                      to={`/console/project/${projectId}`}
                      className={cn(
                        "min-w-0 flex-1 flex items-center gap-2 truncate text-sidebar-foreground/70 group-hover/project-row:text-primary",
                        isProjectActive && "text-primary"
                      )}
                    >
                      <IconFolderOpen className="size-3.5 shrink-0 opacity-50" />
                      <span className="truncate">{project.name}</span>
                    </Link>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5 shrink-0 text-muted-foreground/50 group-hover/project-row:text-primary hover:text-primary"
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
                  {(project.tasks || []).length > 0 && (
                      <SidebarMenuSub className="border-none px-0 mx-0">
                        <SidebarMenuSubItem className="flex flex-col gap-0.5">
                          {(project.tasks || []).map((task: DomainProjectTask, index) => {
                            return (
                              <SidebarTaskItem
                                key={`${projectId}-${task.id ?? index}-${index}`}
                                task={task}
                                isActive={location.pathname === `/console/task/${task.id}`}
                                onStop={setTaskToStop}
                                onDelete={setTaskToDelete}
                                onRenameSuccess={() => {
                                  reloadProjects()
                                  reloadUnlinkedTasks()
                                  reloadHistoricalTasks()
                                }}
                              />
                            )
                          })}
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              )
            }) : (
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  暂无项目
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => setAddDialogOpen(true)} className="[&>svg]:size-3.5">
                <IconFolderPlus />
                <span>添加项目</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
      )}
      <AlertDialog open={!!taskToDelete} onOpenChange={(open) => !open && setTaskToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除任务</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除任务「{getTaskDisplayName(taskToDelete)}」吗？此操作不可撤销。
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
              {deleting ? "删除中..." : "删除任务"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!taskToStop} onOpenChange={(open) => !open && setTaskToStop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认终止任务</AlertDialogTitle>
            <AlertDialogDescription>
              确定要终止任务「{getTaskDisplayName(taskToStop)}」吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={stopping}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmStopTask()
              }}
              disabled={stopping}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {stopping ? "终止中..." : "终止任务"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarGroup>
  )
}
