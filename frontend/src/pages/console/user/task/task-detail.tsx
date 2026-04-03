import { ConstsTaskStatus, type DomainProjectTask, type DomainVMPort, TaskflowVirtualMachineStatus } from "@/api/Api"
import { useBreadcrumbTask } from "@/components/console/breadcrumb-task-context"
import { TaskChatInputBox } from "@/components/console/task/chat-inputbox"
import { TaskControlClient } from "@/components/console/task/task-control-client"
import { TaskMessageHandler, type TaskMessageHandlerStatus } from "@/components/console/task/task-message-handler"
import { MessageItem, type MessageType } from "@/components/console/task/message"
import { TaskPreparingView, useShouldShowPreparing } from "@/components/console/task/task-preparing-dialog"
import { TaskFileExplorer } from "@/components/console/task/task-file-explorer"
import { TaskPreviewPanel } from "@/components/console/task/task-preview-panel"
import type { AvailableCommands } from "@/components/console/task/task-shared"
import { TaskStreamClient, type TaskStreamClientState } from "@/components/console/task/task-stream-client"
import { TaskTerminalPanel } from "@/components/console/task/task-terminal-panel"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { formatTokens } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconArrowDown, IconArrowUp, IconDeviceDesktop, IconFile, IconHistory, IconReload, IconTerminal2 } from "@tabler/icons-react"
import React from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"

type SidePanelType = "files"

