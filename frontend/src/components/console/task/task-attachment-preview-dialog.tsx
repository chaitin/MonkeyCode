import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { IconDownload, IconFile } from "@tabler/icons-react"
import { isTaskImageAttachment } from "./task-shared"
import { formatFileSize } from "./task-file-upload"

export interface TaskAttachmentPreviewFile {
  name: string
  accessUrl: string
  size?: number
  type?: string
}

interface TaskAttachmentPreviewDialogProps {
  open: boolean
  file: TaskAttachmentPreviewFile | null
  onOpenChange: (open: boolean) => void
}

function FileDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 border-b py-2 last:border-b-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 break-all text-foreground">{value}</div>
    </div>
  )
}

export function TaskAttachmentPreviewDialog({ open, file, onOpenChange }: TaskAttachmentPreviewDialogProps) {
  const isImage = file ? isTaskImageAttachment(file.name) : false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>附件预览</DialogTitle>
          <DialogDescription className="truncate" title={file?.name}>
            {file?.name || "未选择附件"}
          </DialogDescription>
        </DialogHeader>

        {file && (
          <div className="min-h-0 overflow-auto">
            {isImage ? (
              <div className="flex min-h-64 items-center justify-center overflow-hidden rounded-md border bg-muted/25">
                <img
                  src={file.accessUrl}
                  alt={file.name}
                  className="max-h-[58vh] max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex min-w-0 items-start gap-3 rounded-md border bg-muted/25 p-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
                  <IconFile className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" title={file.name}>{file.name}</div>
                  <div className="mt-3 text-sm">
                    <FileDetailRow label="文件名" value={file.name} />
                    <FileDetailRow label="大小" value={typeof file.size === "number" ? formatFileSize(file.size) : "未知"} />
                    <FileDetailRow label="类型" value={file.type || "未知类型"} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          {file && (
            <Button type="button" asChild>
              <a href={file.accessUrl} download={file.name}>
                <IconDownload className="size-4" />
                下载附件
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
