import { type DomainProjectTask } from "@/api/Api"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { stripMarkdown } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconPlus, IconCircleCheck, IconAlertTriangle, IconLoader, IconLayoutSidebar } from "@tabler/icons-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"

dayjs.extend(relativeTime)

const PAGE_SIZE = 500

export default function TaskViewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectId = searchParams.get('projectId') || undefined
  const [tasks, setTasks] = useState<DomainProjectTask[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(searchParams.get('taskId') || null)
  const [sidebarWidth, setSidebarWidth] = useState<'wide' | 'narrow'>('wide')
  const [, update] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      update(v => v + 1)
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    const params: { page: number; size: number; project_id?: string } = { page: 1, size: PAGE_SIZE }
    if (projectId) params.project_id = projectId
    await apiRequest('v1UsersTasksList', params, [], (resp) => {
      if (resp.code === 0) {
        const fetchedTasks = resp.data?.tasks || []
        setTasks(fetchedTasks)
        if (fetchedTasks.length > 0 && !selectedTaskId) {
          const firstTask = fetchedTasks[0]
          setSelectedTaskId(firstTask.id)
          const nextParams = new URLSearchParams({ taskId: firstTask.id })
          if (projectId) nextParams.set('projectId', projectId)
          setSearchParams(nextParams, { replace: true })
        } else if (selectedTaskId) {
          const foundTask = fetchedTasks.find((t: DomainProjectTask) => t.id === selectedTaskId)
          if (foundTask) {
            setTasks(fetchedTasks)
          }
        }
      } else {
        toast.error("获取任务列表失败: " + resp.message)
      }
    })
    setLoading(false)
  }, [selectedTaskId, setSearchParams, projectId])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  useEffect(() => {
    const taskIdFromUrl = searchParams.get('taskId')
    if (taskIdFromUrl && tasks.length > 0) {
      setTimeout(() => {
        const element = document.querySelector(`[data-task-id="${taskIdFromUrl}"]`)
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    }
  }, [tasks, searchParams])

  useEffect(() => {
    if (selectedTaskId) {
      setTimeout(() => {
        const element = document.querySelector(`[data-task-id="${selectedTaskId}"]`)
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    }
  }, [selectedTaskId])

  return (
    <div className="flex h-screen overflow-hidden">
      <div className={cn("border-r flex flex-col h-full bg-muted/30 overflow-hidden transition-all duration-300", sidebarWidth === 'wide' ? 'w-80' : 'w-40')}>
        <div className="flex p-2 gap-2">
          <Button 
            variant="outline" 
            size="sm"
            className="flex-1"
            onClick={() => window.location.href = projectId ? `/console/project/${projectId}` : '/console/tasks'}
          >
            <IconPlus className="w-4 h-4" />
            {sidebarWidth === 'wide' ? '启动新任务' : '新任务'}
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            className="flex-shrink-0"
            onClick={() => setSidebarWidth(sidebarWidth === 'wide' ? 'narrow' : 'wide')}
          >
            <IconLayoutSidebar className="w-4 h-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1 h-0">
          <div className="p-2 space-y-1">
            {loading && tasks.length === 0 ? (
              <div className="flex justify-center py-8">
                <Spinner className="size-6" />
              </div>
            ) : tasks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                暂无任务
              </div>
              ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  data-task-id={task.id}
                  className={cn(
                    "cursor-pointer transition-all hover:bg-accent rounded",
                    selectedTaskId === task.id && "bg-accent text-primary"
                  )}
                  onClick={() => {
                    setSelectedTaskId(task.id)
                    const nextParams = new URLSearchParams({ taskId: task.id })
                    if (projectId) nextParams.set('projectId', projectId)
                    setSearchParams(nextParams)
                  }}
                >
                  <div className={cn(sidebarWidth === 'wide' ? "px-3 py-2" : "px-2 py-2")}>
                    {sidebarWidth === 'wide' ? (
                      <div className="flex items-center gap-2 text-sm">
                        <div className="flex-shrink-0">
                          {task.status === "finished" && <IconCircleCheck className="w-4 h-4 text-muted-foreground/50" />}
                          {task.status === "error" && <IconAlertTriangle className="w-4 h-4 text-muted-foreground/50" />}
                          {(task.status === "pending" || task.status === "processing") && <IconLoader className="w-4 h-4 text-muted-foreground animate-spin" style={{ animationDuration: '3s' }} />}
                        </div>
                        <div className={cn("flex-1 line-clamp-1 break-all", selectedTaskId === task.id ? "text-primary" : task.status === "finished" && "text-muted-foreground")}>
                          {task.summary || stripMarkdown(task.content)}
                        </div>
                        <div className="flex-shrink-0 text-xs text-muted-foreground">
                          {dayjs.unix(task.created_at as number).fromNow()}
                        </div>
                      </div>
                    ) : (
                      <div className={cn("text-sm line-clamp-1 break-all", selectedTaskId === task.id ? "text-primary" : task.status === "finished" && "text-muted-foreground")}>
                        {task.summary || stripMarkdown(task.content)}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
      <div className="flex-1 flex flex-col h-full">
        {selectedTaskId ? (
          <iframe
            key={selectedTaskId}
            src={`/console/task/develop/${selectedTaskId}`}
            className="w-full h-full border-0"
            title="任务详情"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            请选择一个任务查看详情
          </div>
        )}
      </div>
    </div>
  )
}
