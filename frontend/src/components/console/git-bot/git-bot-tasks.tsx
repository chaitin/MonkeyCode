import type { DomainGitBotTask } from "@/api/Api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Item, ItemContent, ItemDescription, ItemFooter, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { getGitPlatformIcon } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconAlertTriangle, IconCircleCheck, IconFolder, IconLoader, IconReload } from "@tabler/icons-react"
import dayjs from "dayjs"
import { BookOpenIcon } from "lucide-react"
import { forwardRef, useCallback, useImperativeHandle, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

const PAGE_SIZE = 24;

export interface GitBotTasksRef {
  fetchTasks: () => Promise<void>
}

export const GitBotTasks = forwardRef<GitBotTasksRef>(function GitBotTasks(_, ref) {
  const [tasks, setTasks] = useState<DomainGitBotTask[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)

  const fetchTasksImpl = useCallback((pageNum: number, append: boolean) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    const resetLoading = () => {
      loadingRef.current = false
      setLoading(false)
    }
    apiRequest("v1UsersGitBotsTasksList", { page: pageNum, size: PAGE_SIZE }, [], (resp) => {
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
  }, [])

  const fetchTasks = useCallback(async () => {
    setPage(1)
    setHasMore(true)
    fetchTasksImpl(1, false)
  }, [fetchTasksImpl])

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchTasksImpl(page + 1, true)
    }
  }, [loading, hasMore, page, fetchTasksImpl])

  useImperativeHandle(ref, () => ({
    fetchTasks
  }))

  useEffect(() => {
    fetchTasksImpl(1, false)
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

  if (initialLoading && tasks.length === 0) {
    return (
      <div className="flex w-full h-full">
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLoader className="animate-spin" />
            </EmptyMedia>
            <EmptyDescription>正在加载...</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="flex w-full h-full">
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFolder />
            </EmptyMedia>
            <EmptyDescription>暂无任务</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex gap-2">
              <Button variant="outline" onClick={fetchTasks}>
                <IconReload />
                刷新
              </Button>
              <Button variant="default" asChild>
                <a href="https://monkeycode.docs.baizhi.cloud/node/019bd94c-2fd8-7276-9382-74e3a0d4a397" target="_blank">
                  <BookOpenIcon />
                  如何使用？
                </a>
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      </div>
    )
  }





  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-4 w-full">
      {tasks.map((task, index) => {
        return (
          <Item variant={"outline"} key={task.id || index} className="group hover:border-primary/50">
            <ItemContent>
              <ItemTitle
                className="font-normal whitespace-normal line-clamp-1 break-all hover:underline group-hover:text-primary cursor-pointer"
                onClick={() => {
                  window.open(task.pull_request?.url || "", "_blank")
                }}
              >
                {task.pull_request?.title}
              </ItemTitle>
              <ItemDescription className="whitespace-normal line-clamp-1 break-all">
                {task.repo?.repo_name}
              </ItemDescription>
            </ItemContent>
            <ItemFooter className="flex flex-row gap-2 justify-between border-t pt-3 text-xs text-muted-foreground">
              <div className="flex flex-row gap-2">
                <Badge variant="outline">
                  {task.status === "finished" && <><IconCircleCheck />任务完成</>}
                  {task.status === "error" && <><IconAlertTriangle />执行失败</>}
                  {task.status === "pending" && <><Spinner />等待执行</>}
                  {task.status === "processing" && <><Spinner />正在执行</>}
                </Badge>
                <Badge variant="outline">
                  {getGitPlatformIcon(task.bot?.platform)}
                  {task.bot?.name}
                </Badge>
              </div>
              {dayjs.unix(task.created_at || 0).fromNow()}
            </ItemFooter>
          </Item>
        )
      })}
      </div>
      <div ref={loadMoreRef} className="flex justify-center py-8">
        {loading && <Spinner className="size-6" />}
      </div>
    </div>
  )
})
