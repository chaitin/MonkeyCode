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
import { uploadFileWithPresignedUrl } from "@/utils/common"
import { IconFile, IconTrash, IconUpload } from "@tabler/icons-react"
import React from "react"
import { toast } from "sonner"
import { isTaskImageAttachment } from "./task-shared"
import { useTranslation } from "react-i18next"

const IMAGE_COMPRESS_MIN_SIZE_BYTES = 200 * 1024
const IMAGE_COMPRESS_QUALITY = 0.6
const IMAGE_COMPRESS_OUTPUT_TYPE = "image/webp"
const IMAGE_COMPRESS_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/avif",
])
const IMAGE_COMPRESS_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "bmp",
  "avif",
])

export const MAX_TASK_UPLOAD_FILE_SIZE_BYTES = 2 * 1024 * 1024
export const MAX_TASK_UPLOAD_FILE_SIZE_LABEL = "2MB"

export interface TaskUploadedFile {
  name: string
  size: number
  type: string
  accessUrl: string
}

export class TaskUploadFileTooLargeError extends Error {
  constructor() {
    super("Task upload file is too large")
    this.name = "TaskUploadFileTooLargeError"
  }
}

const replaceFileExtension = (filename: string, extension: string) => {
  const extensionIndex = filename.lastIndexOf(".")
  if (extensionIndex <= 0) {
    return `${filename}.${extension}`
  }

  return `${filename.slice(0, extensionIndex)}.${extension}`
}

const loadImageFromFile = (file: File) => {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error("Failed to load image"))
    }
    image.src = objectUrl
  })
}

const canvasToCompressedBlob = (canvas: HTMLCanvasElement) => {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      resolve,
      IMAGE_COMPRESS_OUTPUT_TYPE,
      IMAGE_COMPRESS_QUALITY,
    )
  })
}

export const isCompressibleImageFile = (file: File) => {
  if (IMAGE_COMPRESS_TYPES.has(file.type.toLowerCase())) {
    return true
  }

  const extensionMatch = file.name.match(/\.([^./\\]+)$/)
  return !!extensionMatch && IMAGE_COMPRESS_EXTENSIONS.has(extensionMatch[1].toLowerCase())
}

const compressImageFileIfNeeded = async (file: File) => {
  if (file.size < IMAGE_COMPRESS_MIN_SIZE_BYTES) {
    return file
  }

  if (!isCompressibleImageFile(file)) {
    return file
  }

  if (
    typeof document === "undefined"
    || typeof Image === "undefined"
    || typeof URL === "undefined"
    || typeof URL.createObjectURL !== "function"
    || typeof URL.revokeObjectURL !== "function"
  ) {
    return file
  }

  try {
    const image = await loadImageFromFile(file)
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    if (width <= 0 || height <= 0) {
      return file
    }

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext("2d")
    if (!context) {
      return file
    }

    context.drawImage(image, 0, 0, width, height)
    const compressedBlob = await canvasToCompressedBlob(canvas)
    if (!compressedBlob || compressedBlob.type !== IMAGE_COMPRESS_OUTPUT_TYPE) {
      return file
    }

    const compressedFile = new File(
      [compressedBlob],
      replaceFileExtension(file.name, "webp"),
      {
        type: IMAGE_COMPRESS_OUTPUT_TYPE,
        lastModified: file.lastModified,
      },
    )

    if (compressedFile.size >= file.size) {
      return file
    }

    return compressedFile
  } catch {
    return file
  }
}

export async function uploadTaskFile(file: File): Promise<TaskUploadedFile> {
  const uploadFile = await compressImageFileIfNeeded(file)
  if (uploadFile.size > MAX_TASK_UPLOAD_FILE_SIZE_BYTES) {
    throw new TaskUploadFileTooLargeError()
  }

  const uploadedFile = await uploadFileWithPresignedUrl(uploadFile)

  return {
    name: uploadFile.name,
    size: uploadFile.size,
    type: uploadFile.type,
    accessUrl: uploadedFile.accessUrl,
  }
}

