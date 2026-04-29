import { Api } from "@/api/Api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { IconFile, IconTrash, IconUpload } from "@tabler/icons-react"
import React from "react"
import { toast } from "sonner"
import { isTaskImageAttachment } from "./task-shared"

export interface TaskUploadedFile {
  name: string
  size: number
  type: string
  accessUrl: string
}

interface TaskFileUploadDialogProps {
  open: boolean
  file: File | null
  onOpenChange: (open: boolean) => void
  onUploaded: (file: TaskUploadedFile) => void
}

interface TaskUploadedFileItemProps {
  file: TaskUploadedFile
  onRemove: () => void
  className?: string
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function TaskFileUploadDialog({ open, file, onOpenChange, onUploaded }: TaskFileUploadDialogProps) {
  const [uploading, setUploading] = React.useState(false)
  const [filePreviewUrl, setFilePreviewUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setUploading(false)
    }
  }, [open])

  React.useEffect(() => {
    if (!open || !file || !isTaskImageAttachment(file.name)) {
      setFilePreviewUrl(null)
      return
    }

    const nextPreviewUrl = URL.createObjectURL(file)
    setFilePreviewUrl(nextPreviewUrl)
    return () => URL.revokeObjectURL(nextPreviewUrl)
  }, [file, open])

  const handleUpload = React.useCallback(async () => {
    if (!file || uploading) return

    setUploading(true)
    try {
      const api = new Api()
      const presignResponse = await api.api.v1UploaderPresignCreate({
        filename: file.name,
      })

      if (presignResponse.data?.code !== 0 || !presignResponse.data?.data) {
        toast.error("获取上传地址失败: " + (presignResponse.data?.message || "未知错误"))
        return
      }

      const { upload_url, access_url } = presignResponse.data.data
      if (!upload_url || !access_url) {
        toast.error("获取上传地址失败: 返回数据不完整")
        return
      }

      const uploadResponse = await fetch(upload_url, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      })

      if (!uploadResponse.ok) {
        toast.error("文件上传失败: " + uploadResponse.statusText)
        return
      }

      onUploaded({
        name: file.name,
        size: file.size,
        type: file.type,
        accessUrl: access_url,
      })
      toast.success("文件上传成功")
      onOpenChange(false)
    } catch (error) {
      toast.error("上传失败: " + (error as Error).message)
    } finally {
      setUploading(false)
    }
  }, [file, onOpenChange, onUploaded, uploading])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (uploading) return
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>上传文件</DialogTitle>
          <DialogDescription>
            确认文件信息后开始上传。
          </DialogDescription>
        </DialogHeader>

        {file && (
          <div className="flex items-start gap-3 rounded-md border bg-muted/25 p-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background text-muted-foreground">
              {filePreviewUrl ? (
                <img src={filePreviewUrl} alt={file.name} className="size-full object-cover" />
              ) : (
                <IconFile className="size-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{file.name}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{formatFileSize(file.size)}</span>
                <span>{file.type || "未知类型"}</span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={!file || uploading}
            onClick={handleUpload}
          >
            {uploading ? <Spinner className="size-4" /> : <IconUpload className="size-4" />}
            上传
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TaskUploadedFileItem({ file, onRemove, className }: TaskUploadedFileItemProps) {
  return (
    <div
      className={cn(
        "group flex h-8 min-w-0 max-w-32 items-center gap-2 rounded-full border bg-background px-2 text-xs text-foreground shadow-xs",
        className
      )}
      title={file.name}
    >
      {isTaskImageAttachment(file.name) ? (
        <img src={file.accessUrl} alt={file.name} className="size-4 shrink-0 rounded-full border object-cover" />
      ) : (
        <IconFile className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <button
        type="button"
        className="hidden size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
        onClick={onRemove}
        aria-label="删除已上传文件"
      >
        <IconTrash className="size-3.5" />
      </button>
    </div>
  )
}
