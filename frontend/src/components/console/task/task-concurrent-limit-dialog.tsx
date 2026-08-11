import { ConstsTaskStatus, type DomainProjectTask } from "@/api/Api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { useCommonData } from "@/components/console/data-provider"
import { getTaskDisplayName, hasProSubscription } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { startBasicConcurrencyUpgradeJourney, trackBasicConcurrencyUpgradeEvent, trackSubscriptionConversion } from "@/lib/matomo"
import { IconArrowRight, IconCrown, IconPlayerStopFilled } from "@tabler/icons-react"
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
  const { subscription, user } = useCommonData()
  const hasAdvancedPlan = hasProSubscription(subscription)
  const isBasicPlan = subscription?.plan === "basic"
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

  useEffect(() => {
    if (open && isBasicPlan && user.id) {
      trackSubscriptionConversion("concurrency_limit_viewed", "basic")
    }
  }, [isBasicPlan, open, user.id])

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
    if (!isBasicPlan) return

    startBasicConcurrencyUpgradeJourney(user.id || "")
    trackBasicConcurrencyUpgradeEvent(user.id || "", "concurrency_limit_upgrade_clicked", "basic")
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
        {isBasicPlan && (
          <div className="mt-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <IconCrown className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t("taskWorkflow.concurrentLimit.upgradeTitle")}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t("taskWorkflow.concurrentLimit.upgradeDescription")}
                </p>
              </div>
            </div>
            <Button className="mt-3 w-full" onClick={handleUpgradePlan}>
              {t("taskWorkflow.concurrentLimit.upgradeAction")}
              <IconArrowRight className="size-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
