import { type DomainProjectTask } from "@/api/Api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { stripMarkdown } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconPlus } from "@tabler/icons-react"
import dayjs from "dayjs"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

const PAGE_SIZE = 50

export default function TaskViewPage() {
  const [tasks, setTasks] = useState<DomainProjectTask[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<DomainProjectTask | null>(null)

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
        }
      } else {
        toast.error("获取任务列表失败: " + resp.message)
      }
    })
    setLoading(false)
  }, [selectedTaskId])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const taskTitle = selectedTask?.summary || stripMarkdown(selectedTask?.content || "")

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="w-80 border-r flex flex-col h-full bg-background overflow-hidden">
        <div className="p-2">
          <Button 
            variant="outline" 
            size="sm"
            className="w-full"
            onClick={() => window.location.href = '/console/tasks'}
          >
            <IconPlus className="w-4 h-4 mr-2" />
            启动新任务
          </Button>
        </div>
        <ScrollArea className="flex-1 h-0">
          <div className="p-2 space-y-2">
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
                    "p-3 rounded-lg border cursor-pointer transition-all hover:bg-accent",
                    selectedTaskId === task.id && "bg-accent border-primary"
                  )}
                  onClick={() => {
                    setSelectedTaskId(task.id)
                    setSelectedTask(task)
                  }}
                >
                  <div className="font-medium text-sm line-clamp-1 break-all mb-2">
                    {task.summary || stripMarkdown(task.content)}
                  </div>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      {task.status === "finished" && "已完成"}
                      {task.status === "error" && "失败"}
                      {task.status === "pending" && "等待中"}
                      {task.status === "processing" && "执行中"}
                    </Badge>
                    <div className="text-xs text-muted-foreground">
                      {dayjs.unix(task.created_at as number).fromNow()}
                    </div>
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
