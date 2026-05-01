import { useState, useRef } from "react"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { IconCommand, IconLoader, IconPalette, IconReload, IconTrash, IconPlayerStopFilled, IconSend, IconTerminal2, IconUpload } from "@tabler/icons-react"
import React from "react"
import { VoiceInputButton } from "./voice-input-button"
import type { TaskMessageHandlerStatus } from "@/components/console/task/task-message-handler"
import type { AvailableCommand, AvailableCommands, TaskStreamStatus, TaskUserInput, TaskUserInputPayload } from "./task-shared"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { TaskFileUploadDialog, TaskUploadedFileItem, type TaskUploadedFile } from "./task-file-upload"
import { toast } from "sonner"
import { TaskWhiteboardDialog } from "./task-whiteboard-dialog"
import { TaskAttachmentPreviewDialog } from "./task-attachment-preview-dialog"

const MAX_UPLOAD_FILE_SIZE = 2 * 1024 * 1024
const MAX_UPLOADED_FILES = 3
const PASTED_IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
}

interface TaskChatInputBoxProps {
  streamStatus: TaskStreamStatus | TaskMessageHandlerStatus
  availableCommands: AvailableCommands | null
  onSend: (input: TaskUserInput) => Promise<boolean> | boolean | void
  sending: boolean
  queueSize: number
  executionTimeMs?: number
  onCancel?: () => void
  onRequestRestartAgent?: (clearContext: boolean) => void
  whiteboardPersistenceKey?: string
}

