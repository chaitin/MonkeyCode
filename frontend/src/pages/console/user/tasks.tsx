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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TaskActionsDropdown } from "@/components/console/task/task-actions-dropdown";
import { cn } from "@/lib/utils";
import { formatTokens, getModelDisplayNameForModel, getTaskDisplayName, renderHoverCardContent } from "@/utils/common";
import { apiRequest } from "@/utils/requestUtils";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCommonData } from "@/components/console/data-provider";
import { confirmOdTaskConsumed, takeOdTaskContent } from "@/utils/od-task-import";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const PAGE_SIZE = 24;

export default function TasksPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { reloadProjects, reloadUnlinkedTasks, reloadHistoricalTasks } = useCommonData()
  const { t } = useTranslation()
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
  // Open Design handoff: od-web carries the prompt in the #od-task= fragment.
  // takeOdTaskContent() decodes it (persisting to sessionStorage and stripping
  // the URL on the spot, so the value survives a 401 → /login round trip and
  // pre-fills again on the post-login mount); the persisted copy is dropped
  // after the first successful list fetch proves the user is signed in.
  const [importedTaskContent] = useState<string | null>(() => takeOdTaskContent())

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
          toast.success(t("consoleTasks.toast.deleted"))
          setTasks((prev) => prev.filter((t) => t.id !== taskId))
          reloadProjects()
          reloadUnlinkedTasks()
          if (isOnDeletedPage) {
            navigate("/console/tasks")
          }
        } else {
          toast.error(resp.message || t("consoleTasks.toast.deleteFailed"))
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
          toast.success(t("consoleTasks.toast.stopped"))
          setTasks((prev) => prev.map((task) => (
            task.id === taskId
              ? { ...task, status: ConstsTaskStatus.TaskStatusError }
              : task
          )))
          reloadProjects()
          reloadUnlinkedTasks()
        } else {
          toast.error(resp.message || t("consoleTasks.toast.stopFailed"))
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
        confirmOdTaskConsumed()
        const newTasks = resp.data?.tasks || []
        setTasks(prev => append ? [...prev, ...newTasks] : newTasks)
        setHasMore(newTasks.length >= PAGE_SIZE)
        setPage(pageNum)
      } else {
        setHasMore(false)
        toast.error(t("consoleTasks.toast.fetchFailed", { message: resp.message || "" }))
      }
      resetLoading()
    }, () => resetLoading())
  }, [t])

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchTasks(page + 1, true)
    }
  }, [loading, hasMore, page, fetchTasks])

  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => fetchTasks(1, false), 0)

    return () => window.clearTimeout(initialLoadTimer)
  }, [fetchTasks])

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
      <h1 className="text-4xl pt-30 pb-10">{t("consoleTasks.title")}</h1>
      <div className="max-w-[800px] w-full py-10">
        <TaskInput repos={repos} initialContent={importedTaskContent ?? undefined} onTaskCreated={() => { setPage(1); setHasMore(true); fetchTasks(1, false); reloadProjects(); reloadUnlinkedTasks(); }} />
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
                  {title: t("consoleTasks.hover.taskName"), content: getTaskDisplayName(task)},
                  {title: t("consoleTasks.hover.taskContent"), content: task.content || ""},
                  {title: t("consoleTasks.hover.taskStatus"), content: task.status || ""},
                  {title: t("consoleTasks.hover.taskType"), content: `${task.type}/${task.sub_type}`},
                  task.repo_url ? {title: t("consoleTasks.hover.repository"), content: task.repo_url} : null,
                  task.repo_filename ? {title: t("consoleTasks.hover.repositoryFile"), content: task.repo_filename} : null,
                  task.repo_url ? {title: t("consoleTasks.hover.branch"), content: task.branch || ""} : null,
                  {title: t("consoleTasks.hover.developmentTool"), content: task.cli_name || ""},
                  {title: t("consoleTasks.hover.model"), content: getModelDisplayNameForModel(task.model)},
                  {title: t("consoleTasks.hover.createdAt"), content: dayjs.unix(task.created_at as number).format("YYYY-MM-DD HH:mm:ss")},
                ])}
              </HoverCard>
              <TaskActionsDropdown
                task={task}
                onStop={setTaskToStop}
                onDelete={setTaskToDelete}
                onRenameSuccess={(title) => handleTaskRenamed(task.id || "", title)}
                stopLabel={t("consoleTasks.actions.stop")}
                deleteLabel={t("consoleTasks.actions.delete")}
                triggerClassName="text-muted-foreground/50 group-hover:text-primary hover:text-primary"
              />
            </ItemHeader>
          </ItemContent>
          <ItemFooter className="flex flex-row gap-2 justify-between border-t pt-3 text-xs text-muted-foreground">
            <div className="flex flex-row gap-2">
              {task.status === "finished" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Badge variant="outline" className="text-muted-foreground">
                        <IconCircleCheck />
                        {t("consoleTasks.status.stopped")}
                      </Badge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t("consoleTasks.status.recycleTip")}</TooltipContent>
                </Tooltip>
              ) : (
                <Badge variant="outline" className={cn(task.status === "processing" || task.status === "pending" ? "" : "text-muted-foreground")} >
                  {task.status === "error" && <><IconAlertTriangle />{t("consoleTasks.status.startFailed")}</>}
                  {task.status === "pending" && <><Spinner />{t("consoleTasks.status.starting")}</>}
                  {task.status === "processing" && <><Spinner />{t("consoleTasks.status.processing")}</>}
                </Badge>
              )}
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

      {/* Infinite scroll sentinel */}
      <div ref={loadMoreRef} className="flex justify-center py-8">
        {loading && <Spinner className="size-6" />}
      </div>
      <AlertDialog open={!!taskToDelete} onOpenChange={(open) => !open && setTaskToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("consoleTasks.dialog.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("consoleTasks.dialog.delete.description", { taskName: getTaskDisplayName(taskToDelete) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("consoleTasks.dialog.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmDeleteTask()
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? t("consoleTasks.dialog.delete.confirming") : t("consoleTasks.dialog.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!taskToStop} onOpenChange={(open) => !open && setTaskToStop(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("consoleTasks.dialog.stop.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("consoleTasks.dialog.stop.description", { taskName: getTaskDisplayName(taskToStop) })}
              </AlertDialogDescription>
            </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={stopping}>{t("consoleTasks.dialog.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmStopTask()
              }}
              disabled={stopping}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {stopping ? t("consoleTasks.dialog.stop.confirming") : t("consoleTasks.dialog.stop.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
