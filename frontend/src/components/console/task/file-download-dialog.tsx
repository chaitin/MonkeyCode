import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { downloadFile, type DownloadFileProgress } from "@/utils/common"
import { IconDownload } from "@tabler/icons-react"
import { toast } from "sonner"

type DownloadDialogStatus = "idle" | "downloading" | "completed" | "failed" | "canceled"

interface FileDownloadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  envid: string
  filePath: string
  displayPath: string
  downloadFilename: string
  fileName: string
  fileType: string
  fileHandle?: FileSystemFileHandle | null
}

const INITIAL_PROGRESS: DownloadFileProgress = {
  loaded: 0,
  total: null,
  percent: null,
}

const INDETERMINATE_PROGRESS_ANIMATION = `
@keyframes file-download-indeterminate {
  0% {
    transform: translateX(-130%);
  }
  100% {
    transform: translateX(260%);
  }
}
`

function formatDownloadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B"
  }

  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

export function FileDownloadDialog({
  open,
  onOpenChange,
  envid,
  filePath,
  displayPath,
  downloadFilename,
  fileName,
  fileType,
  fileHandle,
}: FileDownloadDialogProps) {
  const [status, setStatus] = useState<DownloadDialogStatus>("idle")
  const [progress, setProgress] = useState<DownloadFileProgress>(INITIAL_PROGRESS)
  const [errorMessage, setErrorMessage] = useState("")
  const abortControllerRef = useRef<AbortController | null>(null)
  const cancelRequestedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      abortControllerRef.current = null
      cancelRequestedRef.current = false
      setStatus("idle")
      setProgress(INITIAL_PROGRESS)
      setErrorMessage("")
      return
    }

    const controller = new AbortController()
    let active = true
    abortControllerRef.current = controller
    cancelRequestedRef.current = false

    setStatus("downloading")
    setProgress(INITIAL_PROGRESS)
    setErrorMessage("")

    void (async () => {
      try {
        const writable = fileHandle ? await fileHandle.createWritable() : undefined

        await downloadFile(
          envid,
          filePath,
          downloadFilename,
          (nextProgress) => {
            if (!active) {
              return
            }
            setProgress(nextProgress)
          },
          controller.signal,
          writable,
        )

        if (!active || cancelRequestedRef.current) {
          return
        }

        setProgress((prev) => ({
          ...prev,
          percent: prev.total && prev.total > 0 ? 100 : prev.percent,
        }))
        setStatus("completed")
        toast.success(`已下载${fileType} "${fileName}"`)
      } catch (error) {
        if (!active) {
          return
        }

        if (cancelRequestedRef.current || controller.signal.aborted) {
          setStatus("canceled")
          return
        }

        const message = error instanceof Error ? error.message : "未知错误"
        setErrorMessage(message)
        setStatus("failed")
        toast.error(`下载失败：${message}`)
      }
    })()

    return () => {
      active = false
      abortControllerRef.current = null
      controller.abort()
    }
  }, [open, envid, filePath, downloadFilename, fileName, fileType, fileHandle])

  const isDownloading = status === "downloading"
  const progressText = status === "completed"
    ? `已接收 ${formatDownloadBytes(progress.loaded)}`
    : status === "failed"
      ? `已接收 ${formatDownloadBytes(progress.loaded)}`
      : status === "canceled"
        ? `已接收 ${formatDownloadBytes(progress.loaded)}`
        : progress.loaded > 0
          ? `已接收 ${formatDownloadBytes(progress.loaded)}`
          : "正在建立下载流"

  const handleCancelDownload = () => {
    if (!isDownloading) {
      return
    }

    cancelRequestedRef.current = true
    abortControllerRef.current?.abort()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isDownloading) {
      return
    }

    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <style>{INDETERMINATE_PROGRESS_ANIMATION}</style>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!isDownloading}
        onEscapeKeyDown={(e) => {
          if (isDownloading) {
            e.preventDefault()
          }
        }}
        onInteractOutside={(e) => {
          if (isDownloading) {
            e.preventDefault()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {status === "completed"
              ? "下载完成"
              : status === "failed"
                ? "下载失败"
                : status === "canceled"
                  ? "下载已取消"
                  : "正在下载"}
          </DialogTitle>
          <DialogDescription>
            {status === "failed"
              ? "下载过程中出现错误，请查看详细信息。"
              : status === "canceled"
                ? "下载已被手动取消。"
              : `正在下载${fileType} "${displayPath}"`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background text-primary">
              {status === "downloading" ? (
                <Spinner className="size-5" />
              ) : (
                <IconDownload className="size-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{downloadFilename}</div>
              <div className="truncate text-xs text-muted-foreground">{displayPath}</div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
              {isDownloading ? (
                <div
                  className="absolute inset-y-0 w-2/5 rounded-full bg-linear-to-r from-primary/70 via-primary to-primary/70"
                  style={{ animation: "file-download-indeterminate 1s cubic-bezier(0.4, 0, 0.2, 1) infinite" }}
                />
              ) : (
                <div className="absolute inset-y-0 left-0 w-full rounded-full bg-primary/85" />
              )}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{progressText}</span>
              <span>
                {status === "completed"
                  ? "已完成"
                  : status === "canceled"
                    ? "已取消"
                  : status === "failed"
                    ? "已失败"
                    : "传输中"}
              </span>
            </div>
          </div>

          {status === "failed" && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {errorMessage || "未知错误"}
            </div>
          )}

          {isDownloading && (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={handleCancelDownload}>
                取消下载
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
