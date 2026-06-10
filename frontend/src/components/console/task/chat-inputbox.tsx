import { useState, useRef } from "react"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { IconCommand, IconLoader, IconPalette, IconReload, IconTrash, IconSend, IconTerminal2, IconUpload } from "@tabler/icons-react"
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
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { getTaskContentLimitErrorMessage, MAX_TASK_CONTENT_LENGTH } from "./task-content-limit"

const MAX_UPLOAD_FILE_SIZE = 2 * 1024 * 1024
const MAX_UPLOADED_FILES = 3
const TASK_INPUT_DRAFT_STORAGE_PREFIX = "task-chat-input-draft"
const PUBLISH_WEBSITE_PROMPT = "使用 publish-website 技能发布当前应用"
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

interface QueuedTaskInput {
  content: string
  uploadedFiles: TaskUploadedFile[]
  nextAttachmentFileIndex: number
}

interface TaskChatInputBoxProps {
  taskId: string
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

const getTaskInputDraftStorageKey = (taskId: string) => {
  const normalizedTaskId = taskId.trim()
  return normalizedTaskId ? `${TASK_INPUT_DRAFT_STORAGE_PREFIX}:${normalizedTaskId}` : null
}

const readTaskInputDraft = (taskId: string) => {
  const storageKey = getTaskInputDraftStorageKey(taskId)
  if (!storageKey || typeof window === "undefined") {
    return ""
  }

  try {
    return window.localStorage.getItem(storageKey) || ""
  } catch {
    return ""
  }
}

const writeTaskInputDraft = (taskId: string, draft: string) => {
  const storageKey = getTaskInputDraftStorageKey(taskId)
  if (!storageKey || typeof window === "undefined") {
    return
  }

  try {
    if (draft === "") {
      window.localStorage.removeItem(storageKey)
      return
    }

    window.localStorage.setItem(storageKey, draft)
  } catch {
    // Ignore storage failures so typing and sending continue to work.
  }
}

const removeTaskInputDraft = (taskId: string) => {
  writeTaskInputDraft(taskId, "")
}

export const TaskChatInputBox = ({ taskId, streamStatus, availableCommands, onSend, sending, queueSize, executionTimeMs = 0, onCancel, onRequestRestartAgent, whiteboardPersistenceKey = "task-whiteboard" }: TaskChatInputBoxProps) => {
  const [content, setContent] = useState(() => readTaskInputDraft(taskId))
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
  const [queuedInput, setQueuedInput] = useState<QueuedTaskInput | null>(null)
  const [autoSendingQueuedInput, setAutoSendingQueuedInput] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const nextAttachmentFileIndexRef = useRef(1)
  const autoSendingQueuedInputRef = useRef(false)
  const mountedRef = useRef(true)
  const isExecuting = (streamStatus === 'connected' || streamStatus === 'inited' || streamStatus === 'executing')
  const wasExecutingRef = useRef(isExecuting)
  const restoreSubmittedInputOnIdleRef = useRef(false)
  const lastSubmittedInputRef = useRef<{ content: string; uploadedFiles: TaskUploadedFile[]; nextAttachmentFileIndex: number } | null>(null)
  const inputLocked = autoSendingQueuedInput
  const canEditContent = React.useMemo(() => {
    return !sending && queueSize === 0 && !queuedInput && !inputLocked
  }, [inputLocked, queueSize, queuedInput, sending])
  const canUseIdleControls = React.useMemo(() => {
    return !sending && !isExecuting && queueSize === 0 && !queuedInput && !inputLocked
  }, [inputLocked, isExecuting, queueSize, queuedInput, sending])

  React.useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  React.useEffect(() => {
    writeTaskInputDraft(taskId, content)
  }, [content, taskId])

  React.useEffect(() => {
    if (wasExecutingRef.current && !isExecuting && queuedInput) {
      restoreSubmittedInputOnIdleRef.current = false
    } else if (wasExecutingRef.current && !isExecuting && restoreSubmittedInputOnIdleRef.current) {
      const lastSubmittedInput = lastSubmittedInputRef.current
      if (lastSubmittedInput) {
        setContent(lastSubmittedInput.content)
        setUploadedFiles(lastSubmittedInput.uploadedFiles)
        setPreviewFile(null)
        nextAttachmentFileIndexRef.current = lastSubmittedInput.nextAttachmentFileIndex
      }
      restoreSubmittedInputOnIdleRef.current = false
    }
    wasExecutingRef.current = isExecuting
  }, [isExecuting, queuedInput])

  const createCurrentInputSnapshot = (): QueuedTaskInput => ({
    content,
    uploadedFiles,
    nextAttachmentFileIndex: nextAttachmentFileIndexRef.current,
  })

  const sendInputSnapshot = React.useCallback(async (input: QueuedTaskInput) => {
    if (input.content.trim() === '') {
      return false
    }

    if (input.content.length > MAX_TASK_CONTENT_LENGTH) {
      toast.error(getTaskContentLimitErrorMessage())
      return false
    }

    const payload: TaskUserInputPayload = {
      content: input.content,
      attachments: input.uploadedFiles.map((file) => ({
        url: file.accessUrl,
        filename: file.name,
      })),
    }
    const result = await onSend(payload)
    if (result === false) {
      return false
    }

    lastSubmittedInputRef.current = input
    restoreSubmittedInputOnIdleRef.current = false
    return true
  }, [onSend])

  const clearCurrentInput = () => {
    removeTaskInputDraft(taskId)
    setContent('')
    setUploadedFiles([])
    setPreviewFile(null)
    setWhiteboardFileIndex(1)
    nextAttachmentFileIndexRef.current = 1
  }

  const sendCurrentInput = async () => {
    const sent = await sendInputSnapshot(createCurrentInputSnapshot())
    if (!sent) {
      return
    }

    clearCurrentInput()
  }

  const queueCurrentInput = () => {
    if (queuedInput) return
    if (content.trim() === '') {
      return
    }

    if (content.length > MAX_TASK_CONTENT_LENGTH) {
      toast.error(getTaskContentLimitErrorMessage())
      return
    }

    setQueuedInput(createCurrentInputSnapshot())
    setPreviewFile(null)
  }

  const cancelQueuedInput = () => {
    if (!queuedInput || autoSendingQueuedInput) return
    setPreviewFile(null)
    setQueuedInput(null)
  }

  React.useEffect(() => {
    if (!autoSendingQueuedInput || !queuedInput || !isExecuting || sending) {
      return
    }

    autoSendingQueuedInputRef.current = false
    setAutoSendingQueuedInput(false)
    setQueuedInput(null)
    clearCurrentInput()
  }, [autoSendingQueuedInput, isExecuting, queuedInput, sending])

  React.useEffect(() => {
    if (isExecuting || sending || queueSize > 0 || !queuedInput || autoSendingQueuedInputRef.current) {
      return
    }

    const inputToSend = queuedInput
    autoSendingQueuedInputRef.current = true
    setAutoSendingQueuedInput(true)

    void (async () => {
      let sent = false
      try {
        sent = await sendInputSnapshot(inputToSend)
      } catch (error) {
        console.error("自动发送等待输入失败:", error)
      } finally {
        autoSendingQueuedInputRef.current = false
        if (mountedRef.current) {
          setAutoSendingQueuedInput(false)
        }
      }

      if (!mountedRef.current) {
        return
      }

      if (sent) {
        setQueuedInput(null)
        clearCurrentInput()
        return
      }

      setContent(inputToSend.content)
      setUploadedFiles(inputToSend.uploadedFiles)
      setPreviewFile(null)
      nextAttachmentFileIndexRef.current = inputToSend.nextAttachmentFileIndex
      setQueuedInput(null)
      toast.error("等待发送失败，请手动重试")
    })()
  }, [isExecuting, queueSize, queuedInput, sendInputSnapshot, sending])

  const handleCancel = () => {
    restoreSubmittedInputOnIdleRef.current = content.trim() === '' && !queuedInput
    onCancel?.()
  }

  const handleSend = () => {
    if (queuedInput) {
      return
    }

    if (content.trim() === '') {
      return
    }

    if (content.length > MAX_TASK_CONTENT_LENGTH) {
      toast.error(getTaskContentLimitErrorMessage())
      return
    }

    if (content.startsWith('/')) {
      setSlashCommandConfirmOpen(true)
      return
    }

    if (isExecuting) {
      queueCurrentInput()
      return
    }

    void sendCurrentInput()
  }

  const handleConfirmSlashCommand = () => {
    if (isExecuting) {
      queueCurrentInput()
      return
    }

    void sendCurrentInput()
  }

  const handleTextRecognized = (text: string) => {
    setContent(text)
  }

  const handleSelectFile = () => {
    if (!canUseIdleControls) return
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

  const createFileWithName = (file: File, filename: string) => {
    if (file.name === filename) {
      return file
    }

    try {
      return new File([file], filename, {
        type: file.type,
        lastModified: file.lastModified,
      })
    } catch {
      return file
    }
  }

  const appendAttachmentFileIndex = (filename: string, index: number) => {
    const extensionIndex = filename.lastIndexOf(".")
    if (extensionIndex <= 0) {
      return `${filename}-${index}`
    }

    return `${filename.slice(0, extensionIndex)}-${index}${filename.slice(extensionIndex)}`
  }

  const normalizeUploadFile = (file: File) => {
    if (file.name && hasFileExtension(file.name)) {
      return file
    }

    const pastedImageName = createPastedImageName(file)
    if (!pastedImageName) {
      return file
    }

    return createFileWithName(file, pastedImageName)
  }

  const addCurrentRoundFileIndex = (file: File) => {
    return createFileWithName(file, appendAttachmentFileIndex(file.name, nextAttachmentFileIndexRef.current))
  }

  const prepareUploadFile = (file: File, options?: { autoUpload?: boolean }) => {
    if (!canUseIdleControls) {
      return
    }

    if (uploadedFiles.length >= MAX_UPLOADED_FILES) {
      toast.error(`最多只能上传 ${MAX_UPLOADED_FILES} 个文件`)
      return
    }

    const normalizedFile = addCurrentRoundFileIndex(normalizeUploadFile(file))

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
    nextAttachmentFileIndexRef.current += 1
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
    return canUseIdleControls && uploadedFiles.length < MAX_UPLOADED_FILES
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
    if (inputLocked) {
      return
    }
    // 如果正在输入法组合过程中，不触发提交
    if (isComposing) {
      return
    }
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      const textarea = e.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const nextContent = `${content.slice(0, start)}\n${content.slice(end)}`
      setContent(nextContent)
      requestAnimationFrame(() => {
        textarea.selectionStart = start + 1
        textarea.selectionEnd = start + 1
      })
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

  const commandItems = availableCommands?.commands ?? []
  const showCommandItems = !isExecuting && commandItems.length > 0
  const contentLength = content.length
  const contentTooLong = contentLength > MAX_TASK_CONTENT_LENGTH
  const canSend = content.trim() !== '' && !contentTooLong
  const canUploadMoreFiles = uploadedFiles.length < MAX_UPLOADED_FILES
  const whiteboardFileName = `画板-${whiteboardFileIndex}.png`
  const inputPlaceholder = isExecuting
    ? "任务执行中，可先输入下一条消息，回车后将等待发送。"
    : "描述你的需求，Shift+Enter 换行，Enter 发送。"
  const executionElapsedSeconds = (executionTimeMs / 1000).toFixed(1)
  const showExecutionStatusPanel = isExecuting

  return (
    <div
      className={cn(
        "relative w-full rounded-md border border-transparent transition-colors",
        isDragActive && "border-primary bg-primary/15"
      )}
    >
      {showExecutionStatusPanel && (
        <div className="mb-2 flex min-w-0 items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <div className="flex min-w-0 items-center gap-2 font-medium">
            <IconLoader className="size-4 shrink-0 animate-spin text-primary" />
            <span className="truncate">任务正在执行，耗时 {executionElapsedSeconds} 秒</span>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="xs"
            onClick={handleCancel}
            disabled={!onCancel}
          >
            取消
          </Button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />
      <InputGroup>
        <InputGroupTextarea
          ref={textareaRef}
          className="min-h-8 max-h-36 resize-none overflow-y-auto text-sm break-all [field-sizing:content] disabled:opacity-80"
          placeholder={inputPlaceholder}
          value={content}
          disabled={!canEditContent}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd} />
        <InputGroupAddon align="block-end" className="pb-1.5">
          <div className="flex flex-row justify-between w-full">
            <div className="flex flex-row gap-2 items-center min-w-0">
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon-sm" className="rounded-full" disabled={!canUseIdleControls || !showCommandItems}>
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
                      {!IS_OFFLINE_EDITION && (
                        <DropdownMenuItem className="flex flex-col items-start gap-1 whitespace-normal" onClick={() => {
                          setContent(PUBLISH_WEBSITE_PROMPT)
                          requestAnimationFrame(() => textareaRef.current?.focus())
                        }}>
                          <div className="flex min-w-0 flex-row flex-wrap items-center gap-2">
                            <IconCommand />
                            <div className="font-bold text-xs">发布 Web 应用</div>
                          </div>
                          <div className="max-w-full truncate pl-6 text-xs text-muted-foreground">
                            将你制作的 Web 应用发布到可公开访问的 MonkeyCode 用户作品集。
                          </div>
                        </DropdownMenuItem>
                      )}
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
              {canUploadMoreFiles && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      className="rounded-full"
                      disabled={!canUseIdleControls}
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
                    disabled={!canUseIdleControls}
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
                  disabled={!!queuedInput || inputLocked}
                  onPreview={() => setPreviewFile(uploadedFile)}
                  onRemove={() => {
                    if (previewFile?.accessUrl === uploadedFile.accessUrl) {
                      setPreviewFile(null)
                    }
                    setUploadedFiles((prev) => prev.filter((file) => file.accessUrl !== uploadedFile.accessUrl))
                  }}
                />
              ))}
            </div>
            <div className="flex flex-row gap-2 items-center min-w-0">
              {!IS_OFFLINE_EDITION && (
                <VoiceInputButton
                  onTextRecognized={handleTextRecognized}
                  disabled={!canEditContent || !!queuedInput}
                />
              )}
              {queuedInput ? (
                <InputGroupButton
                  className="group/auto-send flex flex-row gap-2 items-center"
                  variant="outline"
                  size="sm"
                  onClick={cancelQueuedInput}
                  disabled={autoSendingQueuedInput}
                >
                  <IconLoader className="size-4 shrink-0 animate-spin" />
                  {autoSendingQueuedInput ? (
                    "正在自动发送"
                  ) : (
                    <>
                      <span className="group-hover/auto-send:hidden">等待自动发送</span>
                      <span className="hidden group-hover/auto-send:inline">取消自动发送</span>
                    </>
                  )}
                </InputGroupButton>
              ) : isExecuting ? (
                <InputGroupButton
                  className="flex flex-row gap-2 items-center"
                  variant="default"
                  size="sm"
                  onClick={handleSend}
                  disabled={!canSend}
                >
                  <IconSend />
                  发送
                </InputGroupButton>
              ) : (
                <InputGroupButton
                  className="flex flex-row gap-2 items-center"
                  variant="default"
                  size="sm"
                  onClick={handleSend}
                  disabled={!canSend || !canUseIdleControls}
                >
                  <IconSend />
                  发送
                </InputGroupButton>
              )}
            </div>
          </div>
        </InputGroupAddon>
      </InputGroup>
      {contentTooLong && (
        <div className="mt-1 px-1 text-xs text-destructive">
          已超出 {contentLength - MAX_TASK_CONTENT_LENGTH} 字，最多 {MAX_TASK_CONTENT_LENGTH} 字，无法发送。
        </div>
      )}
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
            <AlertDialogAction onClick={handleConfirmSlashCommand}>
              确认发送
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
