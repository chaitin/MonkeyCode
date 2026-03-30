import { ConstsTaskStatus, type DomainProjectTask } from "@/api/Api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest } from "@/utils/requestUtils"
import { IconPlayerStopFilled } from "@tabler/icons-react"
import { useState, useEffect } from "react"
import { toast } from "sonner"

interface TaskConcurrentLimitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStopped?: () => void
}

export function TaskConcurrentLimitDialog({ open, onOpenChange, onStopped }: TaskConcurrentLimitDialogProps) {
  const [tasks, setTasks] = useState<DomainProjectTask[]>([])
  const [loading, setLoading] = useState(false)
  const [stoppingId, setStoppingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    apiRequest("v1UsersTasksList", { page: 1, size: 10 }, [], (resp) => {
      if (resp.code === 0) {
        const running = (resp.data?.tasks || []).filter(
          (t: DomainProjectTask) => t.status === ConstsTaskStatus.TaskStatusPending || t.status === ConstsTaskStatus.TaskStatusProcessing
        )
        setTasks(running)
      }
      setLoading(false)
    }, () => setLoading(false))
  }, [open])

  const handleStop = async (taskId: string) => {
    setStoppingId(taskId)
    await apiRequest("v1UsersTasksStopUpdate", { id: taskId }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("任务已终止")
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
        onStopped?.()
      } else {
        toast.error(resp.message || "终止失败")
      }
    })
    setStoppingId(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>并发任务数已达上限</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">
          当前账号最多同时运行 1 个任务，请终止以下任务后再试。
        </div>
        <div className="flex flex-col gap-2 mt-2">
          {loading ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">暂无运行中的任务</div>
          ) : (
            tasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <span className="text-sm truncate flex-1">
                  {task.summary || task.content || "未命名任务"}
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2 text-xs"
                  disabled={stoppingId === task.id}
                  onClick={() => handleStop(task.id!)}
                >
                  {stoppingId === task.id ? <Spinner className="size-4" /> : <IconPlayerStopFilled className="size-4" />}
                  终止
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
