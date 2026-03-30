import { ConstsTaskStatus, type DomainProjectTask, type DomainVMPort, TaskflowVirtualMachineStatus } from "@/api/Api"
import { useBreadcrumbTask } from "@/components/console/breadcrumb-task-context"
import { TaskChatInputBox } from "@/components/console/task/chat-inputbox"
import { TaskControlClient } from "@/components/console/task/task-control-client"
import { TaskChangesPanel } from "@/components/console/task/task-changes-panel"
import { TaskMessageHandler, type TaskMessageHandlerStatus } from "@/components/console/task/task-message-handler"
import { MessageItem, type MessageType } from "@/components/console/task/message"
import { TaskPreparingView, useShouldShowPreparing } from "@/components/console/task/task-preparing-dialog"
import { TaskFileExplorer } from "@/components/console/task/task-file-explorer"
import { TaskPreviewPanel } from "@/components/console/task/task-preview-panel"
import type { AvailableCommands, RepoFileChange } from "@/components/console/task/task-shared"
import { TaskStreamClient, type TaskStreamClientState } from "@/components/console/task/task-stream-client"
import { TaskTerminalPanel } from "@/components/console/task/task-terminal-panel"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { formatTokens } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconDeviceDesktop, IconFile, IconGitBranch, IconHistory, IconTerminal2 } from "@tabler/icons-react"
import React from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"

type PanelType = "files" | "terminal" | "changes" | "preview"

