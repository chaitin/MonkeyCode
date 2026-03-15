import { type DomainProjectTask } from "@/api/Api";
import { TaskInput } from "@/components/console/task/task-input";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card";
import { Item, ItemContent, ItemDescription, ItemFooter, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { getRepoNameFromUrl, renderHoverCardContent, stripMarkdown } from "@/utils/common";
import { apiRequest } from "@/utils/requestUtils";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCommonData } from "@/components/console/data-provider";
import { toast } from "sonner";

const PAGE_SIZE = 24;

const formatTokens = (tokens?: number) => {
  if (!tokens) return ''
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`
  return tokens.toString()
}

export default function TasksPage() {
  const navigate = useNavigate()
  const { reloadProjects, reloadUnlinkedTasks } = useCommonData()
  const [tasks, setTasks] = useState<DomainProjectTask[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)

  const fetchTasks = useCallback((pageNum: number, append: boolean) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    const resetLoading = () => {
      loadingRef.current = false
      setLoading(false)
    }
    apiRequest('v1UsersTasksList', { page: pageNum, size: PAGE_SIZE, quick_start: true }, [], (resp) => {
      if (resp.code === 0) {
        const newTasks = resp.data?.tasks || []
        setTasks(prev => append ? [...prev, ...newTasks] : newTasks)
        setHasMore(newTasks.length >= PAGE_SIZE)
        setPage(pageNum)
      } else {
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
            <HoverCard>
              <HoverCardTrigger asChild>
                <ItemTitle className="font-normal whitespace-normal line-clamp-1 break-all hover:underline group-hover:text-primary cursor-pointer" onClick={() => navigate(`/console/task/${task.id}`)}>
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
    </div>
  )
}
