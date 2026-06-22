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
import { useTranslation } from "react-i18next"

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
  const { t } = useTranslation()
  const isImage = file ? isTaskImageAttachment(file.name) : false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("taskDetail.attachment.title")}</DialogTitle>
          <DialogDescription className="truncate" title={file?.name}>
            {file?.name || t("taskDetail.attachment.noneSelected")}
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
                    <FileDetailRow label={t("taskDetail.attachment.fileName")} value={file.name} />
                    <FileDetailRow label={t("taskDetail.attachment.size")} value={typeof file.size === "number" ? formatFileSize(file.size) : t("taskDetail.common.unknown")} />
                    <FileDetailRow label={t("taskDetail.attachment.type")} value={file.type || t("taskDetail.attachment.unknownType")} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("taskDetail.common.close")}
          </Button>
          {file && (
            <Button type="button" asChild>
              <a href={file.accessUrl} download={file.name}>
                <IconDownload className="size-4" />
                {t("taskDetail.attachment.download")}
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
