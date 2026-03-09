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

const PAGE_SIZE = 50

export default function TaskViewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tasks, setTasks] = useState<DomainProjectTask[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(searchParams.get('taskId') || null)
  const [selectedTask, setSelectedTask] = useState<DomainProjectTask | null>(null)
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
    await apiRequest('v1UsersTasksList', { page: 1, size: PAGE_SIZE }, [], (resp) => {
      if (resp.code === 0) {
        const fetchedTasks = resp.data?.tasks || []
        setTasks(fetchedTasks)
        if (fetchedTasks.length > 0 && !selectedTaskId) {
          const firstTask = fetchedTasks[0]
          setSelectedTaskId(firstTask.id)
          setSelectedTask(firstTask)
          setSearchParams({ taskId: firstTask.id }, { replace: true })
        } else if (selectedTaskId) {
          const foundTask = fetchedTasks.find(t => t.id === selectedTaskId)
          if (foundTask) {
            setSelectedTask(foundTask)
          }
        }
      } else {
        toast.error("获取任务列表失败: " + resp.message)
      }
    })
    setLoading(false)
  }, [selectedTaskId, setSearchParams])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const taskTitle = selectedTask?.summary || stripMarkdown(selectedTask?.content || "")

  return (
    <div className="flex h-screen overflow-hidden">
      <div className={cn("border-r flex flex-col h-full bg-muted/30 overflow-hidden transition-all duration-300", sidebarWidth === 'wide' ? 'w-80' : 'w-40')}>
        <div className="flex p-2 gap-2">
          <Button 
            variant="outline" 
            size="sm"
            className="flex-1"
            onClick={() => window.location.href = '/console/tasks'}
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
                  className={cn(
                    "cursor-pointer transition-all hover:bg-accent rounded",
                    selectedTaskId === task.id && "bg-accent"
                  )}
                  onClick={() => {
                    setSelectedTaskId(task.id)
                    setSelectedTask(task)
                    setSearchParams({ taskId: task.id })
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
                        <div className="flex-1 min-w-0 line-clamp-1">
                          {task.summary || stripMarkdown(task.content)}
                        </div>
                        <div className="flex-shrink-0 text-xs text-muted-foreground">
                          {dayjs.unix(task.created_at as number).fromNow()}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm line-clamp-1">
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
