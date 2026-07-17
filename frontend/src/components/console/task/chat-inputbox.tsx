import { useState, useRef } from "react"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { IconCommand, IconDots, IconFileText, IconLoader, IconPalette, IconReload, IconTrash, IconSend, IconSparkles, IconTerminal2, IconUpload } from "@tabler/icons-react"
import React from "react"
import { VoiceInputButton } from "./voice-input-button"
import type { TaskMessageHandlerStatus } from "@/components/console/task/task-message-handler"
import type { AvailableCommand, AvailableCommands, TaskStreamStatus, TaskUserInput, TaskUserInputPayload } from "./task-shared"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { isCompressibleImageFile, MAX_TASK_UPLOAD_FILE_SIZE_BYTES, MAX_TASK_UPLOAD_FILE_SIZE_LABEL, TaskFileUploadDialog, TaskUploadedFileItem, TaskUploadFileTooLargeError, uploadTaskFile, type TaskUploadedFile } from "./task-file-upload"
import { toast } from "sonner"
import { TaskWhiteboardDialog } from "./task-whiteboard-dialog"
import { TaskAttachmentPreviewDialog } from "./task-attachment-preview-dialog"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { MAX_TASK_CONTENT_LENGTH } from "./task-content-limit"
import { useTranslation } from "react-i18next"
import {
  getRecommendedTaskQuickInputs,
  getTaskQuickInputVisibleCount,
  incrementTaskQuickInput,
  normalizeQuickInputText,
  normalizeTaskQuickInputs,
  parseTaskQuickInputStorage,
  TASK_QUICK_INPUT_GAP_WIDTH,
  TASK_QUICK_INPUT_STORAGE_KEY,
  type TaskQuickInputItem,
} from "./task-quick-inputs"
import { createLongContentFileName, createLongContentTextFile, hasCrossedTaskContentLimit } from "./task-long-content"
import { TaskLongContentDialog } from "./task-long-content-dialog"

const MAX_UPLOADED_FILES = 3
const TASK_INPUT_DRAFT_STORAGE_PREFIX = "task-chat-input-draft"
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