export const TaskChatInputBox = ({ streamStatus, availableCommands, onSend, sending, queueSize, executionTimeMs = 0, onCancel, onRequestRestartAgent, whiteboardPersistenceKey = "task-whiteboard" }: TaskChatInputBoxProps) => {
  const [content, setContent] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null)
  const [shouldAutoUpload, setShouldAutoUpload] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)
  const [whiteboardDialogOpen, setWhiteboardDialogOpen] = useState(false)
  const [whiteboardFileIndex, setWhiteboardFileIndex] = useState(1)
  const [previewFile, setPreviewFile] = useState<TaskUploadedFile | null>(null)
  const [uploadedFiles, setUploadedFiles] = useState<TaskUploadedFile[]>([])
  const [slashCommandConfirmOpen, setSlashCommandConfirmOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const isExecuting = (streamStatus === 'connected' || streamStatus === 'inited')
  const canInput = React.useMemo(() => {
    return !sending && !isExecuting && queueSize === 0
  }, [sending, isExecuting, queueSize])

  const sendCurrentInput = async () => {
    if (content.trim() === '') {
      return
    }

    const payload: TaskUserInputPayload = {
      content,
      attachments: uploadedFiles.map((file) => ({
        url: file.accessUrl,
        filename: file.name,
      })),
    }
    const result = await onSend(payload)
    if (result === false) {
      return
    }

    setContent('')
    setUploadedFiles([])
    setPreviewFile(null)
    setWhiteboardFileIndex(1)
  }

  const handleSend = () => {
    if (content.trim() === '') {
      return
    }

    if (content.startsWith('/')) {
      setSlashCommandConfirmOpen(true)
      return
    }

    void sendCurrentInput()
  }

  const handleTextRecognized = (text: string) => {
    setContent(text)
  }

  const handleSelectFile = () => {
    if (!canInput) return
    if (uploadedFiles.length >= MAX_UPLOADED_FILES) return
    setShouldAutoUpload(false)
    fileInputRef.current?.click()
  }

  const hasFileExtension = (filename: string) => /\.[^./\\]+$/.test(filename)

  const createPastedImageName = (file: File) => {
    const extension = PASTED_IMAGE_EXTENSION_BY_TYPE[file.type]
    if (!extension) {
      return null
    }
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
    return `pasted-image-${timestamp}.${extension}`
  }

  const normalizeUploadFile = (file: File) => {
    if (file.name && hasFileExtension(file.name)) {
      return file
    }

    const pastedImageName = createPastedImageName(file)
    if (!pastedImageName) {
      return file
    }

    try {
      return new File([file], pastedImageName, {
        type: file.type,
        lastModified: file.lastModified,
      })
    } catch {
      return file
    }
  }

  const prepareUploadFile = (file: File, options?: { autoUpload?: boolean }) => {
    if (!canInput) {
      return
    }

    if (uploadedFiles.length >= MAX_UPLOADED_FILES) {
      toast.error(`最多只能上传 ${MAX_UPLOADED_FILES} 个文件`)
      return
    }

    const normalizedFile = normalizeUploadFile(file)

    if (normalizedFile.size === 0) {
      toast.error("不能上传空文件")
      return
    }

    if (normalizedFile.size > MAX_UPLOAD_FILE_SIZE) {
      toast.error("文件大小不能超过 2MB")
      return
    }

    if (!hasFileExtension(normalizedFile.name)) {
      toast.error("不支持上传没有后缀的文件")
      return
    }

    setShouldAutoUpload(!!options?.autoUpload)
    setSelectedUploadFile(normalizedFile)
    setUploadDialogOpen(true)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''

    if (!file) {
      return
    }

    prepareUploadFile(file)
  }

  const handleUploaded = (file: TaskUploadedFile) => {
    setUploadedFiles((prev) => {
      if (prev.length >= MAX_UPLOADED_FILES) {
        return prev
      }
      return [...prev, file]
    })
    setSelectedUploadFile(null)
    setShouldAutoUpload(false)
  }

  const handleWhiteboardUploaded = (file: TaskUploadedFile) => {
    handleUploaded(file)
    setWhiteboardFileIndex((prev) => prev + 1)
  }

  const hasTransferFile = (dataTransfer: DataTransfer) => {
    return Array.from(dataTransfer.types).includes("Files")
  }

  const getDataTransferFiles = (dataTransfer: DataTransfer) => {
    return Array.from(dataTransfer.files).filter((item) => item instanceof File)
  }

  const resetDragState = () => {
    dragDepthRef.current = 0
    setIsDragActive(false)
  }

  const canAcceptUploadFile = () => {
    return canInput && uploadedFiles.length < MAX_UPLOADED_FILES
  }

  const getClipboardFiles = (clipboardData: DataTransfer) => {
    const files = getDataTransferFiles(clipboardData)
    if (files.length > 0) {
      return files
    }

    return Array.from(clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((item): item is File => item !== null)
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = getClipboardFiles(e.clipboardData)
    if (files.length === 0) {
      return
    }

    e.preventDefault()
    if (files.length > 1) {
      toast.info("当前仅支持一次上传 1 个文件")
    }

    prepareUploadFile(files[0], { autoUpload: true })
  }

  React.useEffect(() => {
    const handleWindowDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer || !hasTransferFile(event.dataTransfer)) return

      event.preventDefault()
      dragDepthRef.current += 1
      if (canAcceptUploadFile()) {
        setIsDragActive(true)
      }
    }

    const handleWindowDragOver = (event: DragEvent) => {
      if (!event.dataTransfer || !hasTransferFile(event.dataTransfer)) return

      event.preventDefault()
      event.dataTransfer.dropEffect = canAcceptUploadFile() ? "copy" : "none"
      if (canAcceptUploadFile()) {
        setIsDragActive(true)
      }
    }

    const handleWindowDragLeave = (event: DragEvent) => {
      if (!event.dataTransfer || !hasTransferFile(event.dataTransfer)) return

      dragDepthRef.current = Math.max(dragDepthRef.current - 1, 0)
      const leftWindow = event.clientX <= 0
        || event.clientY <= 0
        || event.clientX >= window.innerWidth
        || event.clientY >= window.innerHeight
      if (dragDepthRef.current === 0 || leftWindow) {
        resetDragState()
      }
    }

    const handleWindowDrop = (event: DragEvent) => {
      if (!event.dataTransfer || !hasTransferFile(event.dataTransfer)) return

      event.preventDefault()
      resetDragState()

      const files = getDataTransferFiles(event.dataTransfer)
      if (files.length === 0) {
        return
      }
      if (files.length > 1) {
        toast.info("当前仅支持一次上传 1 个文件")
      }

      prepareUploadFile(files[0], { autoUpload: true })
    }

    window.addEventListener("dragenter", handleWindowDragEnter)
    window.addEventListener("dragover", handleWindowDragOver)
    window.addEventListener("dragleave", handleWindowDragLeave)
    window.addEventListener("drop", handleWindowDrop)

    return () => {
      window.removeEventListener("dragenter", handleWindowDragEnter)
      window.removeEventListener("dragover", handleWindowDragOver)
      window.removeEventListener("dragleave", handleWindowDragLeave)
      window.removeEventListener("drop", handleWindowDrop)
    }
  })

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isExecuting) {
      return
    }
    // 如果正在输入法组合过程中，不触发提交
    if (isComposing) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 处理输入法组合开始
  const handleCompositionStart = () => {
    setIsComposing(true)
  }

  // 处理输入法组合结束
  const handleCompositionEnd = () => {
    setIsComposing(false)
  }

  const inputDisabled = React.useMemo(() => {
    return !canInput
  }, [canInput])

  const controlsDisabled = React.useMemo(() => {
    return !canInput
  }, [canInput])

  const commandItems = availableCommands?.commands ?? []
  const showCommandItems = !isExecuting && commandItems.length > 0
  const canSend = content.trim() !== ''
  const canUploadMoreFiles = uploadedFiles.length < MAX_UPLOADED_FILES
  const whiteboardFileName = `画板-${whiteboardFileIndex}.png`

  return (
    <div
      className={cn(
        "relative w-full rounded-md border border-transparent transition-colors",
        isDragActive && "border-primary bg-primary/15"
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />
      <InputGroup>
        {!isExecuting && (
          <InputGroupTextarea
            ref={textareaRef}
            className="min-h-8 max-h-48 text-sm break-all"
            placeholder="描述你的需求，Shift+Enter 换行，Enter 发送。"
            value={content}
            onChange={(e) => setContent(e.target.value)} 
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd} />
        )}
        <InputGroupAddon align="block-end" className="pb-1.5">
          <div className="flex flex-row justify-between w-full">
            <div className="flex flex-row gap-2 items-center min-w-0">
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon-sm" className="rounded-full" disabled={controlsDisabled || !showCommandItems}>
                        <IconTerminal2 />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>命令选项</TooltipContent>
                </Tooltip>
                <DropdownMenuContent className={showCommandItems ? "w-[min(90vw,32rem)] min-w-80 max-w-[min(90vw,32rem)]" : "w-48 min-w-48"}>
                  {showCommandItems && (
                    <>
                      <DropdownMenuItem className="flex flex-col items-start gap-1 whitespace-normal" onSelect={() => onRequestRestartAgent?.(false)}>
                        <div className="flex min-w-0 flex-row flex-wrap items-center gap-2">
                          <IconReload />
                          <div className="font-bold text-xs">重启 Agent</div>
                        </div>
                        <div className="max-w-full truncate pl-6 text-xs text-muted-foreground">
                          保留当前上下文，重新启动 Agent 会话。
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem className="flex flex-col items-start gap-1 whitespace-normal" onSelect={() => onRequestRestartAgent?.(true)}>
                        <div className="flex min-w-0 flex-row flex-wrap items-center gap-2">
                          <IconTrash />
                          <div className="font-bold text-xs">重启 Agent 并清空上下文</div>
                        </div>
                        <div className="max-w-full truncate pl-6 text-xs text-muted-foreground">
                          清空当前上下文后，重新启动 Agent 会话。
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {commandItems.map((command: AvailableCommand, index: number) => (
                        <DropdownMenuItem key={index} className="flex flex-col items-start gap-1 whitespace-normal" onClick={() => setContent(`/${command.name}`)}>
                          <div className="flex min-w-0 flex-row flex-wrap items-center gap-2">
                            <IconCommand />
                            <div className="font-bold text-xs">/{command.name}</div>
                            {command.input?.hint && <div className="text-muted-foreground text-xs">[{command.input.hint}]</div>}
                          </div>
                          <div className="max-w-full truncate pl-6 text-xs text-muted-foreground">
                            {command.description}
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {!isExecuting && (
                <>
                  {canUploadMoreFiles && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          className="rounded-full"
                          disabled={controlsDisabled}
                          aria-label="上传附件"
                          onClick={handleSelectFile}
                        >
                          <IconUpload />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>上传附件</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="rounded-full"
                        disabled={controlsDisabled}
                        aria-label="画板"
                        onClick={() => setWhiteboardDialogOpen(true)}
                      >
                        <IconPalette />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>画板</TooltipContent>
                  </Tooltip>
                  {uploadedFiles.map((uploadedFile) => (
                    <TaskUploadedFileItem
                      key={uploadedFile.accessUrl}
                      file={uploadedFile}
                      onPreview={() => setPreviewFile(uploadedFile)}
                      onRemove={() => {
                        if (previewFile?.accessUrl === uploadedFile.accessUrl) {
                          setPreviewFile(null)
                        }
                        setUploadedFiles((prev) => prev.filter((file) => file.accessUrl !== uploadedFile.accessUrl))
                      }}
                    />
                  ))}
                </>
              )}
            </div>
            <div className="flex flex-row gap-2 items-center min-w-0">
              {isExecuting && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                  <IconLoader className="size-4 animate-spin shrink-0" />
                  <span className="truncate">耗时 {(executionTimeMs / 1000).toFixed(1)} 秒</span>
                </div>
              )}
              {!isExecuting && (
                <VoiceInputButton
                  onTextRecognized={handleTextRecognized}
                  disabled={controlsDisabled}
                />
              )}
              <InputGroupButton 
                className={cn("flex flex-row gap-2 items-center", isExecuting && "rounded-full")}
                variant={isExecuting ? "destructive" : "default"}
                size={isExecuting ? "icon-sm" : "sm"} 
                onClick={isExecuting ? onCancel : handleSend}
                disabled={isExecuting ? !onCancel : !canSend || inputDisabled}
              >
                {isExecuting ? <IconPlayerStopFilled /> : <IconSend />}
                {!isExecuting && "发送"}
              </InputGroupButton>
            </div>
          </div>
        </InputGroupAddon>
      </InputGroup>
      <TaskFileUploadDialog
        open={uploadDialogOpen}
        file={selectedUploadFile}
        autoUpload={shouldAutoUpload}
        onOpenChange={(open) => {
          setUploadDialogOpen(open)
          if (!open) {
            setSelectedUploadFile(null)
            setShouldAutoUpload(false)
          }
        }}
        onUploaded={handleUploaded}
      />
      <TaskWhiteboardDialog
        open={whiteboardDialogOpen}
        canUploadAttachment={canUploadMoreFiles}
        fileName={whiteboardFileName}
        onOpenChange={setWhiteboardDialogOpen}
        onUploaded={handleWhiteboardUploaded}
        persistenceKey={whiteboardPersistenceKey}
      />
      <TaskAttachmentPreviewDialog
        open={!!previewFile}
        file={previewFile}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewFile(null)
          }
        }}
      />
      <AlertDialog open={slashCommandConfirmOpen} onOpenChange={setSlashCommandConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>内部指令</AlertDialogTitle>
            <AlertDialogDescription>
              消息以 / 开头，会被系统识别成内部指令。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void sendCurrentInput()}>
              确认发送
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
