import type { DomainProject } from "@/api/Api"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { apiRequest } from "@/utils/requestUtils"
import { IconLoader, IconViewfinder } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

interface AutoReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: DomainProject
  onSuccess?: () => void
}

export default function AutoReviewDialog({
  open,
  onOpenChange,
  project,
  onSuccess,
}: AutoReviewDialogProps) {
  const [enabled, setEnabled] = useState(project?.auto_review_enabled ?? false)
  const [loading, setLoading] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    if (open && project) {
      setEnabled(project.auto_review_enabled ?? false)
    }
  }, [open, project])

  const handleToggle = async (checked: boolean) => {
    if (!project?.id) return

    setLoading(true)
    const apiMethod = checked ? "v1UsersProjectsAutoReviewCreate" : "v1UsersProjectsAutoReviewDelete"
    await apiRequest(apiMethod, {}, [project.id], (resp) => {
      if (resp.code === 0) {
        setEnabled(checked)
        toast.success(checked ? t("consoleProject.autoReview.toast.enabled") : t("consoleProject.autoReview.toast.disabled"))
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleProject.autoReview.toast.failed"))
      }
    })
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconViewfinder className="size-5" />
            {t("consoleProject.autoReview.title")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("consoleProject.autoReview.project")}</Label>
            <Input
              value={project?.name || ""}
              readOnly
              className="bg-muted/50"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("consoleProject.autoReview.label")}</Label>
            <div className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2">
              <span className="text-sm text-muted-foreground">
                {enabled ? t("consoleProject.autoReview.enabled") : t("consoleProject.autoReview.disabled")}
              </span>
              <div className="flex items-center gap-2">
                {loading && (
                  <IconLoader className="size-4 animate-spin text-muted-foreground" />
                )}
                <Switch
                  id="auto-review-switch"
                  checked={enabled}
                  onCheckedChange={handleToggle}
                  disabled={loading}
                  className="cursor-pointer disabled:cursor-not-allowed"
                />
              </div>
            </div>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t("consoleProject.autoReview.description")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
