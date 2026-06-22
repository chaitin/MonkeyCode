import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import type { DomainProject } from "@/api/Api"
import { useEffect, useState } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { IconLoader } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

interface EditProjectNameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: DomainProject
  onSuccess?: () => void
}

export default function EditProjectNameDialog({
  open,
  onOpenChange,
  project,
  onSuccess,
}: EditProjectNameDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [loading, setLoading] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    if (open && project) {
      setName(project.name || "")
      setDescription(project.description || "")
    } else if (!open) {
      setName("")
      setDescription("")
    }
  }, [open, project])

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t("consoleProject.editName.toast.nameRequired"))
      return
    }

    setLoading(true)

    await apiRequest('v1UsersProjectsUpdate', { 
      name: name.trim(),
      description: description.trim(),
    }, [project?.id!], (resp) => {
        if (resp.code === 0) {
          toast.success(t("consoleProject.editName.toast.updated"))
          onOpenChange(false)
          onSuccess?.()
        } else {
          toast.error(t("consoleProject.editName.toast.updateFailed", { message: resp.message || t("consoleProject.common.unknownError") }))
        }
      }
    )
    setLoading(false)
  }

  const handleCancel = () => {
    setName("")
    setDescription("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleProject.editName.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="project-name">{t("consoleProject.editName.name")}</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("consoleProject.editName.namePlaceholder")}
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-description">{t("consoleProject.editName.description")}</Label>
          <Textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("consoleProject.editName.descriptionPlaceholder")}
            disabled={loading}
            className="break-all"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            {t("consoleProject.common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={loading || !name.trim()}>
            {loading && <IconLoader className="size-4 animate-spin" />}
            {t("consoleProject.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
