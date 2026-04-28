import { ConstsOwnerType, ConstsTaskStatus, type DomainModel, type DomainProjectTask, type DomainVMPort } from "@/api/Api"
import { useBreadcrumbTask } from "@/components/console/breadcrumb-task-context"
import { useCommonData } from "@/components/console/data-provider"
import { PlanStepsBlock } from "@/components/console/task/chat-panel"
import { TaskChatInputBox } from "@/components/console/task/chat-inputbox"
import { TaskControlClient } from "@/components/console/task/task-control-client"
import { TaskMessageHandler, type TaskMessageHandlerStatus } from "@/components/console/task/task-message-handler"
import { MessageItem, type MessageType } from "@/components/console/task/message"
import { TaskPreparingView, useShouldShowPreparing } from "@/components/console/task/task-preparing-dialog"
import { TaskFileExplorer } from "@/components/console/task/task-file-explorer"
import { TaskPreviewPanel } from "@/components/console/task/task-preview-panel"
import type { AvailableCommands, TaskPlan, TaskStreamStatus } from "@/components/console/task/task-shared"
import { TaskStreamClient, type TaskStreamClientState, type TaskStreamCloseReason, type TaskStreamConnectionState } from "@/components/console/task/task-stream-client"
import { TaskTerminalPanel } from "@/components/console/task/task-terminal-panel"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CircularProgress } from "@/components/ui/circular-progress"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import Icon from "@/components/common/Icon"
import { cn } from "@/lib/utils"
import { formatTokens, getBrandFromModelName, getModelPricingItem, getOwnerTypeBadge, getTaskDisplayName } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconArrowDown, IconArrowUp, IconChevronDown, IconDeviceDesktop, IconFile, IconHistory, IconReload, IconTerminal2 } from "@tabler/icons-react"
import React from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"

type SidePanelType = "files"
type AskUserQuestionStatus = "pending" | "queued" | "submitting" | "completed" | "expired"
type MessageSource = "live" | "history"

