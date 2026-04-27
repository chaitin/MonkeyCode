import { ConstsTaskStatus, type DomainProjectTask } from "@/api/Api";
import { TaskInput } from "@/components/console/task/task-input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card";
import { Item, ItemContent, ItemFooter, ItemHeader, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { TaskActionsDropdown } from "@/components/console/task/task-actions-dropdown";
import { cn } from "@/lib/utils";
import { formatTokens, getTaskDisplayName, renderHoverCardContent } from "@/utils/common";
import { apiRequest } from "@/utils/requestUtils";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCommonData } from "@/components/console/data-provider";
import { toast } from "sonner";

const PAGE_SIZE = 24;

export default function TasksPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { reloadProjects, reloadUnlinkedTasks, reloadHistoricalTasks } = useCommonData()
  const [tasks, setTasks] = useState<DomainProjectTask[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [taskToDelete, setTaskToDelete] = useState<DomainProjectTask | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [taskToStop, setTaskToStop] = useState<DomainProjectTask | null>(null)
  const [stopping, setStopping] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)

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
    const taskId = taskToStop.id
    setStopping(true)
    apiRequest(
      "v1UsersTasksStopUpdate",
      { id: taskId },
      [],
      (resp) => {
        setStopping(false)
        setTaskToStop(null)
        if (resp.code === 0) {
          toast.success("任务已终止")
          setTasks((prev) => prev.map((task) => (
            task.id === taskId
              ? { ...task, status: ConstsTaskStatus.TaskStatusError }
              : task
          )))
          reloadProjects()
          reloadUnlinkedTasks()
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

  const handleTaskRenamed = (taskId: string, title: string) => {
    setTasks((prev) => prev.map((task) => (
      task.id === taskId
        ? { ...task, title }
        : task
    )))
    reloadProjects()
    reloadUnlinkedTasks()
    reloadHistoricalTasks()
  }

  const fetchTasks = useCallback((pageNum: number, append: boolean) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    const resetLoading = () => {
      loadingRef.current = false
      setLoading(false)
    }
    apiRequest('v1UsersTasksList', { page: pageNum, size: PAGE_SIZE }, [], (resp) => {
      if (resp.code === 0) {
        const newTasks = resp.data?.tasks || []
        setTasks(prev => append ? [...prev, ...newTasks] : newTasks)
        setHasMore(newTasks.length >= PAGE_SIZE)
        setPage(pageNum)
      } else {
        setHasMore(false)
        toast.error("获取任务列表失败: " + resp.message)
      }
      resetLoading()
    }, () => resetLoading())
  }, [])

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchTasks(page + 1, true)
    }
  }, [loading, hasMore, page, fetchTasks])

  useEffect(() => {
    fetchTasks(1, false)
  }, [])

  useEffect(() => {
    const el = loadMoreRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          loadMore()
        }
      },
      { rootMargin: "200px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loading, loadMore])

  const repos = useMemo(() => {
    const reposList = tasks.filter((task: DomainProjectTask) => {
      return !!task.repo_url
    }).map((task: DomainProjectTask) => {
      return task.repo_url as string
    })
    if (reposList.length > 0) {
      return reposList.filter((repo, idx, arr) => arr.indexOf(repo) === idx)
    } else {
      return ["https://github.com/chaitin/monkeycode-practise"]
    } 
  }, [tasks])

  return (
    <div className="flex flex-col flex-1 items-center">
      <h1 className="text-4xl pt-30 pb-10">MonkeyCode 智能任务</h1>
      <div className="max-w-[800px] w-full py-10">
        <TaskInput repos={repos} onTaskCreated={() => { setPage(1); setHasMore(true); fetchTasks(1, false); reloadProjects(); reloadUnlinkedTasks(); }} />
      </div>
      <Separator className="my-4"/>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-4 w-full">
      {tasks?.map((task) => (
        <Item variant={"outline"} key={task.id} className="group hover:border-primary/50">
          <ItemContent>
            <ItemHeader className="items-start gap-2">
              <HoverCard>
                <HoverCardTrigger asChild>
                  <ItemTitle className="font-normal whitespace-normal line-clamp-1 break-all hover:underline group-hover:text-primary cursor-pointer min-w-0 flex-1" onClick={() => navigate(`/console/task/${task.id}`)}>
                    {getTaskDisplayName(task)}
                  </ItemTitle>
                </HoverCardTrigger>
                {renderHoverCardContent([
                  {title: "任务名称", content: getTaskDisplayName(task)},
                  {title: "任务内容", content: task.content || ""},
                  {title: "任务状态", content: task.status || ""},
                  {title: "任务类型", content: `${task.type}/${task.sub_type}` || ""},
                  task.repo_url ? {title: "代码仓库", content: task.repo_url} : null,
                  task.repo_filename ? {title: "代码文件", content: task.repo_filename} : null,
                  task.repo_url ? {title: "仓库分支", content: task.branch || ""} : null,
                  {title: "开发工具", content: task.cli_name || ""},
                  {title: "大模型", content: task.model?.model || ""},
                  {title: "创建时间", content: dayjs.unix(task.created_at as number).format("YYYY-MM-DD HH:mm:ss")},
                ])}
              </HoverCard>
              <TaskActionsDropdown
                task={task}
                onStop={setTaskToStop}
                onDelete={setTaskToDelete}
                onRenameSuccess={(title) => handleTaskRenamed(task.id || "", title)}
                stopLabel="终止"
                deleteLabel="删除"
                triggerClassName="text-muted-foreground/50 group-hover:text-primary hover:text-primary"
              />
            </ItemHeader>
          </ItemContent>
          <ItemFooter className="flex flex-row gap-2 justify-between border-t pt-3 text-xs text-muted-foreground">
            <div className="flex flex-row gap-2">
              <Badge variant="outline" className={cn(task.status === "processing" || task.status === "pending" ? "" : "text-muted-foreground")} >
                {task.status === "finished" && <><IconCircleCheck />已关机</>}
                {task.status === "error" && <><IconAlertTriangle />启动失败</>}
                {task.status === "pending" && <><Spinner />正在启动</>}
                {task.status === "processing" && <><Spinner />运行中</>}
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

      {/* 无限滚动触发点 */}
      <div ref={loadMoreRef} className="flex justify-center py-8">
        {loading && <Spinner className="size-6" />}
      </div>
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
              {deleting ? "删除中..." : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!taskToStop} onOpenChange={(open) => !open && setTaskToStop(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认终止任务</AlertDialogTitle>
              <AlertDialogDescription>
                确定要终止任务「{getTaskDisplayName(taskToStop)}」吗？任务终止后无法恢复。
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
              {stopping ? "终止中..." : "终止"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
