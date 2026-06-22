import { useState } from "react"
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

interface AddImageProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRefresh?: () => void
}

export default function AddImage({
  open,
  onOpenChange,
  onRefresh,
}: AddImageProps) {
  const { t } = useTranslation()
  const [imageName, setImageName] = useState("")
  const [remark, setRemark] = useState("")

  const handleSave = () => {
    if (!imageName.trim()) {
      toast.error(t("consoleSettings.images.toast.nameRequired"))
      return
    }

    apiRequest('v1UsersImagesCreate', { image_name: imageName.trim(), remark: remark.trim() || undefined }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleSettings.images.toast.addSuccess"))
        setImageName("")
        setRemark("")
        onOpenChange(false)
        onRefresh?.()
      } else {
        toast.error(t("consoleSettings.images.toast.addFailed", { message: resp.message }))
      }
    })
  }

  const handleCancel = () => {
    setImageName("")
    setRemark("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant={"outline"} size="sm">{t("consoleSettings.images.actions.bind")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleSettings.images.add.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field>
            <FieldLabel>{t("consoleSettings.images.labels.imageName")}</FieldLabel>
            <FieldContent>
              <Input
                placeholder="docker.io/library/ubuntu:24.04"
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
