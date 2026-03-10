import { ConstsTaskType, type DomainProjectTask } from "@/api/Api";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card";
import { Item, ItemContent, ItemDescription, ItemFooter, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { getRepoNameFromUrl, renderHoverCardContent, stripMarkdown } from "@/utils/common";
import { apiRequest } from "@/utils/requestUtils";
import { IconAlertTriangle, IconCircleCheck, IconListDetails } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

const PAGE_SIZE = 24;

export default function ProjectTasksPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const [tasks, setTasks] = useState<DomainProjectTask[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)

  const fetchTasks = useCallback((pageNum: number, append: boolean) => {
    if (!projectId || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    const resetLoading = () => {
      loadingRef.current = false
      setLoading(false)
    }
    apiRequest('v1UsersTasksList', { project_id: projectId, page: pageNum, size: PAGE_SIZE }, [], (resp) => {
      if (resp.code === 0) {
        const newTasks = resp.data?.tasks || []
        setTasks(prev => append ? [...prev, ...newTasks] : newTasks)
        setHasMore(newTasks.length >= PAGE_SIZE)
        setPage(pageNum)
      } else {
        toast.error("获取任务列表失败: " + resp.message)
      }
      resetLoading()
      setInitialLoading(false)
    }, () => {
      resetLoading()
      setInitialLoading(false)
    })
  }, [projectId])

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchTasks(page + 1, true)
    }
  }, [loading, hasMore, page, fetchTasks])

  useEffect(() => {
    if (projectId) {
      setTasks([])
      setInitialLoading(true)
      setPage(1)
      setHasMore(true)
      fetchTasks(1, false)
    }
  }, [projectId, fetchTasks])

  useEffect(() => {
    const el = loadMoreRef.current
    if (!el || !projectId) return
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
  }, [hasMore, loading, loadMore, projectId])

  if (initialLoading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="size-8" />
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <Empty className="border h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconListDetails className="" />
          </EmptyMedia>
          <EmptyTitle>暂无任务</EmptyTitle>
          <EmptyDescription>
            该项目下还没有创建任何任务
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">项目任务列表</h2>
        <span className="text-sm text-muted-foreground">共 {tasks.length} 个任务</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-4 w-full">
        {tasks?.map((task) => (
          <Item variant={"outline"} key={task.id} className="group hover:border-primary/50">
            <ItemContent>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <ItemTitle className="font-normal whitespace-normal line-clamp-1 break-all hover:underline group-hover:text-primary cursor-pointer" onClick={() => {
                    window.open(`/console/task/view?taskId=${task.id}&projectId=${projectId}`, "_blank")
                  }}>
                    {task.summary || stripMarkdown(task.content)}
                  </ItemTitle>
                </HoverCardTrigger>
                {renderHoverCardContent([
                  {title: "任务名称", content: task.summary || ""},
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
              <ItemDescription className="whitespace-normal line-clamp-1 break-all">
                {getRepoNameFromUrl(task?.repo_url || '') || task.repo_filename || '-'}
              </ItemDescription>
            </ItemContent>
            <ItemFooter className="flex flex-row gap-2 justify-between border-t pt-3 text-xs text-muted-foreground">
              <div className="flex flex-row gap-2">
                <Badge variant="outline" className={cn(task.status === "processing" || task.status === "pending" ? "" : "text-muted-foreground")} >
                  {task.status === "finished" && <><IconCircleCheck />任务完成</>}
                  {task.status === "error" && <><IconAlertTriangle />执行失败</>}
                  {task.status === "pending" && <><Spinner />等待执行</>}
                  {task.status === "processing" && <><Spinner />正在执行</>}
                </Badge>
                <Badge variant="outline" className={cn(task.status === "processing" || task.status === "pending" ? "" : "text-muted-foreground")}>
                  {task?.type === ConstsTaskType.TaskTypeDevelop && "开发任务"}
                  {task?.type === ConstsTaskType.TaskTypeDesign && "设计任务"}
                  {task?.type === ConstsTaskType.TaskTypeReview && "审查任务"}
                </Badge>
              </div>
            {dayjs.unix(task.created_at as number).fromNow()}
          </ItemFooter>
        </Item>
        ))}
      </div>
      <div ref={loadMoreRef} className="flex justify-center py-8">
        {loading && <Spinner className="size-6" />}
      </div>
    </div>
  )
}
