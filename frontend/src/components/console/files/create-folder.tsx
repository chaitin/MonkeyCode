import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { normalizePath } from "@/utils/common"
import { useTranslation } from "react-i18next"

interface CreateFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetDir: string
  envid: string
  baseDir?: string
  onSuccess?: () => void
}

export default function CreateFolderDialog({
  open,
  onOpenChange,
  targetDir,
  envid,
  baseDir = '',
  onSuccess,
}: CreateFolderDialogProps) {
  const { t } = useTranslation()
  const [folderName, setFolderName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset the controlled dialog field whenever the parent opens it.
      setFolderName('')
    }
  }, [open])

  const handleCreate = async () => {
    if (!folderName.trim() || !envid) {
      toast.error(t("consoleFiles.toast.folderNameRequired"))
      return
    }

    const folderPath = normalizePath(baseDir + '/' + targetDir + '/' + folderName.trim())
    setCreating(true)
    await apiRequest('v1UsersFoldersCreate', {
        id: envid,
        path: folderPath
      }, [], (resp) => {
        if (resp.code === 0) {
          toast.success(t("consoleFiles.toast.folderCreated", { name: folderName.trim() }))
          onOpenChange(false)
          if (onSuccess) {
            onSuccess()
          }
        } else {
          toast.error(t("consoleFiles.toast.folderCreateFailed", { message: resp.message }));
        }
      })
    setCreating(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleFiles.actions.createFolder")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel>{t("consoleFiles.labels.targetDirectory")}</FieldLabel>
            <Input
              value={targetDir || './'}
              readOnly
              className="bg-muted"
            />
          </Field>
          <Field>
            <FieldLabel>{t("consoleFiles.labels.newFolderName")}</FieldLabel>
            <Input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              autoFocus
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t("consoleFiles.actions.cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={!folderName.trim() || creating}>
            {creating && <Spinner />}
            {t("consoleFiles.actions.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
