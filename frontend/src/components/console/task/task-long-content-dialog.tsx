import { useTranslation } from "react-i18next"

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { MAX_TASK_UPLOAD_FILE_SIZE_LABEL } from "./task-file-upload"

interface TaskLongContentDialogProps {
  open: boolean
  characterCount: number
  filename: string
  converting: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

export function TaskLongContentDialog({
  open,
  characterCount,
  filename,
  converting,
  onOpenChange,
  onConfirm,
}: TaskLongContentDialogProps) {
  const { t } = useTranslation()

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (converting) return
        onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("taskDetail.chat.longContent.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("taskDetail.chat.longContent.description", { count: characterCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="break-all">{t("taskDetail.chat.longContent.filename", { filename })}</div>
          <div className="text-xs text-muted-foreground">
            {t("taskDetail.chat.longContent.fileLimit", { size: MAX_TASK_UPLOAD_FILE_SIZE_LABEL })}
          </div>
        </div>
        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            autoFocus
            disabled={converting}
            onClick={() => onOpenChange(false)}
          >
            {t("taskDetail.common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={converting}
            onClick={() => void onConfirm()}
          >
            {converting
              ? t("taskDetail.chat.longContent.converting")
              : t("taskDetail.chat.longContent.convert")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
