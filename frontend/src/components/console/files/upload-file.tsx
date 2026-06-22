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

interface UploadFileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetDir: string
  envid: string
  baseDir?: string
  onSuccess?: () => void
}

const MAX_UPLOAD_FILE_SIZE = 10 * 1024 * 1024

export default function UploadFileDialog({
  open,
  onOpenChange,
  targetDir,
  envid,
  baseDir = '',
  onSuccess,
}: UploadFileDialogProps) {
  const { t } = useTranslation()
  const [fileName, setFileName] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset controlled dialog fields whenever the parent opens it.
      setFileName('')
      setUploadFile(null)
    }
  }, [open])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    if (file && file.size > MAX_UPLOAD_FILE_SIZE) {
      toast.error(t("consoleFiles.toast.uploadTooLarge"))
      e.target.value = ''
      setUploadFile(null)
      setFileName('')
      return
    }
    setUploadFile(file)
    setFileName(file?.name || '')
  }

  const handleUpload = async () => {
    if (!uploadFile || !envid) {
      toast.error(t("consoleFiles.toast.uploadRequired"))
      return
    }

    if (!fileName.trim()) {
      toast.error(t("consoleFiles.toast.fileNameRequired"))
      return
    }

    if (uploadFile.size > MAX_UPLOAD_FILE_SIZE) {
      toast.error(t("consoleFiles.toast.uploadTooLarge"))
      return
    }

    const filePath = normalizePath(baseDir + '/' + targetDir + '/' + fileName.trim())
    
    setUploading(true)
    await apiRequest('v1UsersFilesUploadCreate', {
      id: envid,
      path: filePath
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleFiles.toast.uploaded", { name: fileName.trim() }))
        onOpenChange(false)
        if (onSuccess) {
          onSuccess()
        }
      } else {
        toast.error(t("consoleFiles.toast.uploadFailed", { message: resp.message }));
      }
    }, undefined, {
      file: uploadFile
    })
    setUploading(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleFiles.actions.uploadFile")}</DialogTitle>
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
            <FieldLabel>{t("consoleFiles.labels.newFileName")}</FieldLabel>
            <Input
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel>{t("consoleFiles.labels.selectFile")}</FieldLabel>
            <Input
              type="file"
              onChange={handleFileChange}
            />
          </Field>
          {uploadFile && (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("consoleFiles.labels.selectedFile", { name: uploadFile.name, size: (uploadFile.size / 1024).toFixed(2) })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t("consoleFiles.actions.cancel")}
          </Button>
          <Button onClick={handleUpload} disabled={!uploadFile || !fileName.trim() || uploading}>
            {uploading && <Spinner />}
            {t("consoleFiles.actions.upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
