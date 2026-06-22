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

interface CopyFileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourcePath: string
  envid: string
  baseDir?: string
  onSuccess?: () => void
}

const generateNewFileName = (fileName: string): string => {
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex > 0) {
    const nameWithoutExt = fileName.substring(0, lastDotIndex)
    const ext = fileName.substring(lastDotIndex)
    return nameWithoutExt + '_new' + ext
  } else {
    return fileName + '_new'
  }
}

export default function CopyFileDialog({
  open,
  onOpenChange,
  sourcePath,
  envid,
  baseDir = '',
  onSuccess,
}: CopyFileDialogProps) {
  const { t } = useTranslation()
  const [targetDir, setTargetDir] = useState('')
  const [targetFileName, setTargetFileName] = useState('')
  const [copying, setCopying] = useState(false)

  useEffect(() => {
    if (open && sourcePath) {
      const pathParts = sourcePath.split('/')
      const fileName = pathParts[pathParts.length - 1]
      const dirPath = pathParts.slice(0, -1).join('/')


      setTargetDir(dirPath || './')
      setTargetFileName(generateNewFileName(fileName))
    }
  }, [open, sourcePath])

  const handleCopy = async () => {
    if (!sourcePath || !targetFileName.trim() || !envid) {
      toast.error(t("consoleFiles.toast.fullInfoRequired"))
      return
    }

    const fullSourcePath = normalizePath(baseDir + '/' + sourcePath)
    const fullTargetPath = normalizePath(baseDir + '/' + targetDir + '/' + targetFileName.trim())

    setCopying(true)
    await apiRequest('v1UsersFilesCopyCreate', {
      id: envid,
      source: fullSourcePath,
      target: fullTargetPath
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleFiles.toast.fileCopied", { name: targetFileName.trim() }))
        onOpenChange(false)
        if (onSuccess) {
          onSuccess()
        }
      } else {
        toast.error(t("consoleFiles.toast.copyFailed", { message: resp.message }));
      }
    })
    setCopying(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleFiles.actions.copyFile")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel>{t("consoleFiles.labels.sourcePath")}</FieldLabel>
            <Input
              value={sourcePath || './'}
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
          <Button onClick={handleCopy} disabled={!sourcePath || !targetDir.trim() || !targetFileName.trim() || copying}>
            {copying && <Spinner />}
            {t("consoleFiles.actions.confirmCopy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