interface TaskFileUploadDialogProps {
  open: boolean
  file: File | null
  autoUpload?: boolean
  onOpenChange: (open: boolean) => void
  onUploaded: (file: TaskUploadedFile) => void
}

interface TaskUploadedFileItemProps {
  file: TaskUploadedFile
  onRemove: () => void
  onPreview?: () => void
  className?: string
  disabled?: boolean
}

export function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function TaskFileUploadDialog({ open, file, autoUpload = false, onOpenChange, onUploaded }: TaskFileUploadDialogProps) {
  const { t } = useTranslation()
  const [uploading, setUploading] = React.useState(false)
  const [filePreviewUrl, setFilePreviewUrl] = React.useState<string | null>(null)
  const autoUploadStartedRef = React.useRef(false)

  React.useEffect(() => {
    if (!open) {
      setUploading(false)
      autoUploadStartedRef.current = false
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
      const uploadedFile = await uploadTaskFile(file)
      onUploaded(uploadedFile)
      toast.success(t("taskDetail.upload.success"))
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof TaskUploadFileTooLargeError
        ? t("taskDetail.chat.toast.fileTooLarge", { size: MAX_TASK_UPLOAD_FILE_SIZE_LABEL })
        : (error as Error).message
      toast.error(message)
    } finally {
      setUploading(false)
    }
  }, [file, onOpenChange, onUploaded, uploading, t])

  React.useEffect(() => {
    if (!open || !file || !autoUpload || uploading || autoUploadStartedRef.current) {
      return
    }

    autoUploadStartedRef.current = true
    void handleUpload()
  }, [autoUpload, file, handleUpload, open, uploading])

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
          <DialogTitle>{t("taskDetail.upload.title")}</DialogTitle>
          <DialogDescription>
            {t("taskDetail.upload.description")}
          </DialogDescription>
        </DialogHeader>

        {file && (
          <div className="flex min-w-0 items-start gap-3 rounded-md border bg-muted/25 p-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background text-muted-foreground">
              {filePreviewUrl ? (
                <img src={filePreviewUrl} alt={file.name} className="size-full object-cover" />
              ) : (
                <IconFile className="size-5" />
              )}
            </div>
            <div className="w-0 min-w-0 flex-1">
              <div className="max-w-full truncate text-sm font-medium" title={file.name}>{file.name}</div>
              <div className="mt-1 flex max-w-full flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{formatFileSize(file.size)}</span>
                <span>{file.type || t("taskDetail.upload.unknownType")}</span>
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
            {t("taskDetail.common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!file || uploading}
            onClick={handleUpload}
          >
            {uploading ? <Spinner className="size-4" /> : <IconUpload className="size-4" />}
            {t("taskDetail.upload.upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TaskUploadedFileItem({ file, onRemove, onPreview, className, disabled = false }: TaskUploadedFileItemProps) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        "group/uploaded-file flex h-8 w-32 min-w-0 items-center gap-2 rounded-full border bg-background px-2 text-xs text-foreground shadow-xs",
        disabled && "opacity-70",
        className
      )}
      title={file.name}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left disabled:cursor-not-allowed"
        disabled={disabled}
        onClick={disabled ? undefined : onPreview}
        aria-label={t("taskDetail.upload.previewAria", { fileName: file.name })}
      >
        {isTaskImageAttachment(file.name) ? (
          <img src={file.accessUrl} alt={file.name} className="size-4 shrink-0 rounded-full border object-cover" />
        ) : (
          <IconFile className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate group-hover/uploaded-file:text-primary">{file.name}</span>
      </button>
      <button
        type="button"
        className={cn(
          "hidden size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
          !disabled && "group-hover/uploaded-file:flex"
        )}
        disabled={disabled}
        onClick={onRemove}
        aria-label={t("taskDetail.upload.removeAria")}
      >
        <IconTrash className="size-3.5" />
      </button>
    </div>
  )
}