export default function TaskDetailPage() {
  const { taskId } = useParams()
  const { setTaskName } = useBreadcrumbTask() ?? {}
  const [task, setTask] = React.useState<DomainProjectTask | null>(null)
  const [activePanel, setActivePanel] = React.useState<PanelType | null>(null)
  const [streamStatus, setStreamStatus] = React.useState<TaskMessageHandlerStatus>("inited")
  const [availableCommands, setAvailableCommands] = React.useState<AvailableCommands | null>(null)
  const [sending, setSending] = React.useState(false)
  const [historyMessages, setHistoryMessages] = React.useState<MessageType[]>([])
  const [liveMessages, setLiveMessages] = React.useState<MessageType[]>([])
  const [fileChangesMap, setFileChangesMap] = React.useState<Map<string, RepoFileChange>>(new Map())
  const [changedPaths, setChangedPaths] = React.useState<string[]>([])
  const [historyCursor, setHistoryCursor] = React.useState<string | null>(null)
  const [historyHasMore, setHistoryHasMore] = React.useState(true)
  const [historyLoaded, setHistoryLoaded] = React.useState(false)
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [historyCursorReady, setHistoryCursorReady] = React.useState(false)
  const [clientIp, setClientIp] = React.useState<string | null>(null)
  const [clientIpReady, setClientIpReady] = React.useState(false)
  const [previewPorts, setPreviewPorts] = React.useState<DomainVMPort[] | undefined>(undefined)
  const taskControlClientRef = React.useRef<TaskControlClient | null>(null)
  const streamClientRef = React.useRef<TaskStreamClient | null>(null)
  const historyLoadingRef = React.useRef(false)
  const historyLoadedRef = React.useRef(false)
  const showPreparing = useShouldShowPreparing(task)
  const vmOnline = task?.virtualmachine?.status === TaskflowVirtualMachineStatus.VirtualMachineStatusOnline
    || task?.virtualmachine?.status === TaskflowVirtualMachineStatus.VirtualMachineStatusHibernated
  const envid = task?.virtualmachine?.id
  const cancelledRef = React.useRef(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const messages = React.useMemo(() => [...historyMessages, ...liveMessages], [historyMessages, liveMessages])
  const [timeCost, setTimeCost] = React.useState(0)
  const previewPortCount = (previewPorts ?? task?.virtualmachine?.ports ?? []).length

  const hasPanel = activePanel !== null
  const togglePanel = (panel: PanelType) => {
    setActivePanel((prev) => (prev === panel ? null : panel))
  }

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
      setHistoryMessages((prev) => [...prev, ...previousMessages])
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
          setLiveMessages(state.messages)
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
        setLiveMessages(state.messages)
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
  }, [disconnectStreamClient, liveMessages, taskId])

  // taskId 变化时重置状态
  React.useEffect(() => {
    if (!taskId) return
    disconnectStreamClient()
    disposeTaskControlClient()
    setTask(null)
    setActivePanel(null)
    setStreamStatus("inited")
    setAvailableCommands(null)
    setSending(false)
    setHistoryMessages([])
    setLiveMessages([])
    setFileChangesMap(new Map())
    setChangedPaths([])
    setHistoryCursor(null)
    setHistoryHasMore(true)
    setHistoryLoaded(false)
    setHistoryCursorReady(false)
    historyLoadedRef.current = false
    setHistoryLoading(false)
    setClientIp(null)
    setClientIpReady(false)
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

  const fetchFileChanges = React.useCallback(async () => {
    const changes = await taskControlClientRef.current?.getFileChanges()
    if (cancelledRef.current || changes === null || changes === undefined) return

    const nextMap = new Map<string, RepoFileChange>()
    const nextPaths: string[] = []
    changes.forEach((change) => {
      nextMap.set(change.path, change)
      nextPaths.push(change.path)
    })

    setFileChangesMap(nextMap)
    setChangedPaths(nextPaths)
  }, [])

  const fetchPortForwards = React.useCallback(async () => {
    const ports = await taskControlClientRef.current?.getPortForwardList()
    if (cancelledRef.current || ports === null || ports === undefined) return

    setPreviewPorts(ports.map((port) => ({
      port: port.port,
      status: port.status as DomainVMPort["status"],
      forward_id: port.forward_id ?? undefined,
      preview_url: port.access_url ?? undefined,
      error_message: port.error_message ?? undefined,
      white_list: port.whitelist_ips,
      success: true,
    })))
  }, [])

  React.useEffect(() => {
    if (!taskId) return

    let active = true
    setClientIp(null)
    setClientIpReady(false)

    fetch("https://monkeycode-ai.online/get-my-ip", {
      method: "GET",
      mode: "cors",
    })
      .then(async (resp) => {
        if (!resp.ok) return null
        const data = await resp.json()
        return typeof data?.ip === "string" ? data.ip : null
      })
      .then((ip) => {
        if (!active) return
        setClientIp(ip)
        setClientIpReady(true)
      })
      .catch((error) => {
        console.error("获取客户端 IP 失败", error)
        if (!active) return
        setClientIp(null)
        setClientIpReady(true)
      })

    return () => {
      active = false
    }
  }, [taskId])

  React.useEffect(() => {
    if (!taskId || !clientIpReady) return

    const client = new TaskControlClient({
      taskId,
      clientIp,
    })
    taskControlClientRef.current = client
    client.connect()

    return () => {
      if (taskControlClientRef.current === client) {
        taskControlClientRef.current = null
      }
      client.dispose()
    }
  }, [clientIp, clientIpReady, taskId])

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
          setHistoryMessages((prev) => [...messageState.messages, ...prev])
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
    if (!vmOnline || activePanel !== "changes") return
    fetchFileChanges()
  }, [activePanel, fetchFileChanges, vmOnline])

  React.useEffect(() => {
    if (!vmOnline || activePanel !== "preview") return
    fetchPortForwards()
  }, [activePanel, fetchPortForwards, vmOnline])

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

  return (
    <div className="flex flex-col h-full min-h-0">
      {showPreparing ? (
        <TaskPreparingView task={task} />
      ) : (
        <ResizablePanelGroup direction="horizontal" className="gap-2">
          <ResizablePanel id="chat" order={1} defaultSize={hasPanel ? 50 : 100} minSize={hasPanel ? 30 : 100} className="min-w-0">
            <div className={cn("flex flex-col h-full min-h-0 gap-2")}>
              {/* 消息列表 */}
              <div className="flex-1 min-h-0 overflow-y-auto min-w-0">
                <div className={cn("min-h-full flex flex-col gap-3", hasPanel ? "w-full" : "mx-auto max-w-[800px]")}>
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
              </div>
              {/* 输入框 */}
              <div className={cn("shrink-0", hasPanel ? "w-full" : "mx-auto max-w-[800px] w-full")}>
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
              {/* 底部工具栏 */}
              <div className="shrink-0">
                <div className={cn(hasPanel ? "max-w-full" : "mx-auto max-w-[800px]")}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn("h-6 min-w-0 px-2 gap-1 text-xs font-normal", activePanel === "files" && "text-primary bg-accent")}
                        onClick={() => togglePanel("files")}
                        disabled={!vmOnline}
                      >
                        <IconFile className="size-3.5" />
                        文件
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn("h-6 min-w-0 px-2 gap-1 text-xs font-normal", activePanel === "terminal" && "text-primary bg-accent")}
                        onClick={() => togglePanel("terminal")}
                        disabled={!vmOnline}
                      >
                        <IconTerminal2 className="size-3.5" />
                        终端
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn("h-6 min-w-0 px-2 gap-1 text-xs font-normal", activePanel === "changes" && "text-primary bg-accent")}
                        onClick={() => togglePanel("changes")}
                        disabled={!vmOnline}
                      >
                        <IconGitBranch className="size-3.5" />
                        修改{changedPaths.length > 0 ? ` (${changedPaths.length})` : ""}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn("h-6 min-w-0 px-2 gap-1 text-xs font-normal", activePanel === "preview" && "text-primary bg-accent")}
                        onClick={() => togglePanel("preview")}
                        disabled={!vmOnline}
                      >
                        <IconDeviceDesktop className="size-3.5" />
                        预览{previewPortCount > 0 ? ` (${previewPortCount})` : ""}
                      </Button>
                    </div>
                    {(task?.stats?.input_tokens != null || task?.stats?.output_tokens != null || task?.stats?.total_tokens != null) && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        <span className="sm:hidden">
                          {formatTokens(task?.stats?.total_tokens ?? ((task?.stats?.input_tokens ?? 0) + (task?.stats?.output_tokens ?? 0)))} tokens
                        </span>
                        <span className="hidden sm:inline">
                          输入 {formatTokens(task?.stats?.input_tokens) || "-"} / 输出 {formatTokens(task?.stats?.output_tokens) || "-"} tokens
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </ResizablePanel>
          {hasPanel && (
            <>
              <ResizableHandle withHandle className="shrink-0" />
              <ResizablePanel id="right-panel" order={2} defaultSize={50} minSize={30} className="min-w-0">
                <div className="h-full overflow-hidden flex flex-col">
                  {activePanel === "files" && (
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <TaskFileExplorer
                        disabled={!vmOnline}
                        streamStatus={streamStatus}
                        fileChangesMap={fileChangesMap}
                        changedPaths={changedPaths}
                        taskManager={taskControlClientRef.current}
                        onRefresh={fetchFileChanges}
                        onClosePanel={() => setActivePanel(null)}
                        envid={envid}
                      />
                    </div>
                  )}
                  {activePanel === "terminal" && (
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <div className="h-full w-full border rounded-md overflow-hidden">
                        <TaskTerminalPanel envid={envid} disabled={!vmOnline} onClosePanel={() => setActivePanel(null)} />
                      </div>
                    </div>
                  )}
                  {activePanel === "changes" && (
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <TaskChangesPanel
                        fileChanges={changedPaths}
                        fileChangesMap={fileChangesMap}
                        taskManager={taskControlClientRef.current}
                        disabled={!vmOnline}
                        onRefresh={fetchFileChanges}
                        onClosePanel={() => setActivePanel(null)}
                      />
                    </div>
                  )}
                  {activePanel === "preview" && (
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <TaskPreviewPanel
                        ports={previewPorts ?? task?.virtualmachine?.ports}
                        hostId={task?.virtualmachine?.host?.id}
                        vmId={task?.virtualmachine?.id}
                        onSuccess={fetchPortForwards}
                        onRefresh={fetchPortForwards}
                        disabled={!vmOnline}
                        onClosePanel={() => setActivePanel(null)}
                      />
                    </div>
                  )}
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      )}
    </div>
  )
}
