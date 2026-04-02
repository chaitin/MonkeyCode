import { ConstsTaskStatus, type DomainProjectTask } from "@/api/Api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { useCommonData } from "@/components/console/data-provider"
import { apiRequest } from "@/utils/requestUtils"
import { IconPlayerStopFilled } from "@tabler/icons-react"
import { useState, useEffect } from "react"
import { toast } from "sonner"

interface TaskConcurrentLimitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStopped?: () => void
}

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"

export function TaskConcurrentLimitDialog({ open, onOpenChange, onStopped }: TaskConcurrentLimitDialogProps) {
  const [tasks, setTasks] = useState<DomainProjectTask[]>([])
  const [loading, setLoading] = useState(false)
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const { subscription } = useCommonData()
  const isProPlan = subscription?.plan === "pro"
  const planLabel = isProPlan ? "专业版" : "基础版"
  const concurrentLimit = isProPlan ? 3 : 1

  useEffect(() => {
    if (!open) return
    setLoading(true)
    apiRequest("v1UsersTasksList", { page: 1, size: 10, status: "pending,processing" }, [], (resp) => {
      if (resp.code === 0) {
        setTasks((resp.data?.tasks || []).filter(
          (t: DomainProjectTask) => t.status === ConstsTaskStatus.TaskStatusPending || t.status === ConstsTaskStatus.TaskStatusProcessing
        ))
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

  const handleUpgradePlan = () => {
    onOpenChange(false)
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(OPEN_WALLET_DIALOG_EVENT, {
        detail: { section: "plan" },
      }))
    }, 0)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0">
        <DialogHeader>
          <DialogTitle>并发任务数已达上限</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">
          当前账号为{planLabel}，最多同时运行 {concurrentLimit} 个任务，请终止以下任务后再试。
        </div>
        <div className="mt-2 flex min-w-0 flex-col gap-2">
          {loading ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">暂无运行中的任务</div>
          ) : (
            tasks.map((task) => (
              <div key={task.id} className="flex min-w-0 items-center gap-3 overflow-hidden rounded-md border px-3 py-2">
                <div className="w-0 min-w-0 flex-1 overflow-hidden">
                  <span className="block truncate text-sm">
                    {task.summary || task.content || "未命名任务"}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 shrink-0 px-2 text-xs"
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
        {!isProPlan && (
          <div className="text-sm">
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={handleUpgradePlan}
            >
              升级专业版，可支持同时运行 3 个任务
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
