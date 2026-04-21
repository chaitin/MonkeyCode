import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { normalizePath } from "@/utils/common"

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
  const [fileName, setFileName] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (open) {
      setFileName('')
      setUploadFile(null)
    }
  }, [open])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    if (file && file.size > MAX_UPLOAD_FILE_SIZE) {
      toast.error('文件大小不能超过 10MB')
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
      toast.error('请选择要上传的文件')
      return
    }

    if (!fileName.trim()) {
      toast.error('请输入文件名称')
      return
    }

    if (uploadFile.size > MAX_UPLOAD_FILE_SIZE) {
      toast.error('文件大小不能超过 10MB')
      return
    }

    const filePath = normalizePath(baseDir + '/' + targetDir + '/' + fileName.trim())
    
    setUploading(true)
    await apiRequest('v1UsersFilesUploadCreate', {
      id: envid,
      path: filePath
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(`已上传文件 "${fileName.trim()}"`)
        onOpenChange(false)
        if (onSuccess) {
          onSuccess()
        }
      } else {
        toast.error("上传文件失败: " + resp.message);
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
          <DialogTitle>上传文件</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel>目标目录</FieldLabel>
            <Input
              value={targetDir || './'}
              readOnly
              className="bg-muted"
            />
          </Field>
          <Field>
            <FieldLabel>新文件名称</FieldLabel>
            <Input
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel>选择文件</FieldLabel>
            <Input
              type="file"
              onChange={handleFileChange}
            />
          </Field>
          {uploadFile && (
            <p className="mt-2 text-sm text-muted-foreground">
              已选择: {uploadFile.name} ({(uploadFile.size / 1024).toFixed(2)} KB)
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={handleUpload} disabled={!uploadFile || !fileName.trim() || uploading}>
            {uploading && <Spinner />}
            上传
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
