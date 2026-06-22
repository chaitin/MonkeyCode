import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

interface EditImageProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  image: { id: string; image_name: string; remark: string } | null
  onRefresh?: () => void
  trigger?: React.ReactNode
}

export default function EditImage({
  open,
  onOpenChange,
  image,
  onRefresh,
  trigger,
}: EditImageProps) {
  const { t } = useTranslation()
  const [imageName, setImageName] = useState("")
  const [remark, setRemark] = useState("")

  useEffect(() => {
    if (image) {
      setImageName(image.image_name)
      setRemark(image.remark)
    }
  }, [image])

  const handleSave = () => {
    if (!image?.id) {
      toast.error(t("consoleSettings.images.toast.incomplete"))
      return
    }

    if (!imageName.trim()) {
      toast.error(t("consoleSettings.images.toast.nameRequired"))
      return
    }

    apiRequest('v1UsersImagesUpdate',
      { image_name: imageName.trim(), remark: remark.trim() },
      [image.id],
      () => {
        toast.success(t("consoleSettings.images.toast.updateSuccess"))
        setImageName("")
        setRemark("")
        onOpenChange(false)
        onRefresh?.()
      }
    )
  }

  const handleCancel = () => {
    setImageName("")
    setRemark("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleSettings.images.edit.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field>
            <FieldLabel>{t("consoleSettings.images.labels.imageName")}</FieldLabel>
            <FieldContent>
              <Input
                value={imageName}
                onChange={(e) => setImageName(e.target.value)}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>{t("consoleSettings.images.labels.remark")}</FieldLabel>
            <FieldContent>
              <Input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </FieldContent>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t("consoleSettings.images.actions.cancel")}
          </Button>
          <Button onClick={handleSave}>
            {t("consoleSettings.images.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
