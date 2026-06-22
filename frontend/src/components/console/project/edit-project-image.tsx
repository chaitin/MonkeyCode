import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { DomainImage, DomainProject } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { useCommonData } from "@/components/console/data-provider"
import { apiRequest } from "@/utils/requestUtils"
import { getImageShortName, getOSFromImageName } from "@/utils/common"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { IconLoader } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

interface EditProjectImageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: DomainProject
  onSuccess?: () => void
}

export default function EditProjectImageDialog({
  open,
  onOpenChange,
  project,
  onSuccess,
}: EditProjectImageDialogProps) {
  const { images, loadingImages } = useCommonData()
  const [selectedImageId, setSelectedImageId] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    if (open && project) {
      const imageId = project.image_id ?? ""
      setSelectedImageId(imageId)
    }
  }, [open, project])

  const handleSave = async () => {
    if (!project?.id) return

    setLoading(true)
    await apiRequest(
      "v1UsersProjectsUpdate",
      { image_id: selectedImageId },
      [project.id],
      (resp) => {
        if (resp.code === 0) {
          toast.success(t("consoleProject.image.toast.saved"))
          onOpenChange(false)
          onSuccess?.()
        } else {
          toast.error(resp.message || t("consoleProject.image.toast.saveFailed"))
        }
      }
    )
    setLoading(false)
  }

  const handleCancel = () => {
    setSelectedImageId("")
    onOpenChange(false)
  }

  const selectableImages = images.filter((img): img is DomainImage & { id: string } => !!img.id)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("consoleProject.image.title")}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t("consoleProject.image.description")}
          </p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Select value={selectedImageId || "none"} onValueChange={(v) => setSelectedImageId(v === "none" ? "" : v)}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={loadingImages ? t("consoleProject.common.loading") : t("consoleProject.image.selectPlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("consoleProject.image.none")}</SelectItem>
                {selectableImages.map((image) => (
                  <SelectItem key={image.id} value={image.id}>
                    <div className="flex items-center gap-2">
                      <Icon name={getOSFromImageName(image.name || "")} className="size-4 shrink-0" />
                      <span>{image.remark || getImageShortName(image.name || "")}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            {t("consoleProject.common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <IconLoader className="size-4 animate-spin" />}
            {t("consoleProject.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
