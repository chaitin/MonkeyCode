import { ConstsTaskStatus, type DomainProjectTask } from "@/api/Api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { useCommonData } from "@/components/console/data-provider"
import { getTaskDisplayName, hasProSubscription } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconPlayerStopFilled } from "@tabler/icons-react"
import { useCallback, useState, useEffect } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

interface TaskConcurrentLimitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStopped?: () => void
}

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"

export function TaskConcurrentLimitDialog({ open, onOpenChange, onStopped }: TaskConcurrentLimitDialogProps) {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState<DomainProjectTask[]>([])
  const [loading, setLoading] = useState(false)
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const { subscription } = useCommonData()
  const hasAdvancedPlan = hasProSubscription(subscription)
  const planLabel = (() => {
    switch (subscription?.plan) {
      case "flagship":
      case "ultra":
        return t("taskWorkflow.plan.ultra")
      case "pro":
        return t("taskWorkflow.plan.pro")
      case "basic":
      default:
        return t("taskWorkflow.plan.basic")
    }
  })()
  const concurrentLimit = hasAdvancedPlan ? 3 : 1

  const loadRunningTasks = useCallback(() => {
    setLoading(true)
    apiRequest("v1UsersTasksList", { page: 1, size: 10, status: "pending,processing" }, [], (resp) => {
      if (resp.code === 0) {
        setTasks((resp.data?.tasks || []).filter(
          (t: DomainProjectTask) => t.status === ConstsTaskStatus.TaskStatusPending || t.status === ConstsTaskStatus.TaskStatusProcessing
        ))
      }
      setLoading(false)
    }, () => setLoading(false))
  }, [])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(loadRunningTasks, 0)

    return () => window.clearTimeout(timer)
  }, [open, loadRunningTasks])

  const handleStop = async (taskId: string) => {
    setStoppingId(taskId)
    await apiRequest("v1UsersTasksStopUpdate", { id: taskId }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("taskWorkflow.concurrentLimit.stopped"))
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
        onStopped?.()
      } else {
        toast.error(resp.message || t("taskWorkflow.concurrentLimit.stopFailed"))
      }
    })
    setStoppingId(null)
  }

  const handleUpgradePlan = () => {
    onOpenChange(false)
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(OPEN_WALLET_DIALOG_EVENT, {
        detail: { section: "account" },
      }))
    }, 0)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0">
        <DialogHeader>
          <DialogTitle>{t("taskWorkflow.concurrentLimit.title")}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">
          {t("taskWorkflow.concurrentLimit.description", { planLabel, concurrentLimit })}
        </div>
        <div className="mt-2 flex min-w-0 flex-col gap-2">
          {loading ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">{t("taskWorkflow.concurrentLimit.empty")}</div>
          ) : (
            tasks.map((task) => (
              <div key={task.id} className="flex min-w-0 items-center gap-3 overflow-hidden rounded-md border px-3 py-2">
                <div className="w-0 min-w-0 flex-1 overflow-hidden">
                  <span className="block truncate text-sm">
                    {getTaskDisplayName(task, t("taskWorkflow.concurrentLimit.unnamedTask"))}
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
                  {t("taskWorkflow.concurrentLimit.stop")}
                </Button>
              </div>
            ))
          )}
        </div>
        {!hasAdvancedPlan && (
          <div className="text-sm">
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={handleUpgradePlan}
            >
              {t("taskWorkflow.concurrentLimit.upgrade")}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