export default function TaskDetailPage() {
  const { taskId } = useParams()
  const { setTaskName } = useBreadcrumbTask() ?? {}
  const [task, setTask] = React.useState<DomainProjectTask | null>(null)
  const [activeSidePanel, setActiveSidePanel] = React.useState<SidePanelType | null>(null)
  const [terminalPanelOpen, setTerminalPanelOpen] = React.useState(false)
  const [previewDialogOpen, setPreviewDialogOpen] = React.useState(false)
  const [streamStatus, setStreamStatus] = React.useState<TaskMessageHandlerStatus>("inited")
  const [availableCommands, setAvailableCommands] = React.useState<AvailableCommands | null>(null)
  const [sending, setSending] = React.useState(false)
  const [historyMessages, setHistoryMessages] = React.useState<MessageType[]>([])
  const [liveMessages, setLiveMessages] = React.useState<MessageType[]>([])
  const [fileChangesCount, setFileChangesCount] = React.useState(0)
  const [fileRefreshSignal, setFileRefreshSignal] = React.useState(0)
  const [historyCursor, setHistoryCursor] = React.useState<string | null>(null)
  const [historyHasMore, setHistoryHasMore] = React.useState(true)
  const [historyLoaded, setHistoryLoaded] = React.useState(false)
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [historyCursorReady, setHistoryCursorReady] = React.useState(false)
  const [previewPorts, setPreviewPorts] = React.useState<DomainVMPort[] | undefined>(undefined)
  const [chatHasOverflow, setChatHasOverflow] = React.useState(false)
  const [chatAtTop, setChatAtTop] = React.useState(true)
  const [chatAtBottom, setChatAtBottom] = React.useState(true)
  const taskControlClientRef = React.useRef<TaskControlClient | null>(null)
  const streamClientRef = React.useRef<TaskStreamClient | null>(null)
  const historyLoadingRef = React.useRef(false)
  const historyLoadedRef = React.useRef(false)
  const chatScrollRef = React.useRef<HTMLDivElement | null>(null)
  const chatContentRef = React.useRef<HTMLDivElement | null>(null)
  const autoScrollFrameRef = React.useRef<number | null>(null)
  const previousRunningMessagesSignatureRef = React.useRef<string | null>(null)
  const activeSidePanelRef = React.useRef<SidePanelType | null>(null)
  const previewDialogOpenRef = React.useRef(false)
  const showPreparing = useShouldShowPreparing(task)
  const vmOnline = task?.virtualmachine?.status === TaskflowVirtualMachineStatus.VirtualMachineStatusOnline
    || task?.virtualmachine?.status === TaskflowVirtualMachineStatus.VirtualMachineStatusHibernated
  const envid = task?.virtualmachine?.id
  const cancelledRef = React.useRef(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const messages = React.useMemo(() => [...historyMessages, ...liveMessages], [historyMessages, liveMessages])
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
  const [timeCost, setTimeCost] = React.useState(0)
  const previewPortCount = (previewPorts ?? []).length
  const totalTokens = task?.stats?.total_tokens ?? ((task?.stats?.input_tokens ?? 0) + (task?.stats?.output_tokens ?? 0))

  const hasSidePanel = activeSidePanel !== null
  const hasBottomTerminal = terminalPanelOpen

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

  const attachMessageHandlers = React.useCallback((messages: MessageType[]) => {
    return messages.map((message) => {
      if (message.type !== "ask_user_question") {
        return message
      }

      return {
        ...message,
        onResponseAskUserQuestion: (askId: string, answers: unknown) => {
          if (!askId) {
            return
          }

          const streamClient = streamClientRef.current
          if (!streamClient) {
            toast.error("当前连接不可用，无法提交回答")
            return
          }

          streamClient.sendReplyQuestion(askId, answers)
        },
      }
    })
  }, [])

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
    if (!taskId) return

    const previousState = disconnectStreamClient()
    const previousMessages = previousState?.messages ?? liveMessages
    if (mode === "new" && previousMessages.length > 0) {
      setHistoryMessages((prev) => [...prev, ...attachMessageHandlers(previousMessages)])
      setLiveMessages([])
    }

    setAvailableCommands(null)
    setStreamStatus("inited")
    setSending(mode === "new")
    setTimeCost(0)

    const client = mode === "attach"
      ? TaskStreamClient.attach({
        taskId,
        onStateChange: (state: TaskStreamClientState) => {
          if (streamClientRef.current !== client || cancelledRef.current) return
          setStreamStatus(state.status)
          setLiveMessages(attachMessageHandlers(state.messages))
          setAvailableCommands(state.availableCommands)
          setTimeCost(state.executionTimeMs)
          if (!historyLoadedRef.current && state.historyCursor.ready) {
            setHistoryCursorReady(true)
            setHistoryCursor(state.historyCursor.cursor)
            setHistoryHasMore(state.historyCursor.hasMore)
          }
        },
        onOpen: () => {
          if (streamClientRef.current !== client || cancelledRef.current) return
          setSending(false)
        },
        onClose: () => {
          if (streamClientRef.current === client) {
            streamClientRef.current = null
          }
          if (!cancelledRef.current) {
            setSending(false)
          }
        },
        onError: () => {
          if (streamClientRef.current !== client || cancelledRef.current) return
          setSending(false)
        },
      })
      : TaskStreamClient.new({
      taskId,
      onStateChange: (state: TaskStreamClientState) => {
        if (streamClientRef.current !== client || cancelledRef.current) return
        setStreamStatus(state.status)
        setLiveMessages(attachMessageHandlers(state.messages))
        setAvailableCommands(state.availableCommands)
        setTimeCost(state.executionTimeMs)
      },
      onOpen: () => {
        if (streamClientRef.current !== client || cancelledRef.current) return
        setSending(false)
      },
      onClose: () => {
        if (streamClientRef.current === client) {
          streamClientRef.current = null
        }
        if (!cancelledRef.current) {
          setSending(false)
        }
      },
      onError: () => {
        if (streamClientRef.current !== client || cancelledRef.current) return
        setSending(false)
      },
      userInput: userInput ?? "",
    })

    streamClientRef.current = client
    client.connect()
  }, [attachMessageHandlers, disconnectStreamClient, liveMessages, taskId])

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
    setSending(false)
    setHistoryMessages([])
    setLiveMessages([])
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
    if (!taskId) return

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
  }, [applyRepoFileChange, handlePortChange, taskId])

  const scheduleFetchTaskDetail = React.useCallback(async () => {
    const currentTask = await fetchTaskDetail()
    if (cancelledRef.current) return
    const vmStatus = currentTask?.virtualmachine?.status
    let delay = 30000
    if (vmStatus === TaskflowVirtualMachineStatus.VirtualMachineStatusPending) {
      delay = 2000
    } else if (vmStatus === TaskflowVirtualMachineStatus.VirtualMachineStatusOnline) {
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
          setHistoryMessages((prev) => [...attachMessageHandlers(messageState.messages), ...prev])
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
  }, [attachMessageHandlers, taskId])

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
      const name = task.summary || task.content
      setTaskName(name?.trim() || "未知任务名称")
    }
    return () => setTaskName?.(null)
  }, [task, setTaskName])

  React.useEffect(() => {
    if (!taskId || !task) return
    if (streamStatus !== "inited") return
    if (streamClientRef.current) return
    if (task.status !== ConstsTaskStatus.TaskStatusProcessing) return
    if (task.virtualmachine?.status === TaskflowVirtualMachineStatus.VirtualMachineStatusPending) return
    connectStreamClient("attach")
  }, [connectStreamClient, streamStatus, task, taskId])

  React.useEffect(() => {
    if (!task) return
    if (historyLoaded || historyLoading) return
    if (liveMessages.length > 0) return
    if (
      task.status !== ConstsTaskStatus.TaskStatusFinished
      && task.status !== ConstsTaskStatus.TaskStatusError
    ) {
      return
    }
    fetchTaskRounds()
  }, [fetchTaskRounds, historyLoaded, historyLoading, liveMessages.length, task])

  React.useEffect(() => {
    if (!vmOnline || !previewDialogOpen) return
    fetchPortForwards()
  }, [fetchPortForwards, previewDialogOpen, vmOnline])

  const handleSend = React.useCallback((content: string) => {
    if (!taskId) return
    connectStreamClient("new", content)
  }, [connectStreamClient, taskId])

  const handleCancel = React.useCallback(() => {
    streamClientRef.current?.sendCancel()
  }, [])

  const handleResetSession = React.useCallback(() => {
    taskControlClientRef.current?.restart(false)
  }, [])

  const handleReloadSession = React.useCallback(() => {
    taskControlClientRef.current?.restart(true)
  }, [])

  const showHistoryLoadButton = historyCursorReady && (!historyLoaded || historyHasMore)

  const updateChatScrollState = React.useCallback(() => {
    const container = chatScrollRef.current
    if (!container) return

    const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
    const hasOverflow = maxScrollTop > 4

    setChatHasOverflow(hasOverflow)
    setChatAtTop(!hasOverflow || container.scrollTop <= 8)
    setChatAtBottom(!hasOverflow || maxScrollTop - container.scrollTop <= 8)
  }, [])

  React.useEffect(() => {
    const container = chatScrollRef.current
    const content = chatContentRef.current
    if (!container) return

    const handleScroll = () => updateChatScrollState()
    container.addEventListener("scroll", handleScroll, { passive: true })

    const resizeObserver = new ResizeObserver(() => {
      updateChatScrollState()
    })
    resizeObserver.observe(container)
    if (content) {
      resizeObserver.observe(content)
    }

    updateChatScrollState()

    return () => {
      container.removeEventListener("scroll", handleScroll)
      resizeObserver.disconnect()
    }
  }, [updateChatScrollState])

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updateChatScrollState()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages, hasSidePanel, hasBottomTerminal, historyLoading, historyLoaded, showHistoryLoadButton, updateChatScrollState])

  const scrollChatToTop = React.useCallback(() => {
    chatScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }, [])

  const scrollChatToBottom = React.useCallback(() => {
    const container = chatScrollRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
  }, [])

  React.useEffect(() => {
    if (historyLoading) return
    if (previousRunningMessagesSignatureRef.current === runningMessagesSignature) return

    previousRunningMessagesSignatureRef.current = runningMessagesSignature

    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current)
    }

    autoScrollFrameRef.current = window.requestAnimationFrame(() => {
      autoScrollFrameRef.current = null
      const container = chatScrollRef.current
      if (!container) return
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
    })

    return () => {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current)
        autoScrollFrameRef.current = null
      }
    }
  }, [historyLoading, runningMessagesSignature])

  const detailHeader = (
    <div className="shrink-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Badge variant="outline" className="shrink-0">{task?.model?.model}</Badge>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {totalTokens > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">
              <span className="sm:hidden">
                {formatTokens(totalTokens)} tokens
              </span>
              <span className="hidden sm:inline">
                输入 {formatTokens(task?.stats?.input_tokens) || "-"} / 输出 {formatTokens(task?.stats?.output_tokens) || "-"} tokens
              </span>
            </span>
          )}
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 min-w-0 px-2 gap-1 text-xs font-normal", terminalPanelOpen && "text-primary bg-accent")}
              onClick={toggleTerminalPanel}
              disabled={!vmOnline}
            >
              <IconTerminal2 className="size-3.5" />
              终端
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 min-w-0 px-2 gap-1 text-xs font-normal", activeSidePanel === "files" && "text-primary bg-accent")}
              onClick={() => toggleSidePanel("files")}
              disabled={!vmOnline}
            >
              <IconFile className="size-3.5" />
              文件{fileChangesCount > 0 ? ` (${fileChangesCount})` : ""}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 min-w-0 px-2 gap-1 text-xs font-normal", previewDialogOpen && "text-primary bg-accent")}
              onClick={togglePreviewDialog}
              disabled={!vmOnline}
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
      {showPreparing ? (
        <TaskPreparingView task={task} />
      ) : (
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel id="top" order={1} defaultSize={hasBottomTerminal ? 75 : 100} minSize={30} className="min-h-0">
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel id="chat" order={1} defaultSize={hasSidePanel ? 50 : 100} minSize={hasSidePanel ? 30 : 100} className="min-w-0">
                <div className={cn("flex flex-col h-full min-h-0 gap-2")}>
                  {/* 消息列表 */}
                  <div className="flex-1 min-h-0 min-w-0 relative">
                    <ScrollArea className="h-full [&>[data-radix-scroll-area-viewport]>div]:!block" viewportRef={chatScrollRef}>
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
                    {vmOnline ? (
                      <TaskChatInputBox
                        streamStatus={streamStatus}
                        availableCommands={availableCommands}
                        onSend={handleSend}
                        onCancel={handleCancel}
                        sending={sending}
                        queueSize={0}
                        executionTimeMs={timeCost}
                        sendResetSession={handleResetSession}
                        sendReloadSession={handleReloadSession}
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
                  <ResizablePanel id="right-panel" order={2} defaultSize={50} minSize={25} className="min-w-0">
                    <div className="h-full overflow-hidden flex flex-col">
                      {activeSidePanel === "files" && (
                        <div className="flex-1 min-h-0 overflow-hidden">
                          <TaskFileExplorer
                            disabled={!vmOnline}
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
              <ResizablePanel id="bottom-terminal" order={2} defaultSize={25} minSize={20} className="min-h-0">
                <div className="h-full w-full border rounded-md overflow-hidden">
                  <TaskTerminalPanel envid={envid} disabled={!vmOnline} onClosePanel={() => setTerminalPanelOpen(false)} />
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
              disabled={!vmOnline}
            >
              <IconReload className="size-4" />
            </Button>
          </DialogHeader>
          <TaskPreviewPanel
            ports={previewPorts}
            onRefresh={fetchPortForwards}
            disabled={!vmOnline}
            embedded
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