interface LongContentConversionDraft {
  content: string
  filename: string
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

export interface TaskChatInputBoxHandle {
  submitPublishWebsite: () => void
}

type TaskQuickInputUpdater = (items: TaskQuickInputItem[]) => TaskQuickInputItem[]

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

export const TaskChatInputBox = React.forwardRef<TaskChatInputBoxHandle, TaskChatInputBoxProps>(function TaskChatInputBox({ taskId, streamStatus, availableCommands, onSend, sending, queueSize, executionTimeMs = 0, onCancel, onRequestRestartAgent, whiteboardPersistenceKey = "task-whiteboard" }, ref) {
  const { t } = useTranslation()
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
  const [quickInputs, setQuickInputs] = useState<TaskQuickInputItem[]>([])
  const [quickInputContainerWidth, setQuickInputContainerWidth] = useState(0)
  const [measuredQuickInputVisibleCount, setMeasuredQuickInputVisibleCount] = useState<number | null>(null)
  const [longContentDraft, setLongContentDraft] = useState<LongContentConversionDraft | null>(null)
  const [longContentConverting, setLongContentConverting] = useState(false)
  const [longContentPromptPending, setLongContentPromptPending] = useState(false)
  const [longContentPromptSuppressed, setLongContentPromptSuppressed] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const quickInputContainerRef = useRef<HTMLDivElement>(null)
  const quickInputMeasureRef = useRef<HTMLDivElement>(null)
  const slashCommandCancelRef = useRef<HTMLButtonElement>(null)
  const slashCommandConfirmRef = useRef<HTMLButtonElement>(null)
  const dragDepthRef = useRef(0)
  const nextAttachmentFileIndexRef = useRef(1)
  const autoSendingQueuedInputRef = useRef(false)
  const mountedRef = useRef(true)
  const uploadedFilesRef = useRef(uploadedFiles)
  const selectedQuickInputRef = useRef<string | null>(null)
  const currentTaskIdRef = useRef(taskId)
  const isExecuting = (streamStatus === 'connected' || streamStatus === 'inited' || streamStatus === 'executing')
  const wasExecutingRef = useRef(isExecuting)
  const restoreSubmittedInputOnIdleRef = useRef(false)
  const lastSubmittedInputRef = useRef<{ content: string; uploadedFiles: TaskUploadedFile[]; nextAttachmentFileIndex: number } | null>(null)
  const inputLocked = autoSendingQueuedInput || longContentConverting
  const contentLength = content.length
  const canEditContent = React.useMemo(() => {
    return !sending && queueSize === 0 && !queuedInput && !inputLocked
  }, [inputLocked, queueSize, queuedInput, sending])
  const canUseIdleControls = React.useMemo(() => {
    return !sending && !isExecuting && queueSize === 0 && !queuedInput && !inputLocked
  }, [inputLocked, isExecuting, queueSize, queuedInput, sending])

  const writeQuickInputs = React.useCallback((items: TaskQuickInputItem[]) => {
    if (typeof window === "undefined") {
      return
    }

    try {
      window.localStorage.setItem(TASK_QUICK_INPUT_STORAGE_KEY, JSON.stringify(items))
    } catch {
      // Ignore storage failures so the chat input remains usable.
    }
  }, [])

  const readQuickInputs = React.useCallback(() => {
    if (typeof window === "undefined") {
      return []
    }

    try {
      return normalizeTaskQuickInputs(parseTaskQuickInputStorage(window.localStorage.getItem(TASK_QUICK_INPUT_STORAGE_KEY)))
    } catch {
      return []
    }
  }, [])

  const updateQuickInputs = React.useCallback((updater: TaskQuickInputUpdater) => {
    setQuickInputs((currentItems) => {
      let baseItems = currentItems
      if (typeof window !== "undefined") {
        try {
          baseItems = normalizeTaskQuickInputs(parseTaskQuickInputStorage(window.localStorage.getItem(TASK_QUICK_INPUT_STORAGE_KEY)))
        } catch {
          baseItems = normalizeTaskQuickInputs(currentItems)
        }
      }
      const nextItems = updater(baseItems)
      writeQuickInputs(nextItems)
      return nextItems
    })
  }, [writeQuickInputs])

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  React.useEffect(() => {
    currentTaskIdRef.current = taskId
    setLongContentDraft(null)
    setLongContentConverting(false)
    setLongContentPromptPending(false)
    setLongContentPromptSuppressed(false)
  }, [taskId])

  React.useEffect(() => {
    const nextQuickInputs = readQuickInputs()
    setQuickInputs(nextQuickInputs)
    writeQuickInputs(nextQuickInputs)
  }, [readQuickInputs, writeQuickInputs])

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
        uploadedFilesRef.current = lastSubmittedInput.uploadedFiles
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

  const recordSentQuickInput = React.useCallback((sentContent: string) => {
    const normalizedContent = normalizeQuickInputText(sentContent)
    const adoptedQuickInput = selectedQuickInputRef.current
    const adopted = !!adoptedQuickInput && normalizeQuickInputText(adoptedQuickInput) === normalizedContent
    selectedQuickInputRef.current = null

    updateQuickInputs((items) => incrementTaskQuickInput(items, normalizedContent, { force: adopted }))
  }, [updateQuickInputs])

  const sendInputSnapshot = React.useCallback(async (input: QueuedTaskInput) => {
    if (input.content.trim() === '') {
      return false
    }

    if (input.content.length > MAX_TASK_CONTENT_LENGTH) {
      toast.error(t("taskWorkflow.input.contentTooLong", { maxCount: MAX_TASK_CONTENT_LENGTH }))
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
  }, [onSend, t])

  const clearCurrentInput = React.useCallback(() => {
    removeTaskInputDraft(taskId)
    selectedQuickInputRef.current = null
    setContent('')
    uploadedFilesRef.current = []
    setUploadedFiles([])
    setPreviewFile(null)
    setWhiteboardFileIndex(1)
    nextAttachmentFileIndexRef.current = 1
  }, [taskId])

  const queueInputSnapshot = React.useCallback((input: QueuedTaskInput) => {
    if (queuedInput) return false
    if (input.content.trim() === '') {
      return false
    }

    if (input.content.length > MAX_TASK_CONTENT_LENGTH) {
      toast.error(t("taskWorkflow.input.contentTooLong", { maxCount: MAX_TASK_CONTENT_LENGTH }))
      return false
    }

    setQueuedInput(input)
    setPreviewFile(null)
    return true
  }, [queuedInput, t])

  const submitInputSnapshot = React.useCallback((input: QueuedTaskInput) => {
    if (queuedInput || sending || queueSize > 0 || inputLocked) {
      return false
    }

    if (input.content.trim() === '') {
      return false
    }

    if (input.content.length > MAX_TASK_CONTENT_LENGTH) {
      toast.error(t("taskWorkflow.input.contentTooLong", { maxCount: MAX_TASK_CONTENT_LENGTH }))
      return false
    }

    if (isExecuting) {
      return queueInputSnapshot(input)
    }

    void sendInputSnapshot(input)
    return true
  }, [inputLocked, isExecuting, queueInputSnapshot, queueSize, queuedInput, sendInputSnapshot, sending, t])

  const submitPublishWebsite = React.useCallback(() => {
    const publishInput: QueuedTaskInput = {
      content: t("taskDetail.chat.commands.publishPrompt"),
      uploadedFiles: [],
      nextAttachmentFileIndex: nextAttachmentFileIndexRef.current,
    }

    submitInputSnapshot(publishInput)
  }, [submitInputSnapshot, t])

  React.useImperativeHandle(ref, () => ({
    submitPublishWebsite,
  }), [submitPublishWebsite])

  const sendCurrentInput = async () => {
    const currentInput = createCurrentInputSnapshot()
    const sent = await sendInputSnapshot(currentInput)
    if (!sent) {
      return
    }

    recordSentQuickInput(currentInput.content)
    clearCurrentInput()
  }

  const queueCurrentInput = () => {
    queueInputSnapshot(createCurrentInputSnapshot())
  }

  const cancelQueuedInput = () => {
    if (!queuedInput || autoSendingQueuedInput) return
    selectedQuickInputRef.current = null
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
        console.error("Failed to auto-send queued input:", error)
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
        recordSentQuickInput(inputToSend.content)
        setQueuedInput(null)
        clearCurrentInput()
        return
      }

      setContent(inputToSend.content)
      uploadedFilesRef.current = inputToSend.uploadedFiles
      setUploadedFiles(inputToSend.uploadedFiles)
      setPreviewFile(null)
      nextAttachmentFileIndexRef.current = inputToSend.nextAttachmentFileIndex
      setQueuedInput(null)
      toast.error(t("taskDetail.chat.toast.autoSendFailed"))
    })()
  }, [clearCurrentInput, isExecuting, queueSize, queuedInput, recordSentQuickInput, sendInputSnapshot, sending, t])

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
      toast.error(t("taskWorkflow.input.contentTooLong", { maxCount: MAX_TASK_CONTENT_LENGTH }))
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

  const handleSlashCommandDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      slashCommandCancelRef.current?.focus()
      return
    }

    if (event.key === "ArrowRight") {
      event.preventDefault()
      slashCommandConfirmRef.current?.focus()
    }
  }

  const handleContentChange = (nextContent: string) => {
    if (
      selectedQuickInputRef.current
      && normalizeQuickInputText(selectedQuickInputRef.current) !== normalizeQuickInputText(nextContent)
    ) {
      selectedQuickInputRef.current = null
    }

    if (
      !longContentPromptSuppressed
      && hasCrossedTaskContentLimit(content.length, nextContent.length, MAX_TASK_CONTENT_LENGTH)
    ) {
      setLongContentPromptPending(true)
    }

    setContent(nextContent)
  }

  const handleTextRecognized = (text: string) => {
    selectedQuickInputRef.current = null
    handleContentChange(text)
  }

  const applyQuickInput = (text: string) => {
    const normalizedText = normalizeQuickInputText(text)
    if (!normalizedText) {
      return
    }

    selectedQuickInputRef.current = normalizedText
    handleContentChange(normalizedText)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      const cursorPosition = normalizedText.length
      textareaRef.current?.setSelectionRange(cursorPosition, cursorPosition)
    })
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
      toast.error(t("taskDetail.chat.toast.maxFiles", { count: MAX_UPLOADED_FILES }))
      return
    }

    const normalizedFile = normalizeUploadFile(file)
    const uploadFile = addCurrentRoundFileIndex(normalizedFile)

    if (uploadFile.size === 0) {
      toast.error(t("taskDetail.chat.toast.emptyFile"))
      return
    }

    if (uploadFile.size > MAX_TASK_UPLOAD_FILE_SIZE_BYTES && !isCompressibleImageFile(uploadFile)) {
      toast.error(t("taskDetail.chat.toast.fileTooLarge", { size: MAX_TASK_UPLOAD_FILE_SIZE_LABEL }))
      return
    }

    if (!hasFileExtension(uploadFile.name)) {
      toast.error(t("taskDetail.chat.toast.missingExtension"))
      return
    }

    setShouldAutoUpload(!!options?.autoUpload)
    setSelectedUploadFile(uploadFile)
    setUploadDialogOpen(true)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''

    if (!file) {
      return
    }

    void prepareUploadFile(file)
  }

  const handleUploaded = (file: TaskUploadedFile) => {
    if (uploadedFilesRef.current.length >= MAX_UPLOADED_FILES) {
      return false
    }

    const nextUploadedFiles = [...uploadedFilesRef.current, file]
    uploadedFilesRef.current = nextUploadedFiles
    setUploadedFiles(nextUploadedFiles)
    nextAttachmentFileIndexRef.current += 1
    setSelectedUploadFile(null)
    setShouldAutoUpload(false)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
    return true
  }

  const openLongContentDialog = React.useCallback(() => {
    if (content.length <= MAX_TASK_CONTENT_LENGTH) return

    if (uploadedFiles.length >= MAX_UPLOADED_FILES) {
      toast.error(t("taskDetail.chat.toast.maxFiles", { count: MAX_UPLOADED_FILES }))
      setLongContentPromptSuppressed(true)
      return
    }

    setLongContentDraft({
      content,
      filename: createLongContentFileName(new Date()),
    })
  }, [content, t, uploadedFiles.length])

  const handleLongContentDialogOpenChange = (open: boolean) => {
    if (open || longContentConverting) return
    setLongContentDraft(null)
    setLongContentPromptSuppressed(true)
  }

  const handleManualLongContentConversion = () => {
    setLongContentPromptPending(false)
    openLongContentDialog()
  }

  const handleConfirmLongContentConversion = async () => {
    if (!longContentDraft || longContentConverting) return

    if (uploadedFilesRef.current.length >= MAX_UPLOADED_FILES) {
      toast.error(t("taskDetail.chat.toast.maxFiles", { count: MAX_UPLOADED_FILES }))
      setLongContentDraft(null)
      setLongContentPromptSuppressed(true)
      return
    }

    const conversionTaskId = taskId
    setLongContentConverting(true)
    try {
      const file = createLongContentTextFile(longContentDraft.content, longContentDraft.filename)
      const uploadedFile = await uploadTaskFile(file)

      if (!mountedRef.current || currentTaskIdRef.current !== conversionTaskId) {
        return
      }

      if (!handleUploaded(uploadedFile)) {
        toast.error(t("taskDetail.chat.toast.maxFiles", { count: MAX_UPLOADED_FILES }))
        setLongContentDraft(null)
        setLongContentPromptSuppressed(true)
        return
      }

      removeTaskInputDraft(taskId)
      setContent('')
      setLongContentDraft(null)
      setLongContentPromptPending(false)
      setLongContentPromptSuppressed(false)
      toast.success(t("taskDetail.chat.longContent.addDescription"))
    } catch (error) {
      if (!mountedRef.current || currentTaskIdRef.current !== conversionTaskId) {
        return
      }

      const message = error instanceof TaskUploadFileTooLargeError
        ? t("taskDetail.chat.toast.fileTooLarge", { size: MAX_TASK_UPLOAD_FILE_SIZE_LABEL })
        : t("taskDetail.chat.longContent.convertFailed")
      toast.error(message)
      console.error("Failed to convert long task input:", error)
    } finally {
      if (mountedRef.current && currentTaskIdRef.current === conversionTaskId) {
        setLongContentConverting(false)
      }
    }
  }

  React.useEffect(() => {
    if (contentLength <= MAX_TASK_CONTENT_LENGTH) {
      setLongContentPromptPending(false)
      setLongContentPromptSuppressed(false)
      return
    }

    if (!longContentPromptPending || isComposing || !canUseIdleControls) {
      return
    }

    setLongContentPromptPending(false)
    openLongContentDialog()
  }, [canUseIdleControls, contentLength, isComposing, longContentPromptPending, openLongContentDialog])

  const handleWhiteboardUploaded = (file: TaskUploadedFile) => {
    if (handleUploaded(file)) {
      setWhiteboardFileIndex((prev) => prev + 1)
    }
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
      toast.info(t("taskDetail.chat.toast.singleFileOnly"))
    }

    void prepareUploadFile(files[0], { autoUpload: true })
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
        toast.info(t("taskDetail.chat.toast.singleFileOnly"))
      }

      void prepareUploadFile(files[0], { autoUpload: true })
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (inputLocked) {
      return
    }
    if (isComposing) {
      return
    }
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      const textarea = e.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const nextContent = `${content.slice(0, start)}\n${content.slice(end)}`
      handleContentChange(nextContent)
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

  const handleCompositionStart = () => {
    setIsComposing(true)
  }

  const handleCompositionEnd = () => {
    setIsComposing(false)
  }

  const commandItems = availableCommands?.commands ?? []
  const showCommandItems = !isExecuting && commandItems.length > 0
  const contentTooLong = contentLength > MAX_TASK_CONTENT_LENGTH
  const canSend = content.trim() !== '' && !contentTooLong
  const canUploadMoreFiles = uploadedFiles.length < MAX_UPLOADED_FILES
  const whiteboardFileName = `whiteboard-${whiteboardFileIndex}.png`
  const inputPlaceholder = isExecuting
    ? t("taskDetail.chat.placeholder.executing")
    : t("taskDetail.chat.placeholder.idle")
  const executionElapsedSeconds = (executionTimeMs / 1000).toFixed(1)
  const showExecutionStatusPanel = isExecuting
  const recommendedQuickInputs = React.useMemo(() => getRecommendedTaskQuickInputs(quickInputs), [quickInputs])
  const showQuickInputPanel = canUseIdleControls && content.trim() === "" && uploadedFiles.length === 0 && recommendedQuickInputs.length > 0
  const quickInputMoreLabel = t("taskDetail.chat.quickInputs.more")
  const fallbackQuickInputVisibleCount = React.useMemo(() => (
    getTaskQuickInputVisibleCount(recommendedQuickInputs, quickInputContainerWidth, quickInputMoreLabel)
  ), [quickInputContainerWidth, quickInputMoreLabel, recommendedQuickInputs])
  const quickInputVisibleCount = measuredQuickInputVisibleCount ?? fallbackQuickInputVisibleCount
  const visibleQuickInputs = recommendedQuickInputs.slice(0, quickInputVisibleCount)
  const overflowQuickInputs = recommendedQuickInputs.slice(quickInputVisibleCount)

  React.useEffect(() => {
    const element = quickInputContainerRef.current
    if (!showQuickInputPanel || !element || typeof ResizeObserver === "undefined") {
      return
    }

    const updateContainerWidth = (width: number) => {
      setQuickInputContainerWidth(Math.max(0, Math.floor(width)))
    }

    updateContainerWidth(element.getBoundingClientRect().width)

    const resizeObserver = new ResizeObserver((entries) => {
      updateContainerWidth(entries[0]?.contentRect.width ?? element.getBoundingClientRect().width)
    })
    resizeObserver.observe(element)

    return () => resizeObserver.disconnect()
  }, [recommendedQuickInputs.length, showQuickInputPanel])

  React.useEffect(() => {
    const measureElement = quickInputMeasureRef.current
    if (!showQuickInputPanel || !measureElement || quickInputContainerWidth <= 0) {
      setMeasuredQuickInputVisibleCount(null)
      return
    }

    const itemElements = Array.from(
      measureElement.querySelectorAll<HTMLElement>("[data-quick-input-measure-item]"),
    )
    const moreElement = measureElement.querySelector<HTMLElement>("[data-quick-input-measure-more]")
    if (itemElements.length === 0 || !moreElement) {
      setMeasuredQuickInputVisibleCount(null)
      return
    }

    const itemWidths = itemElements.map((item) => Math.ceil(item.getBoundingClientRect().width))
    const totalItemsWidth = itemWidths.reduce((sum, width, index) => (
      sum + width + (index > 0 ? TASK_QUICK_INPUT_GAP_WIDTH : 0)
    ), 0)

    if (totalItemsWidth <= quickInputContainerWidth) {
      setMeasuredQuickInputVisibleCount(itemWidths.length)
      return
    }

    const moreWidth = Math.ceil(moreElement.getBoundingClientRect().width)
    let usedWidth = moreWidth
    let visibleCount = 0

    for (const width of itemWidths.slice(0, -1)) {
      const nextWidth = usedWidth + TASK_QUICK_INPUT_GAP_WIDTH + width
      if (nextWidth > quickInputContainerWidth) {
        break
      }

      usedWidth = nextWidth
      visibleCount += 1
    }

    setMeasuredQuickInputVisibleCount(Math.max(1, visibleCount))
  }, [quickInputContainerWidth, quickInputMoreLabel, recommendedQuickInputs, showQuickInputPanel])

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
            <span className="truncate">{t("taskDetail.chat.executionStatus", { seconds: executionElapsedSeconds })}</span>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="xs"
            onClick={handleCancel}
            disabled={!onCancel}
          >
            {t("taskDetail.common.cancel")}
          </Button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />
      {showQuickInputPanel && (
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
            <IconSparkles className="size-3.5" />
            <span>{t("taskDetail.chat.quickInputs.label")}</span>
          </div>
          <div ref={quickInputContainerRef} className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">
            <div
              ref={quickInputMeasureRef}
              className="pointer-events-none absolute -z-10 flex h-0 max-w-none flex-nowrap items-center gap-2 overflow-hidden opacity-0"
              aria-hidden="true"
            >
              {recommendedQuickInputs.map((item) => (
                <Button
                  key={item.text}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-full px-2.5 text-xs font-normal"
                  data-quick-input-measure-item
                  tabIndex={-1}
                >
                  <span>{item.text}</span>
                </Button>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full px-2.5 text-xs font-normal"
                data-quick-input-measure-more
                tabIndex={-1}
              >
                <IconDots className="size-3.5" />
                {quickInputMoreLabel}
              </Button>
            </div>
            {visibleQuickInputs.map((item) => (
              <Button
                key={item.text}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 min-w-0 max-w-full rounded-full px-2.5 text-xs font-normal"
                onClick={() => applyQuickInput(item.text)}
              >
                <span className="truncate">{item.text}</span>
              </Button>
            ))}
            {overflowQuickInputs.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 rounded-full px-2.5 text-xs font-normal"
                  >
                    <IconDots className="size-3.5" />
                    {quickInputMoreLabel}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
                  {overflowQuickInputs.map((item) => (
                    <DropdownMenuItem key={item.text} onSelect={() => applyQuickInput(item.text)}>
                      <span className="truncate">{item.text}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}
      <InputGroup>
        <InputGroupTextarea
          ref={textareaRef}
          className="min-h-8 max-h-36 resize-none overflow-y-auto text-sm break-all [field-sizing:content] disabled:opacity-80"
          placeholder={inputPlaceholder}
          value={content}
          disabled={!canEditContent}
          onChange={(e) => handleContentChange(e.target.value)}
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
                  <TooltipContent>{t("taskDetail.chat.commandOptions")}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent className={showCommandItems ? "w-[min(90vw,32rem)] min-w-80 max-w-[min(90vw,32rem)]" : "w-48 min-w-48"}>
                  {showCommandItems && (
                    <>
                      <DropdownMenuItem className="flex flex-col items-start gap-1 whitespace-normal" onSelect={() => onRequestRestartAgent?.(false)}>
                        <div className="flex min-w-0 flex-row flex-wrap items-center gap-2">
                          <IconReload />
                          <div className="font-bold text-xs">{t("taskDetail.chat.commands.restartAgent")}</div>
                        </div>
                        <div className="max-w-full truncate pl-6 text-xs text-muted-foreground">
                          {t("taskDetail.chat.commands.restartAgentDescription")}
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem className="flex flex-col items-start gap-1 whitespace-normal" onSelect={() => onRequestRestartAgent?.(true)}>
                        <div className="flex min-w-0 flex-row flex-wrap items-center gap-2">
                          <IconTrash />
                          <div className="font-bold text-xs">{t("taskDetail.chat.commands.restartAgentClear")}</div>
                        </div>
                        <div className="max-w-full truncate pl-6 text-xs text-muted-foreground">
                          {t("taskDetail.chat.commands.restartAgentClearDescription")}
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {commandItems.map((command: AvailableCommand, index: number) => (
                        <DropdownMenuItem key={index} className="flex flex-col items-start gap-1 whitespace-normal" onClick={() => handleContentChange(`/${command.name}`)}>
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
                      aria-label={t("taskDetail.chat.uploadAttachment")}
                      onClick={handleSelectFile}
                    >
                      <IconUpload />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("taskDetail.chat.uploadAttachment")}</TooltipContent>
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
                    aria-label={t("taskDetail.chat.whiteboard")}
                    onClick={() => setWhiteboardDialogOpen(true)}
                  >
                    <IconPalette />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("taskDetail.chat.whiteboard")}</TooltipContent>
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
                        const nextUploadedFiles = uploadedFilesRef.current.filter((file) => file.accessUrl !== uploadedFile.accessUrl)
                        uploadedFilesRef.current = nextUploadedFiles
                        setUploadedFiles(nextUploadedFiles)
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
                    t("taskDetail.chat.autoSending")
                  ) : (
                    <>
                      <span className="group-hover/auto-send:hidden">{t("taskDetail.chat.waitingAutoSend")}</span>
                      <span className="hidden group-hover/auto-send:inline">{t("taskDetail.chat.cancelAutoSend")}</span>
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
                  {t("taskDetail.common.send")}
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
                  {t("taskDetail.common.send")}
                </InputGroupButton>
              )}
            </div>
          </div>
        </InputGroupAddon>
      </InputGroup>
      {contentTooLong && (
        <div className="mt-1 flex items-center justify-between gap-2 px-1 text-xs text-destructive">
          <span>
            {t("taskDetail.chat.contentTooLongInline", {
              overCount: contentLength - MAX_TASK_CONTENT_LENGTH,
              maxCount: MAX_TASK_CONTENT_LENGTH,
            })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="shrink-0 text-destructive hover:text-destructive"
            disabled={longContentConverting || !canUseIdleControls}
            onClick={handleManualLongContentConversion}
          >
            <IconFileText className="size-3.5" />
            {t("taskDetail.chat.longContent.manualConvert")}
          </Button>
        </div>
      )}
      <TaskLongContentDialog
        open={!!longContentDraft}
        characterCount={longContentDraft?.content.length ?? contentLength}
        filename={longContentDraft?.filename ?? ""}
        converting={longContentConverting}
        onOpenChange={handleLongContentDialogOpenChange}
        onConfirm={handleConfirmLongContentConversion}
      />
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
        <AlertDialogContent onKeyDown={handleSlashCommandDialogKeyDown}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("taskDetail.chat.slashCommand.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("taskDetail.chat.slashCommand.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel ref={slashCommandCancelRef}>{t("taskDetail.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction ref={slashCommandConfirmRef} onClick={handleConfirmSlashCommand}>
              {t("taskDetail.chat.slashCommand.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
})