export default function TaskDetailPage() {
  const { taskId } = useParams()
  const { setTaskName } = useBreadcrumbTask() ?? {}
  const { models, loadingModels } = useCommonData()
  const [task, setTask] = React.useState<DomainProjectTask | null>(null)
  const [activeSidePanel, setActiveSidePanel] = React.useState<SidePanelType | null>(null)
  const [terminalPanelOpen, setTerminalPanelOpen] = React.useState(false)
  const [previewDialogOpen, setPreviewDialogOpen] = React.useState(false)
  const [streamStatus, setStreamStatus] = React.useState<TaskMessageHandlerStatus>("inited")
  const [availableCommands, setAvailableCommands] = React.useState<AvailableCommands | null>(null)
  const [plan, setPlan] = React.useState<TaskPlan>({
    entries: [],
    version: 0,
  })
  const [contextUsage, setContextUsage] = React.useState<{ size: number | null; used: number | null }>({
    size: null,
    used: null,
  })
  const [sending, setSending] = React.useState(false)
  const [rawHistoryMessages, setRawHistoryMessages] = React.useState<MessageType[]>([])
  const [rawLiveMessages, setRawLiveMessages] = React.useState<MessageType[]>([])
  const [streamConnectionState, setStreamConnectionState] = React.useState<TaskStreamConnectionState>("closed")
  const [streamCloseReason, setStreamCloseReason] = React.useState<TaskStreamCloseReason | null>(null)
  const [queuedReplyIds, setQueuedReplyIds] = React.useState<string[]>([])
  const [submittingReplyIds, setSubmittingReplyIds] = React.useState<string[]>([])
  const [fileChangesCount, setFileChangesCount] = React.useState(0)
  const [fileRefreshSignal, setFileRefreshSignal] = React.useState(0)
  const [historyCursor, setHistoryCursor] = React.useState<string | null>(null)
  const [historyHasMore, setHistoryHasMore] = React.useState(true)
  const [historyLoaded, setHistoryLoaded] = React.useState(false)
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [historyCursorReady, setHistoryCursorReady] = React.useState(false)
  const [previewPorts, setPreviewPorts] = React.useState<DomainVMPort[] | undefined>(undefined)
  const [contextUsagePopoverOpen, setContextUsagePopoverOpen] = React.useState(false)
  const [resetContextDialogOpen, setResetContextDialogOpen] = React.useState(false)
  const [resetContextSubmitting, setResetContextSubmitting] = React.useState(false)
  const [modelSwitchDialogOpen, setModelSwitchDialogOpen] = React.useState(false)
  const [modelSwitchSubmitting, setModelSwitchSubmitting] = React.useState(false)
  const [pendingSwitchModel, setPendingSwitchModel] = React.useState<DomainModel | null>(null)
  const [chatHasOverflow, setChatHasOverflow] = React.useState(false)
  const [chatAtTop, setChatAtTop] = React.useState(true)
  const [chatAtBottom, setChatAtBottom] = React.useState(true)
  const taskControlClientRef = React.useRef<TaskControlClient | null>(null)
  const streamClientRef = React.useRef<TaskStreamClient | null>(null)
  const historyLoadingRef = React.useRef(false)
  const chatScrollRootRef = React.useRef<HTMLDivElement | null>(null)
  const historyLoadedRef = React.useRef(false)
  const chatScrollRef = React.useRef<HTMLDivElement | null>(null)
  const chatContentRef = React.useRef<HTMLDivElement | null>(null)
  const autoScrollFrameRef = React.useRef<number | null>(null)
  const autoScrollLockTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoScrollIntentLockedRef = React.useRef(false)
  const shouldAutoScrollChatRef = React.useRef(true)
  const previousLiveUserInputIdRef = React.useRef<string | null>(null)
  const previousLiveEndedCycleIdRef = React.useRef<string | null>(null)
  const previousRunningMessagesSignatureRef = React.useRef<string | null>(null)
  const activeSidePanelRef = React.useRef<SidePanelType | null>(null)
  const previewDialogOpenRef = React.useRef(false)
  const showPreparing = useShouldShowPreparing(task)
  const taskInteractive = task?.status === ConstsTaskStatus.TaskStatusProcessing
  const envid = task?.virtualmachine?.id
  const cancelledRef = React.useRef(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const queuedReplyIdSet = React.useMemo(() => new Set(queuedReplyIds), [queuedReplyIds])
  const submittingReplyIdSet = React.useMemo(() => new Set(submittingReplyIds), [submittingReplyIds])
  const decorateMessages = React.useCallback((sourceMessages: MessageType[], source: MessageSource) => {
    return sourceMessages.map((message) => {
      if (message.type !== "ask_user_question") {
        return message
      }

      const askId = message.data.askId ?? ""
      const baseStatus = message.data.status
      const isCompleted = baseStatus === "completed"

      let nextStatus: AskUserQuestionStatus = isCompleted ? "completed" : "pending"
      if (!isCompleted) {
        if (source === "history" || streamConnectionState === "closed") {
          nextStatus = "expired"
        } else if (queuedReplyIdSet.has(askId)) {
          nextStatus = "queued"
        } else if (submittingReplyIdSet.has(askId)) {
          nextStatus = "submitting"
        }
      }

      return {
        ...message,
        data: {
          ...message.data,
          status: nextStatus,
        },
        onResponseAskUserQuestion: source === "live" && nextStatus === "pending"
          ? (nextAskId: string, answers: unknown) => {
            if (!nextAskId) {
              return "rejected"
            }

            const streamClient = streamClientRef.current
            if (!streamClient) {
              toast.error("当前连接不可用，问题已过期")
              return "rejected"
            }

            const result = streamClient.sendReplyQuestion(nextAskId, answers)
            if (result === "rejected") {
              toast.error("当前连接已结束，无法提交回答")
            }
            return result
          }
          : undefined,
      }
    })
  }, [queuedReplyIdSet, streamConnectionState, submittingReplyIdSet])
  const historyMessages = React.useMemo(() => decorateMessages(rawHistoryMessages, "history"), [decorateMessages, rawHistoryMessages])
  const liveMessages = React.useMemo(() => decorateMessages(rawLiveMessages, "live"), [decorateMessages, rawLiveMessages])
  const handleReloadSession = React.useCallback(async () => {
    const success = await taskControlClientRef.current?.restart(true)
    return !!success
  }, [])
  const runningMessagesSignature = React.useMemo(() => JSON.stringify(
    liveMessages
      .filter((message) => (
        message.type === "agent_message_chunk"
        || message.type === "agent_thought_chunk"
        || message.type === "tool_call"
        || message.type === "ask_user_question"
      ))
      .map((message) => ({
        id: message.id,
        type: message.type,
        content: message.data.content ?? null,
        status: message.data.status ?? null,
        title: message.data.title ?? null,
        askId: message.data.askId ?? null,
        toolCallId: message.data.toolCallId ?? null,
        questions: message.data.questions ?? null,
      })),
  ), [liveMessages])
  const latestLiveUserInputId = React.useMemo(() => {
    for (let index = liveMessages.length - 1; index >= 0; index -= 1) {
      const message = liveMessages[index]
      if (message.type === "user_input") {
        return message.id
      }
    }
    return null
  }, [liveMessages])
  const latestCompletedLiveCycleId = React.useMemo(() => {
    if (!latestLiveUserInputId) {
      return null
    }
    if (streamStatus === "finished" || streamCloseReason === "task_ended") {
      return latestLiveUserInputId
    }
    return null
  }, [latestLiveUserInputId, streamCloseReason, streamStatus])
  const [timeCost, setTimeCost] = React.useState(0)
  const previewPortCount = (previewPorts ?? []).length
  const totalTokens = task?.stats?.total_tokens ?? ((task?.stats?.input_tokens ?? 0) + (task?.stats?.output_tokens ?? 0))
  const hasContextUsage = contextUsage.size !== null || contextUsage.used !== null
  const canInput = taskInteractive && !sending && streamStatus !== "connected" && streamStatus !== "inited"
  const planStreamStatus: TaskStreamStatus = streamStatus === "connected" ? "executing" : streamStatus
  const contextProgress = contextUsage.size && contextUsage.size > 0
    ? Math.min(Math.max((contextUsage.used ?? 0) / contextUsage.size, 0), 1)
    : 0
  const contextProgressClassName = contextProgress >= 0.8
    ? "text-destructive"
    : contextProgress >= 0.6
      ? "text-amber-500"
      : "text-foreground"
  const contextUsagePercent = `${(contextProgress * 100).toFixed(1)}%`

  const hasSidePanel = activeSidePanel !== null
  const hasBottomTerminal = terminalPanelOpen
  const currentModelId = task?.model?.id ?? ""
  const currentModelName = task?.model?.model ?? ""
  const supportedModels = React.useMemo(
    () => models.filter((model) => model.id || model.model),
    [models]
  )
  const selectedModelValue = React.useMemo(() => {
    if (currentModelId) return currentModelId

    return supportedModels.find((model) => model.model === currentModelName)?.id ?? ""
  }, [currentModelId, currentModelName, supportedModels])

  const toggleSidePanel = (panel: SidePanelType) => {
    setActiveSidePanel((prev) => (prev === panel ? null : panel))
  }

  const toggleTerminalPanel = () => {
    setTerminalPanelOpen((prev) => !prev)
  }

  const togglePreviewDialog = () => {
    setPreviewDialogOpen((prev) => !prev)
  }

  React.useEffect(() => {
    activeSidePanelRef.current = activeSidePanel
  }, [activeSidePanel])

  React.useEffect(() => {
    previewDialogOpenRef.current = previewDialogOpen
  }, [previewDialogOpen])

  const disconnectStreamClient = React.useCallback(() => {
    const state = streamClientRef.current?.disconnect() ?? null
    streamClientRef.current = null
    return state
  }, [])

  const disposeTaskControlClient = React.useCallback(() => {
    taskControlClientRef.current?.dispose()
    taskControlClientRef.current = null
  }, [])

  const connectStreamClient = React.useCallback((mode: "attach" | "new", userInput?: string) => {
    if (!taskId) return Promise.resolve(false)

    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (result: boolean) => {
        if (settled) return
        settled = true
        resolve(result)
      }

      const previousState = disconnectStreamClient()
      const previousMessages = previousState?.messages ?? rawLiveMessages
      if (mode === "new" && previousMessages.length > 0) {
        setRawHistoryMessages((prev) => [...prev, ...previousMessages])
        setRawLiveMessages([])
      }

      setAvailableCommands(null)
      setPlan({
        entries: [],
        version: 0,
      })
      setStreamStatus("inited")
      setStreamConnectionState("connecting")
      setStreamCloseReason(null)
      setQueuedReplyIds([])
      setSubmittingReplyIds([])
      setSending(mode === "new")
      setTimeCost(0)

      const client = mode === "attach"
        ? TaskStreamClient.attach({
          taskId,
          onStateChange: (state: TaskStreamClientState) => {
            if (streamClientRef.current !== client || cancelledRef.current) return
            setStreamStatus(state.status)
            setRawLiveMessages(state.messages)
            setAvailableCommands(state.availableCommands)
            setPlan(state.plan)
            setContextUsage((prev) => ({
              size: state.contextUsage.size ?? prev.size,
              used: state.contextUsage.used ?? prev.used,
            }))
            setTimeCost(state.executionTimeMs)
            setStreamConnectionState(state.connectionState)
            setStreamCloseReason(state.closeReason)
            setQueuedReplyIds(state.queuedReplyIds)
            setSubmittingReplyIds(state.submittingReplyIds)
            if (!historyLoadedRef.current && state.historyCursor.ready) {
              setHistoryCursorReady(true)
              setHistoryCursor(state.historyCursor.cursor)
              setHistoryHasMore(state.historyCursor.hasMore)
            }
          },
          onOpen: () => {
            if (streamClientRef.current !== client || cancelledRef.current) return
            setSending(false)
            finish(true)
          },
          onClose: () => {
            if (streamClientRef.current === client) {
              streamClientRef.current = null
            }
            if (!cancelledRef.current) {
              setSending(false)
            }
            finish(false)
          },
          onError: () => {
            if (streamClientRef.current !== client || cancelledRef.current) return
            setSending(false)
            finish(false)
          },
        })
        : TaskStreamClient.new({
          taskId,
          onStateChange: (state: TaskStreamClientState) => {
            if (streamClientRef.current !== client || cancelledRef.current) return
            setStreamStatus(state.status)
            setRawLiveMessages(state.messages)
            setAvailableCommands(state.availableCommands)
            setPlan(state.plan)
            setContextUsage((prev) => ({
              size: state.contextUsage.size ?? prev.size,
              used: state.contextUsage.used ?? prev.used,
            }))
            setTimeCost(state.executionTimeMs)
            setStreamConnectionState(state.connectionState)
            setStreamCloseReason(state.closeReason)
            setQueuedReplyIds(state.queuedReplyIds)
            setSubmittingReplyIds(state.submittingReplyIds)
          },
          onOpen: () => {
            if (streamClientRef.current !== client || cancelledRef.current) return
            setSending(false)
            finish(true)
          },
          onClose: () => {
            if (streamClientRef.current === client) {
              streamClientRef.current = null
            }
            if (!cancelledRef.current) {
              setSending(false)
            }
            finish(false)
          },
          onError: () => {
            if (streamClientRef.current !== client || cancelledRef.current) return
            setSending(false)
            finish(false)
          },
          userInput: userInput ?? "",
        })

      streamClientRef.current = client
      client.connect()
    })
  }, [disconnectStreamClient, rawLiveMessages, taskId])

  // taskId 变化时重置状态
  React.useEffect(() => {
    if (!taskId) return
    disconnectStreamClient()
    disposeTaskControlClient()
    setTask(null)
    setActiveSidePanel(null)
    setTerminalPanelOpen(false)
    setPreviewDialogOpen(false)
    setStreamStatus("inited")
    setAvailableCommands(null)
    setPlan({
      entries: [],
      version: 0,
    })
    setSending(false)
    setRawHistoryMessages([])
    setRawLiveMessages([])
    setStreamConnectionState("closed")
    setQueuedReplyIds([])
    setSubmittingReplyIds([])
    setFileChangesCount(0)
    setFileRefreshSignal(0)
    setHistoryCursor(null)
    setHistoryHasMore(true)
    setHistoryLoaded(false)
    setHistoryCursorReady(false)
    historyLoadedRef.current = false
    setHistoryLoading(false)
    setPreviewPorts(undefined)
    setTimeCost(0)
    historyLoadingRef.current = false
  }, [disconnectStreamClient, disposeTaskControlClient, taskId])

  const fetchTaskDetail = React.useCallback(async (): Promise<DomainProjectTask | null> => {
    if (!taskId) return null
    let result: DomainProjectTask | null = null
    await apiRequest("v1UsersTasksDetail", {}, [taskId], (resp) => {
      if (resp.code === 0) {
        result = resp.data
        if (!cancelledRef.current) setTask(resp.data)
      } else {
        toast.error(resp.message || "获取任务详情失败")
      }
    })
    return result
  }, [taskId])

  const syncFileChangesCount = React.useCallback(async () => {
    const changes = await taskControlClientRef.current?.getFileChanges()
    if (cancelledRef.current || changes === null || changes === undefined) return
    setFileChangesCount(changes.length)
  }, [])

  const applyRepoFileChange = React.useCallback(() => {
    if (cancelledRef.current) return
    setFileRefreshSignal((prev) => prev + 1)
    void syncFileChangesCount()
  }, [syncFileChangesCount])

  const fetchPortForwards = React.useCallback(async () => {
    const ports = await taskControlClientRef.current?.getPortForwardList()
    if (cancelledRef.current || ports === null || ports === undefined) return

    setPreviewPorts(ports.map((port) => ({
      port: port.port,
      status: port.status as DomainVMPort["status"],
      forward_id: port.forward_id ?? undefined,
      preview_url: port.access_url ?? undefined,
      error_message: port.error_message ?? undefined,
      success: true,
    })))
  }, [])

  const handlePortChange = React.useCallback(async (opened: boolean) => {
    await fetchPortForwards()
    if (!opened || cancelledRef.current) {
      return
    }

    const currentPanel = activeSidePanelRef.current
    const shouldOpenPreview = currentPanel === null || previewDialogOpenRef.current
    if (!shouldOpenPreview) {
      return
    }

    setPreviewDialogOpen(true)
    await fetchPortForwards()
  }, [fetchPortForwards])

  React.useEffect(() => {
    if (!taskId || !taskInteractive) return

    const client = new TaskControlClient({
      taskId,
      onRepoFileChange: applyRepoFileChange,
      onPortChange: handlePortChange,
    })
    taskControlClientRef.current = client
    client.connect()

    return () => {
      if (taskControlClientRef.current === client) {
        taskControlClientRef.current = null
      }
      client.dispose()
    }
  }, [applyRepoFileChange, handlePortChange, taskId, taskInteractive])

  const scheduleFetchTaskDetail = React.useCallback(async () => {
    const currentTask = await fetchTaskDetail()
    if (cancelledRef.current) return
    const taskStatus = currentTask?.status
    let delay = 60000
    if (taskStatus === ConstsTaskStatus.TaskStatusPending) {
      delay = 2000
    } else if (taskStatus === ConstsTaskStatus.TaskStatusProcessing) {
      delay = 10000
    }
    timeoutRef.current = setTimeout(scheduleFetchTaskDetail, delay)
  }, [fetchTaskDetail])

  const fetchTaskRounds = React.useCallback(async (cursor?: string) => {
    if (!taskId || historyLoadingRef.current) return
    historyLoadingRef.current = true
    setHistoryLoading(true)
    await apiRequest(
      "v1UsersTasksRoundsList",
      {
        id: taskId,
        limit: 1,
        ...(cursor ? { cursor } : {}),
      },
      [],
      (resp) => {
        if (cancelledRef.current) return
        if (resp.code === 0) {
          const messageHandler = new TaskMessageHandler()
          messageHandler.pushChunks(resp.data?.chunks ?? [])
          const messageState = messageHandler.finalizeCycle()
          setRawHistoryMessages((prev) => [...messageState.messages, ...prev])
          setContextUsage((prev) => ({
            size: messageState.contextUsage.size ?? prev.size,
            used: messageState.contextUsage.used ?? prev.used,
          }))
          setHistoryCursorReady(true)
          setHistoryCursor(resp.data?.next_cursor ?? null)
          setHistoryHasMore(resp.data?.has_more ?? false)
          setHistoryLoaded(true)
          historyLoadedRef.current = true
        } else {
          toast.error(resp.message || "获取任务历史消息失败")
        }
      },
      () => undefined,
    )
    historyLoadingRef.current = false
    if (!cancelledRef.current) {
      setHistoryLoading(false)
    }
  }, [taskId])

  React.useEffect(() => {
    if (!taskId) return
    cancelledRef.current = false
    scheduleFetchTaskDetail()
    return () => {
      cancelledRef.current = true
      disconnectStreamClient()
      disposeTaskControlClient()
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [disconnectStreamClient, disposeTaskControlClient, taskId, scheduleFetchTaskDetail])

  React.useEffect(() => {
    if (!setTaskName) return
    if (task) {
      setTaskName(getTaskDisplayName(task, "未知任务名称"))
    }
    return () => setTaskName?.(null)
  }, [task, setTaskName])

  React.useEffect(() => {
    if (!taskId || !task) return
    if (streamStatus !== "inited") return
    if (streamClientRef.current) return
    if (!taskInteractive) return
    connectStreamClient("attach")
  }, [connectStreamClient, streamStatus, task, taskId, taskInteractive])

  React.useEffect(() => {
    if (!task) return
    if (historyLoaded || historyLoading) return
    if (rawLiveMessages.length > 0) return
    if (
      task.status !== ConstsTaskStatus.TaskStatusFinished
      && task.status !== ConstsTaskStatus.TaskStatusError
    ) {
      return
    }
    fetchTaskRounds()
  }, [fetchTaskRounds, historyLoaded, historyLoading, rawLiveMessages.length, task])

  React.useEffect(() => {
    if (!taskInteractive || !previewDialogOpen) return
    fetchPortForwards()
  }, [fetchPortForwards, previewDialogOpen, taskInteractive])

  const handleSend = React.useCallback((content: string) => {
    if (!taskId) return Promise.resolve(false)
    return connectStreamClient("new", content)
  }, [connectStreamClient, taskId])
  const messages = React.useMemo(() => {
    const enhanceErrorMessage = (message: MessageType) => {
      if (message.type !== "error_message") {
        return message
      }

      return {
        ...message,
        onReloadSession: handleReloadSession,
        onUserInput: handleSend,
      }
    }

    return [...historyMessages, ...liveMessages].map(enhanceErrorMessage)
  }, [handleReloadSession, handleSend, historyMessages, liveMessages])

  const handleCompactContext = React.useCallback(() => {
    if (!canInput) return
    setContextUsagePopoverOpen(false)
    handleSend("/compact")
  }, [canInput, handleSend])

  const handleRequestModelSwitch = React.useCallback((model: DomainModel) => {
    if (!model.id) {
      toast.error("模型信息无效，无法切换")
      return
    }

    if (model.id === currentModelId || (!currentModelId && model.model === currentModelName)) {
      return
    }

    setPendingSwitchModel(model)
    setModelSwitchDialogOpen(true)
  }, [currentModelId, currentModelName])

  const handleConfirmModelSwitch = React.useCallback(async () => {
    const modelId = pendingSwitchModel?.id
    if (!modelId || !pendingSwitchModel || modelSwitchSubmitting) return

    const nextModel = pendingSwitchModel
    setModelSwitchSubmitting(true)
    const response = await taskControlClientRef.current?.switchModel(modelId, true)
    setModelSwitchSubmitting(false)

    if (!response) {
      toast.error("切换模型超时，请稍后重试")
      return
    }

    if (response.success) {
      setTask((prev) => prev ? { ...prev, model: nextModel } : prev)
      setModelSwitchDialogOpen(false)
      setPendingSwitchModel(null)
      toast.success(response.message || "模型已切换")
      return
    }

    setModelSwitchDialogOpen(false)
    setPendingSwitchModel(null)
    toast.error(response.message || "切换模型失败")
  }, [modelSwitchSubmitting, pendingSwitchModel])

  const handleCancel = React.useCallback(() => {
    streamClientRef.current?.sendCancel()
  }, [])

  const handleResetSession = React.useCallback(async () => {
    const success = await taskControlClientRef.current?.restart(false)
    return !!success
  }, [])

  const handleConfirmResetContext = React.useCallback(async () => {
    if (resetContextSubmitting) return

    setResetContextSubmitting(true)
    const success = await handleResetSession()
    setResetContextSubmitting(false)

    if (success) {
      setResetContextDialogOpen(false)
      toast.success("上下文已重置")
      return
    }

    toast.error("重置上下文失败")
  }, [handleResetSession, resetContextSubmitting])

  const showHistoryLoadButton = historyCursorReady && (!historyLoaded || historyHasMore)

  const getChatScrollContainer = React.useCallback(() => {
    if (chatScrollRef.current?.isConnected) {
      return chatScrollRef.current
    }

    const container = chatScrollRootRef.current?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLDivElement | null
    chatScrollRef.current = container
    return container
  }, [])

  const updateChatScrollState = React.useCallback((options?: { syncAutoScroll?: boolean }) => {
    const container = getChatScrollContainer()
    if (!container) return

    const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
    const hasOverflow = maxScrollTop > 4
    const isAtTop = !hasOverflow || container.scrollTop <= 8
    const isAtBottom = !hasOverflow || maxScrollTop - container.scrollTop <= 24

    setChatHasOverflow(hasOverflow)
    setChatAtTop(isAtTop)
    setChatAtBottom(isAtBottom)

    if (!hasOverflow) {
      shouldAutoScrollChatRef.current = true
      return
    }

    if (options?.syncAutoScroll && !autoScrollIntentLockedRef.current) {
      shouldAutoScrollChatRef.current = isAtBottom
    }
  }, [getChatScrollContainer])

  React.useEffect(() => {
    const container = getChatScrollContainer()
    const content = chatContentRef.current
    if (!container) return

    const handleScroll = () => updateChatScrollState({ syncAutoScroll: true })
    container.addEventListener("scroll", handleScroll, { passive: true })

    const resizeObserver = new ResizeObserver(() => {
      updateChatScrollState()
    })
    resizeObserver.observe(container)
    if (content) {
      resizeObserver.observe(content)
    }

    updateChatScrollState({ syncAutoScroll: true })

    return () => {
      container.removeEventListener("scroll", handleScroll)
      resizeObserver.disconnect()
    }
  }, [getChatScrollContainer, updateChatScrollState])

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updateChatScrollState()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages, hasSidePanel, hasBottomTerminal, historyLoading, historyLoaded, showHistoryLoadButton, updateChatScrollState])

  const scrollChatToTop = React.useCallback(() => {
    shouldAutoScrollChatRef.current = false
    getChatScrollContainer()?.scrollTo({ top: 0, behavior: "smooth" })
  }, [getChatScrollContainer])

  const scheduleChatScrollToBottom = React.useCallback((behavior: ScrollBehavior = "smooth", options?: { forceAutoScroll?: boolean }) => {
    const container = getChatScrollContainer()
    if (!container) return

    if (options?.forceAutoScroll) {
      shouldAutoScrollChatRef.current = true
    }

    if (behavior === "smooth") {
      autoScrollIntentLockedRef.current = true
      if (autoScrollLockTimeoutRef.current !== null) {
        clearTimeout(autoScrollLockTimeoutRef.current)
      }
      autoScrollLockTimeoutRef.current = setTimeout(() => {
        autoScrollIntentLockedRef.current = false
        autoScrollLockTimeoutRef.current = null
        updateChatScrollState()
      }, 450)
    }

    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current)
    }

    autoScrollFrameRef.current = window.requestAnimationFrame(() => {
      autoScrollFrameRef.current = null
      const nextContainer = getChatScrollContainer()
      if (!nextContainer) return
      nextContainer.scrollTo({ top: nextContainer.scrollHeight, behavior })
    })
  }, [getChatScrollContainer, updateChatScrollState])

  const scrollChatToBottom = React.useCallback(() => {
    scheduleChatScrollToBottom("smooth", { forceAutoScroll: true })
  }, [scheduleChatScrollToBottom])

  React.useEffect(() => {
    return () => {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current)
        autoScrollFrameRef.current = null
      }
      if (autoScrollLockTimeoutRef.current !== null) {
        clearTimeout(autoScrollLockTimeoutRef.current)
        autoScrollLockTimeoutRef.current = null
      }
      autoScrollIntentLockedRef.current = false
    }
  }, [getChatScrollContainer])

  React.useEffect(() => {
    if (!latestLiveUserInputId) return
    if (previousLiveUserInputIdRef.current === latestLiveUserInputId) return

    previousLiveUserInputIdRef.current = latestLiveUserInputId
    scheduleChatScrollToBottom("smooth", { forceAutoScroll: true })
  }, [latestLiveUserInputId, scheduleChatScrollToBottom])

  React.useEffect(() => {
    if (!latestCompletedLiveCycleId) return
    if (previousLiveEndedCycleIdRef.current === latestCompletedLiveCycleId) return

    previousLiveEndedCycleIdRef.current = latestCompletedLiveCycleId
    scheduleChatScrollToBottom("smooth", { forceAutoScroll: true })
  }, [latestCompletedLiveCycleId, scheduleChatScrollToBottom])

  React.useEffect(() => {
    if (historyLoading) return
    if (previousRunningMessagesSignatureRef.current === runningMessagesSignature) return

    previousRunningMessagesSignatureRef.current = runningMessagesSignature
    if (!shouldAutoScrollChatRef.current) return

    scheduleChatScrollToBottom("smooth")
  }, [historyLoading, runningMessagesSignature, scheduleChatScrollToBottom])

  const detailHeader = (
    <div className="shrink-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 max-w-[220px] shrink-0 gap-1 px-2 text-xs font-normal"
                disabled={!canInput}
              >
                <span className="truncate">{currentModelName || "未知模型"}</span>
                <IconChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[360px] min-w-[320px] overflow-y-auto">
              {loadingModels ? (
                <DropdownMenuItem disabled>加载中...</DropdownMenuItem>
              ) : supportedModels.length === 0 ? (
                <DropdownMenuItem disabled>暂无可用模型</DropdownMenuItem>
              ) : (
                <DropdownMenuRadioGroup
                  value={selectedModelValue}
                  onValueChange={(nextModelId) => {
                    const nextModel = supportedModels.find((model) => model.id === nextModelId)
                    if (nextModel) {
                      handleRequestModelSwitch(nextModel)
                    }
                  }}
                >
                  {supportedModels.map((model) => {
                    const modelName = model.model || "未知模型"
                    const showPricingSummary = model.owner?.type === ConstsOwnerType.OwnerTypePublic
                    const pricing = showPricingSummary ? getModelPricingItem(model.model) : undefined
                    const pricingTags = pricing?.tags ?? []

                    return (
                      <DropdownMenuRadioItem
                        key={model.id || modelName}
                        value={model.id || ""}
                        disabled={!model.id}
                        className="w-full justify-between gap-3 pr-2 [&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <Icon name={getBrandFromModelName(modelName)} className="size-4" />
                          <span className="truncate">{modelName}</span>
                        </div>
                        <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5">
                          {showPricingSummary && pricingTags.map((tag) => (
                            <Badge
                              key={`${model.id}-${tag}`}
                              variant="default"
                              className="shrink-0 !bg-primary !text-primary-foreground"
                            >
                              {tag}
                            </Badge>
                          ))}
                          {model.owner?.type !== ConstsOwnerType.OwnerTypePublic && getOwnerTypeBadge(model.owner)}
                        </div>
                      </DropdownMenuRadioItem>
                    )
                  })}
                </DropdownMenuRadioGroup>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {taskInteractive && hasContextUsage && (
              <HoverCard
                open={contextUsagePopoverOpen}
                onOpenChange={setContextUsagePopoverOpen}
                openDelay={120}
                closeDelay={180}
              >
                <HoverCardTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label="查看上下文使用情况"
                  >
                    <CircularProgress
                      value={contextUsage.used ?? 0}
                      max={contextUsage.size ?? 0}
                      size={20}
                      strokeWidth={3}
                      indicatorClassName={contextProgressClassName}
                    />
                  </button>
                </HoverCardTrigger>
                <HoverCardContent
                  side="bottom"
                  align="start"
                  className="w-90 p-0"
                >
                  <div className="overflow-hidden rounded-md bg-background">
                    <div className="flex items-center gap-3 border-b bg-muted/35 px-3 py-3">
                      <CircularProgress
                        value={contextUsage.used ?? 0}
                        max={contextUsage.size ?? 0}
                        size={24}
                        strokeWidth={3}
                        indicatorClassName={contextProgressClassName}
                      />
                      <div className="min-w-0">
                        <div className={cn("text-sm font-medium", contextProgressClassName)}>
                          上下文已使用 {contextUsagePercent}
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-2.5 text-xs leading-5 text-foreground">
                      上下文过大可能导致 AI 模型响应变慢、token 消耗量增多。
                    </div>
                    <div className="space-y-2 border-t bg-muted/15 p-2">
                      <div className="rounded-md border bg-background px-3 py-2.5 shadow-xs">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium">压缩上下文</div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">
                              尽量保留关键信息，减少上下文占用。
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={contextProgress >= 0.5 ? "default" : "secondary"}
                            className="shrink-0"
                            disabled={!canInput}
                            onClick={handleCompactContext}
                          >
                            压缩
                          </Button>
                        </div>
                      </div>
                      <div className="rounded-md border bg-background px-3 py-2.5 shadow-xs">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium">重置上下文</div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">
                              直接清空当前上下文，重新开始后续对话。
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="shrink-0"
                            disabled={!canInput}
                            onClick={() => {
                              setContextUsagePopoverOpen(false)
                              setResetContextDialogOpen(true)
                            }}
                          >
                            重置
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </HoverCardContent>
              </HoverCard>
            )}
            {totalTokens > 0 && (
              <span className="hidden shrink-0 lg:inline">
                累计消耗 {formatTokens(totalTokens)} tokens
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 min-w-0 px-2 gap-1 text-sm font-normal", terminalPanelOpen && "text-primary bg-accent")}
              onClick={toggleTerminalPanel}
              disabled={!taskInteractive}
            >
              <IconTerminal2 className="size-3.5" />
              终端
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 min-w-0 px-2 gap-1 text-sm font-normal", activeSidePanel === "files" && "text-primary bg-accent")}
              onClick={() => toggleSidePanel("files")}
              disabled={!taskInteractive}
            >
              <IconFile className="size-3.5" />
              文件{fileChangesCount > 0 ? ` (${fileChangesCount})` : ""}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 min-w-0 px-2 gap-1 text-sm font-normal", previewDialogOpen && "text-primary bg-accent")}
              onClick={togglePreviewDialog}
              disabled={!taskInteractive}
            >
              <IconDeviceDesktop className="size-3.5" />
              预览{previewPortCount > 0 ? ` (${previewPortCount})` : ""}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      {detailHeader}
      <AlertDialog
        open={modelSwitchDialogOpen}
        onOpenChange={(open) => {
          if (modelSwitchSubmitting) return
          setModelSwitchDialogOpen(open)
          if (!open) {
            setPendingSwitchModel(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>切换模型</AlertDialogTitle>
            <AlertDialogDescription>
              即将把当前任务模型切换为 {pendingSwitchModel?.model || "所选模型"}。请确认是否继续。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={modelSwitchSubmitting}>取消</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => {
                void handleConfirmModelSwitch()
              }}
              disabled={modelSwitchSubmitting}
            >
              {modelSwitchSubmitting && <Spinner className="mr-2 size-4" />}
              确认切换
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={resetContextDialogOpen}
        onOpenChange={(open) => {
          if (resetContextSubmitting) return
          setResetContextDialogOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置上下文</AlertDialogTitle>
            <AlertDialogDescription>
              确定要重置当前上下文吗？后续操作将会基于新的上下文进行。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetContextSubmitting}>取消</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => {
                void handleConfirmResetContext()
              }}
              disabled={resetContextSubmitting}
            >
              {resetContextSubmitting && <Spinner className="mr-2 size-4" />}
              确认
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {showPreparing ? (
        <TaskPreparingView task={task} />
      ) : (
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel id="top" defaultSize={hasBottomTerminal ? 75 : 100} minSize={30} className="min-h-0">
            <ResizablePanelGroup orientation="horizontal">
              <ResizablePanel id="chat" defaultSize={hasSidePanel ? 50 : 100} minSize={hasSidePanel ? 30 : 100} className="min-w-0">
                <div className={cn("flex flex-col h-full min-h-0 gap-2")}>
                  {/* 消息列表 */}
                  <div ref={chatScrollRootRef} className="flex-1 min-h-0 min-w-0 relative">
                    <ScrollArea className="h-full [&>[data-radix-scroll-area-viewport]>div]:!block">
                      <div
                        ref={chatContentRef}
                        className={cn("min-h-full flex flex-col gap-3", hasSidePanel ? "w-full" : "mx-auto max-w-[800px]")}
                      >
                        {showHistoryLoadButton && (
                          <div className="flex justify-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                              onClick={() => fetchTaskRounds(historyCursor ?? undefined)}
                              disabled={historyLoading}
                            >
                              {!historyLoading && <IconHistory className="size-4" />}
                              {historyLoading && <Spinner className="size-4" />}
                              {historyLoading ? "正在加载" : historyLoaded ? "加载更多" : "加载历史消息"}
                            </Button>
                          </div>
                        )}
                        {messages.length > 0 ? (
                          <div className="flex flex-col gap-1 pb-4">
                            {messages.map((message, index) => (
                              <MessageItem
                                key={message.id}
                                message={message}
                                cli={task?.cli_name}
                                isLatest={index === messages.length - 1}
                              />
                            ))}
                          </div>
                        ) : historyLoaded ? (
                          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">暂无消息</div>
                        ) : null}
                      </div>
                    </ScrollArea>
                    {chatHasOverflow && (
                      <div className="pointer-events-none absolute inset-y-0 left-0 right-0 z-10">
                        <div className={cn("relative h-full", hasSidePanel ? "w-full" : "mx-auto max-w-[800px]")}>
                          <div className="pointer-events-auto absolute top-1/2 right-1 flex -translate-y-1/2 flex-col gap-2">
                            {!chatAtTop && (
                              <Button
                                type="button"
                                size="icon"
                                variant="secondary"
                                className="size-9 rounded-full shadow-md opacity-45 transition-opacity hover:opacity-100 cursor-pointer"
                                onClick={scrollChatToTop}
                                aria-label="滚动到顶部"
                              >
                                <IconArrowUp className="size-4" />
                              </Button>
                            )}
                            {!chatAtBottom && (
                              <Button
                                type="button"
                                size="icon"
                                variant="secondary"
                                className="size-9 rounded-full shadow-md opacity-45 transition-opacity hover:opacity-100 cursor-pointer"
                                onClick={scrollChatToBottom}
                                aria-label="滚动到底部"
                              >
                                <IconArrowDown className="size-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* 输入框 */}
                  <div className={cn("shrink-0", hasSidePanel ? "w-full" : "mx-auto max-w-[800px] w-full")}>
                    {taskInteractive && plan.entries.length > 0 && (
                      <div className="mb-2">
                        <PlanStepsBlock plan={plan} streamStatus={planStreamStatus} />
                      </div>
                    )}
                    {taskInteractive ? (
                      <TaskChatInputBox
                        streamStatus={streamStatus}
                        availableCommands={availableCommands}
                        onSend={handleSend}
                        onCancel={handleCancel}
                        sending={sending}
                        queueSize={0}
                        executionTimeMs={timeCost}
                      />
                    ) : (
                      <div className="flex items-center justify-center w-full border bg-muted/50 rounded-md p-2 text-xs text-muted-foreground">
                        任务已结束
                      </div>
                    )}
                  </div>
                </div>
              </ResizablePanel>
              {hasSidePanel && (
                <>
                  <ResizableHandle withHandle className="ml-2 shrink-0 bg-transparent after:hidden" />
                  <ResizablePanel id="right-panel" defaultSize={50} minSize={25} className="min-w-0">
                    <div className="h-full overflow-hidden flex flex-col">
                      {activeSidePanel === "files" && (
                        <div className="flex-1 min-h-0 overflow-hidden">
                          <TaskFileExplorer
                            disabled={!taskInteractive}
                            repository={taskControlClientRef.current}
                            refreshSignal={fileRefreshSignal}
                            onChangesCountChange={setFileChangesCount}
                            onClosePanel={() => setActiveSidePanel(null)}
                            envid={envid}
                          />
                        </div>
                      )}
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>
          {hasBottomTerminal && (
            <>
              <ResizableHandle withHandle className="mt-2 shrink-0 bg-transparent after:hidden" />
              <ResizablePanel id="bottom-terminal" defaultSize={25} minSize={20} className="min-h-0">
                <div className="h-full w-full border rounded-md overflow-hidden">
                  <TaskTerminalPanel envid={envid} disabled={!taskInteractive} onClosePanel={() => setTerminalPanelOpen(false)} />
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      )}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent>
          <DialogHeader className="flex-row items-center justify-start gap-2 pr-8">
            <DialogTitle>在线预览</DialogTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={() => void fetchPortForwards()}
              disabled={!taskInteractive}
            >
              <IconReload className="size-4" />
            </Button>
          </DialogHeader>
          <TaskPreviewPanel
            ports={previewPorts}
            onRefresh={fetchPortForwards}
            disabled={!taskInteractive}
            embedded
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
