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

interface MoveFileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourcePath: string
  envid: string
  baseDir?: string
  onSuccess?: () => void
}

export default function MoveFileDialog({
  open,
  onOpenChange,
  sourcePath,
  envid,
  baseDir = '',
  onSuccess,
}: MoveFileDialogProps) {
  const { t } = useTranslation()
  const [targetDir, setTargetDir] = useState('')
  const [targetFileName, setTargetFileName] = useState('')
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    if (open && sourcePath) {
      const pathParts = sourcePath.split('/')
      const fileName = pathParts[pathParts.length - 1]
      const dirPath = pathParts.slice(0, -1).join('/')
      
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Initialize editable target fields from the selected source path.
      setTargetDir(dirPath || './')
      setTargetFileName(fileName)
    }
  }, [open, sourcePath])

  const handleMove = async () => {
    if (!sourcePath || !targetFileName.trim() || !envid) {
      toast.error(t("consoleFiles.toast.fullInfoRequired"))
      return
    }

    const fullSourcePath = normalizePath(baseDir + '/' + sourcePath)
    const fullTargetPath = normalizePath(baseDir + '/' + targetDir + '/' + targetFileName.trim())
    
    setMoving(true)
    await apiRequest('v1UsersFilesMoveUpdate', {
        id: envid,
        source: fullSourcePath,
        target: fullTargetPath
      }, [], (resp) => {
        if (resp.code === 0) {
          toast.success(t("consoleFiles.toast.fileMoved", { name: targetFileName.trim() }))
          onOpenChange(false)
          if (onSuccess) {
            onSuccess()
          }
        } else {
          toast.error(t("consoleFiles.toast.moveFailed", { message: resp.message }));
        }
      })
    setMoving(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleFiles.actions.moveFile")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel>{t("consoleFiles.labels.sourcePath")}</FieldLabel>
            <Input
              value={sourcePath}
              readOnly
              className="bg-muted"
            />
          </Field>
          <Field>
            <FieldLabel>{t("consoleFiles.labels.targetDirectory")}</FieldLabel>
            <Input
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel>{t("consoleFiles.labels.newFileName")}</FieldLabel>
            <Input
              value={targetFileName}
              onChange={(e) => setTargetFileName(e.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t("consoleFiles.actions.cancel")}
          </Button>
          <Button onClick={handleMove} disabled={!sourcePath || !targetDir.trim() || !targetFileName.trim() || moving}>
            {moving && <Spinner />}
            {t("consoleFiles.actions.confirmMove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
