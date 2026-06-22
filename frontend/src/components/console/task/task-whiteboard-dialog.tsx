import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import React from "react"
import { toast } from "sonner"
import type { TldrawProps } from "tldraw"
import { uploadTaskFile, type TaskUploadedFile } from "./task-file-upload"
import { useTranslation } from "react-i18next"

const TaskWhiteboardCanvas = React.lazy(() => import("./task-whiteboard-canvas"))
type TldrawEditor = Parameters<NonNullable<TldrawProps["onMount"]>>[0]

interface TaskWhiteboardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  persistenceKey: string
  fileName: string
  canUploadAttachment: boolean
  onUploaded: (file: TaskUploadedFile) => void
}

export function TaskWhiteboardDialog({
  open,
  onOpenChange,
  persistenceKey,
  fileName,
  canUploadAttachment,
  onUploaded,
}: TaskWhiteboardDialogProps) {
  const { t } = useTranslation()
  const [submitting, setSubmitting] = React.useState(false)
  const [resetDialogOpen, setResetDialogOpen] = React.useState(false)
  const editorRef = React.useRef<TldrawEditor | null>(null)

  const handleSubmit = React.useCallback(async () => {
    if (submitting) return
    if (!canUploadAttachment) {
      toast.error(t("taskDetail.whiteboard.maxFiles"))
      return
    }

    const editor = editorRef.current
    if (!editor) {
      toast.error(t("taskDetail.whiteboard.notReady"))
      return
    }

    const shapes = editor.getCurrentPageShapes()
    if (shapes.length === 0) {
      toast.error(t("taskDetail.whiteboard.empty"))
      return
    }

    setSubmitting(true)
    try {
      const { blob } = await editor.toImage(shapes, {
        format: "png",
        background: true,
        padding: 32,
        pixelRatio: 2,
      })
      const file = new File([blob], fileName, {
        type: "image/png",
      })
      const uploadedFile = await uploadTaskFile(file)
      onUploaded(uploadedFile)
      onOpenChange(false)
      toast.success(t("taskDetail.whiteboard.uploaded"))
    } catch (error) {
      toast.error((error as Error).message || t("taskDetail.whiteboard.uploadFailed"))
    } finally {
      setSubmitting(false)
    }
  }, [canUploadAttachment, fileName, onOpenChange, onUploaded, submitting, t])

  const handleReset = React.useCallback(() => {
    const editor = editorRef.current
    if (!editor) {
      toast.error(t("taskDetail.whiteboard.notReady"))
      return
    }

    const shapes = editor.getCurrentPageShapes()
    if (shapes.length > 0) {
      editor.deleteShapes(shapes)
    }
    editor.clearHistory()
    setResetDialogOpen(false)
    toast.success(t("taskDetail.whiteboard.cleared"))
  }, [t])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (submitting) return
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent showCloseButton={false} className="flex h-[80vh] max-h-none w-full !max-w-[80vw] flex-col gap-3 overflow-hidden">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-background">
          <React.Suspense
            fallback={(
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Spinner className="size-5" />
              </div>
            )}
          >
            <TaskWhiteboardCanvas
              persistenceKey={persistenceKey}
              onMount={(editor) => {
                editorRef.current = editor
              }}
            />
          </React.Suspense>
        </div>
        <DialogFooter className="shrink-0">
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={submitting}>
              {t("taskDetail.whiteboard.close")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => setResetDialogOpen(true)}
          >
            {t("taskDetail.whiteboard.clear")}
          </Button>
          <Button
            type="button"
            disabled={submitting}
            onClick={() => {
              void handleSubmit()
            }}
          >
            {submitting && <Spinner className="size-4" />}
            {t("taskDetail.whiteboard.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
      <AlertDialog
        open={resetDialogOpen}
        onOpenChange={(nextOpen) => {
          if (submitting) return
          setResetDialogOpen(nextOpen)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("taskDetail.whiteboard.clearTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("taskDetail.whiteboard.clearDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>{t("taskDetail.common.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={submitting}
              onClick={handleReset}
            >
              {t("taskDetail.whiteboard.confirmClear")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
