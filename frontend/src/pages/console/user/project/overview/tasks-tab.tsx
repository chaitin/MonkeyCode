import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { type DomainProjectTask } from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card"
import { Item, ItemContent, ItemDescription, ItemFooter, ItemHeader, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { IconListDetails, IconCircleCheck, IconAlertTriangle, IconDotsVertical, IconTrash } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { useCommonData } from "@/components/console/common-data"
import { getRepoNameFromUrl, renderHoverCardContent, stripMarkdown } from "@/utils/common"
import dayjs from "dayjs"

const TASKS_PAGE_SIZE = 24

const formatTokens = (tokens?: number) => {
  if (!tokens) return ""
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`
  return tokens.toString()
}

interface ProjectOverviewTasksTabProps {
  projectId: string
  refreshKey?: number
}

export default function ProjectOverviewTasksTab({ projectId, refreshKey }: ProjectOverviewTasksTabProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { reloadProjects, reloadUnlinkedTasks } = useCommonData()
  const [tasks, setTasks] = useState<DomainProjectTask[]>([])
  const [tasksPage, setTasksPage] = useState(1)
  const [tasksHasMore, setTasksHasMore] = useState(true)
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksInitialLoading, setTasksInitialLoading] = useState(true)
  const [taskToDelete, setTaskToDelete] = useState<DomainProjectTask | null>(null)
  const [deleting, setDeleting] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const tasksLoadingRef = useRef(false)

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
          setTasks((prev) => prev.filter((t) => t.id !== taskId))
          reloadProjects()
          reloadUnlinkedTasks()
          if (isOnDeletedPage) {
            navigate(`/console/project/${projectId}`)
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

  const fetchTasks = useCallback((pageNum: number, append: boolean) => {
    if (!projectId || tasksLoadingRef.current) return
    tasksLoadingRef.current = true
    setTasksLoading(true)
    const reset = () => {
      tasksLoadingRef.current = false
      setTasksLoading(false)
    }
    apiRequest("v1UsersTasksList", { project_id: projectId, page: pageNum, size: TASKS_PAGE_SIZE }, [], (resp) => {
      if (resp.code === 0) {
        const newTasks = resp.data?.tasks || []
        setTasks((prev) => (append ? [...prev, ...newTasks] : newTasks))
        setTasksHasMore(newTasks.length >= TASKS_PAGE_SIZE)
        setTasksPage(pageNum)
      } else {
        toast.error("获取任务列表失败: " + resp.message)
      }
      reset()
      setTasksInitialLoading(false)
    }, () => {
      reset()
      setTasksInitialLoading(false)
    })
  }, [projectId])

  const loadMoreTasks = useCallback(() => {
    if (!tasksLoading && tasksHasMore) fetchTasks(tasksPage + 1, true)
  }, [tasksLoading, tasksHasMore, tasksPage, fetchTasks])

  useEffect(() => {
    if (projectId) {
      setTasks([])
      setTasksPage(1)
      setTasksHasMore(true)
      setTasksInitialLoading(true)
      fetchTasks(1, false)
    }
  }, [projectId, refreshKey, fetchTasks])

  useEffect(() => {
    const el = loadMoreRef.current
    if (!el || !projectId) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && tasksHasMore && !tasksLoading) loadMoreTasks()
      },
      { rootMargin: "200px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [tasksHasMore, tasksLoading, loadMoreTasks, projectId])

  if (tasksInitialLoading && tasks.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <Spinner className="size-8" />
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <Empty className="border flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconListDetails />
            </EmptyMedia>
            <EmptyTitle>暂无任务</EmptyTitle>
            <EmptyDescription>该项目下还没有创建任何任务</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-auto">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-4 w-full">
        {tasks.map((task) => (
          <Item variant="outline" key={task.id} className="group hover:border-primary/50">
            <ItemContent>
              <ItemHeader className="items-start gap-2">
                <HoverCard>
                  <HoverCardTrigger asChild>
                    <ItemTitle
                      className="font-normal whitespace-normal line-clamp-1 break-all hover:underline group-hover:text-primary cursor-pointer min-w-0 flex-1"
                      onClick={() => navigate(`/console/task/${task.id}`)}
                    >
                      {task.summary || stripMarkdown(task.content)}
                    </ItemTitle>
                  </HoverCardTrigger>
                  {renderHoverCardContent([
                    { title: "任务名称", content: task.summary || "" },
                    { title: "任务内容", content: task.content || "" },
                    { title: "任务状态", content: task.status || "" },
                    {
                      title: "任务类型",
                      content: task.type ? [task.type, task.sub_type].filter(Boolean).join("/") : "",
                    },
                    task.repo_url ? { title: "代码仓库", content: task.repo_url } : null,
                    task.repo_filename ? { title: "代码文件", content: task.repo_filename } : null,
                    task.repo_url ? { title: "仓库分支", content: task.branch || "" } : null,
                    { title: "开发工具", content: task.cli_name || "" },
                    { title: "大模型", content: task.model?.model || "" },
                    {
                      title: "创建时间",
                      content: dayjs.unix(task.created_at as number).format("YYYY-MM-DD HH:mm:ss"),
                    },
                  ])}
                </HoverCard>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 shrink-0 text-muted-foreground/50 group-hover:text-primary hover:text-primary"
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
              </ItemHeader>
              <ItemDescription className="whitespace-normal line-clamp-1 break-all">
                {getRepoNameFromUrl(task?.repo_url || "") || task.repo_filename || "-"}
              </ItemDescription>
            </ItemContent>
            <ItemFooter className="flex flex-row gap-2 justify-between border-t pt-3 text-xs text-muted-foreground">
              <div className="flex flex-row gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    task.status === "processing" || task.status === "pending" ? "" : "text-muted-foreground"
                  )}
                >
                  {task.status === "finished" && (
                    <>
                      <IconCircleCheck />
                      任务完成
                    </>
                  )}
                  {task.status === "error" && (
                    <>
                      <IconAlertTriangle />
                      执行失败
                    </>
                  )}
                  {task.status === "pending" && (
                    <>
                      <Spinner />
                      等待执行
                    </>
                  )}
                  {task.status === "processing" && (
                    <>
                      <Spinner />
                      正在执行
                    </>
                  )}
                </Badge>
                {task.stats?.total_tokens ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    {formatTokens(task.stats.total_tokens)} tokens
                  </Badge>
                ) : null}
              </div>
              {dayjs.unix(task.created_at as number).fromNow()}
            </ItemFooter>
          </Item>
        ))}
      </div>
      <div ref={loadMoreRef} className="flex justify-center py-8">
        {tasksLoading && <Spinner className="size-6" />}
      </div>
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
    </div>
  )
}
