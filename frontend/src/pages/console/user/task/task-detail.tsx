import { ConstsTaskStatus, type DomainProjectTask } from "@/api/Api"
import { useBreadcrumbTask } from "@/components/console/breadcrumb-task-context"
import { FileChangesPromptBlock, PlanStepsBlock, TaskChatPanel } from "@/components/console/task/chat-panel"
import { TaskFileExplorer } from "@/components/console/task/task-file-explorer"
import { TaskTerminalPanel } from "@/components/console/task/task-terminal-panel"
import type { MessageType } from "@/components/console/task/message"
import { TaskWebSocketManager, type AvailableCommands, type RepoFileChange, type TaskPlan, type TaskStreamStatus, type TaskWebSocketState } from "@/components/console/task/ws-manager"
import { TaskChangesPanel } from "@/components/console/task/task-changes-panel"
import { TaskPreviewPanel } from "@/components/console/task/task-preview-panel"
import { TaskPreparingView, useShouldShowPreparing } from "@/components/console/task/task-preparing-dialog"
import { type PanelType } from "@/components/console/task/task-chat-section"
import { VmRenewDialog } from "@/components/console/vm/vm-renew"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { apiRequest } from "@/utils/requestUtils"
import { IconClockHour4, IconDeviceDesktop, IconFile, IconGitBranch, IconTerminal2 } from "@tabler/icons-react"
import React from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { TypesVirtualMachineStatus } from "@/api/Api"

function PanelButton({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
  urgent,
}: {
  active: boolean
  disabled: boolean
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  urgent?: boolean
}) {
  const button = (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-6 min-w-0 px-2 gap-1 text-xs font-normal", active && "text-primary bg-accent", urgent && "animate-text-flash")}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="size-3.5" />
      {label}
    </Button>
  )
  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{button}</span>
        </TooltipTrigger>
        <TooltipContent>任务已结束，无法查看</TooltipContent>
      </Tooltip>
    )
  }
  return button
}

const formatTokens = (tokens?: number) => {
  if (tokens === undefined || tokens === null) return ""
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`
  return tokens.toString()
}

export default function TaskDetailPage() {
  const { taskId } = useParams()
  const { setTaskName } = useBreadcrumbTask() ?? {}
  const [task, setTask] = React.useState<DomainProjectTask | null>(null)
  const [activePanel, setActivePanel] = React.useState<PanelType | null>(null)
  const [fileChangesMap, setFileChangesMap] = React.useState<Map<string, RepoFileChange>>(new Map())
  const [changedPaths, setChangedPaths] = React.useState<string[]>([])
  const [streamStatus, setStreamStatus] = React.useState<TaskStreamStatus>("inited")
  const [messages, setMessages] = React.useState<MessageType[]>([])
  const [plan, setPlan] = React.useState<TaskPlan | null>(null)
  const [availableCommands, setAvailableCommands] = React.useState<AvailableCommands | null>(null)
  const [sending, setSending] = React.useState(false)
  const [queueSize, setQueueSize] = React.useState(0)
  const taskManager = React.useRef<TaskWebSocketManager | null>(null)
  const connectedRef = React.useRef(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = React.useRef(false)
  const planVersionRef = React.useRef<number | undefined>(undefined)
  const availableCommandsVersionRef = React.useRef<number | undefined>(undefined)
  const fileChangesVersionRef = React.useRef<number | undefined>(undefined)
  const chatScrollRef = React.useRef<HTMLDivElement>(null)
  const chatInputRef = React.useRef<HTMLDivElement>(null)
  const [, setInputTargetReady] = React.useState(0)
  const chatInputRefCallback = React.useCallback((el: HTMLDivElement | null) => {
    (chatInputRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    if (el) setInputTargetReady((c) => c + 1)
  }, [])

  const vmOnline = task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusOnline
  const envid = task?.virtualmachine?.id
  const showPreparing = useShouldShowPreparing(task)

  // taskId 变化时重置所有状态，保证页面可重入
  React.useEffect(() => {
    if (!taskId) return
    setTask(null)
    setActivePanel(null)
    setFileChangesMap(new Map())
    setChangedPaths([])
    setStreamStatus("inited")
    setMessages([])
    setPlan(null)
    setAvailableCommands(null)
    setSending(false)
    setQueueSize(0)
    setRenewDialogOpen(false)
    planVersionRef.current = undefined
    availableCommandsVersionRef.current = undefined
    fileChangesVersionRef.current = undefined
  }, [taskId])

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

  const scheduleFetchTaskDetail = React.useCallback(async () => {
    const currentTask = await fetchTaskDetail()
    if (cancelledRef.current) return
    const vmStatus = currentTask?.virtualmachine?.status
    let delay = 1000
    switch (vmStatus) {
      case TypesVirtualMachineStatus.VirtualMachineStatusPending:
        delay = 2000
        break
      case TypesVirtualMachineStatus.VirtualMachineStatusOnline:
        delay = 10000
        break
      case TypesVirtualMachineStatus.VirtualMachineStatusOffline:
        delay = 30000
        break
      default:
        delay = 5000
    }
    timeoutRef.current = setTimeout(scheduleFetchTaskDetail, delay)
  }, [fetchTaskDetail])

  const fetchFileChanges = React.useCallback(() => {
    taskManager.current?.getFileChanges().then((changes: RepoFileChange[] | null) => {
      if (changes === null) return
      const newMap = new Map<string, RepoFileChange>()
      const newPaths: string[] = []
      changes.forEach((change) => {
        newMap.set(change.path, change)
        newPaths.push(change.path)
      })
      setFileChangesMap(newMap)
      setChangedPaths(newPaths)
    })
  }, [])

  const updateTaskState = (state: TaskWebSocketState) => {
    setStreamStatus(state.status)
    setMessages([...state.messages])
    setSending(state.sending)
    setQueueSize(state.queueSize)
    if (state.plan.version !== planVersionRef.current) {
      planVersionRef.current = state.plan.version
      setPlan(state.plan)
    }
    if (state.availableCommands.version !== availableCommandsVersionRef.current) {
      availableCommandsVersionRef.current = state.availableCommands.version
      setAvailableCommands(state.availableCommands)
    }
    if (state.fileChanges.version !== fileChangesVersionRef.current) {
      fileChangesVersionRef.current = state.fileChanges.version
      fetchFileChanges()
    }
  }

  const sendUserInput = React.useCallback((content: string) => {
    taskManager.current?.sendUserInput(content)
  }, [])

  const sendCancelCommand = React.useCallback(() => {
    taskManager.current?.sendCancelCommand()
  }, [])

  const sendResetSession = React.useCallback(() => {
    taskManager.current?.sendResetSession()
  }, [])

  const sendReloadSession = React.useCallback(() => {
    taskManager.current?.sendReloadSession()
  }, [])

  // 定时获取任务详情
  React.useEffect(() => {
    if (!taskId) return
    cancelledRef.current = false
    scheduleFetchTaskDetail()
    return () => {
      cancelledRef.current = true
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [taskId, scheduleFetchTaskDetail])

  React.useEffect(() => {
    if (!setTaskName) return
    if (task) {
      const name = task.summary || task.content
      setTaskName(name?.trim() || "未知任务名称")
    }
    return () => setTaskName?.(null)
  }, [task, setTaskName])

  React.useEffect(() => {
    if (!taskId) return
    connectedRef.current = false
    const manager = new TaskWebSocketManager(taskId, updateTaskState, false, false)
    taskManager.current = manager
    return () => {
      manager.disconnect()
      taskManager.current = null
      connectedRef.current = false
    }
  }, [taskId])

  React.useEffect(() => {
    if (!taskManager.current || connectedRef.current) return
    if (task?.virtualmachine?.status !== undefined && task?.virtualmachine?.status !== TypesVirtualMachineStatus.VirtualMachineStatusPending) {
      taskManager.current.connect()
      connectedRef.current = true
    }
  }, [task?.virtualmachine?.status])

  React.useEffect(() => {
    if (vmOnline && (streamStatus === "waiting" || streamStatus === "executing")) {
      fetchFileChanges()
    }
  }, [vmOnline, streamStatus, fetchFileChanges])

  const hasPanel = activePanel !== null
  const togglePanel = (panel: PanelType) => {
    setActivePanel((prev) => (prev === panel ? null : panel))
  }

  const panelsDisabled = task?.status !== ConstsTaskStatus.TaskStatusProcessing
  const [renewDialogOpen, setRenewDialogOpen] = React.useState(false)

  const chatSection = (
    <div className={cn("flex flex-col h-full min-h-0 gap-2", hasPanel ? "max-w-full" : "")}>
      <div ref={chatScrollRef} className={cn("flex-1 min-h-0 overflow-y-auto min-w-0", !hasPanel && "scrollbar-gutter-stable")}>
        <div className={cn("min-h-full", hasPanel ? "w-full" : "mx-auto max-w-[800px]")}>
          <TaskChatPanel
            scrollContainerRef={chatScrollRef}
            inputPortalTargetRef={chatInputRef}
            messages={messages}
            cli={task?.cli_name}
            availableCommands={availableCommands}
            streamStatus={streamStatus}
            disabled={!vmOnline}
            sending={sending}
            sendUserInput={sendUserInput}
            sendCancelCommand={sendCancelCommand}
            sendResetSession={sendResetSession}
            sendReloadSession={sendReloadSession}
            queueSize={queueSize}
          />
        </div>
      </div>
      {plan && plan.entries.length > 0 && (
        <div className={cn("shrink-0", hasPanel ? "w-full" : "mx-auto max-w-[800px] w-full")}>
          <PlanStepsBlock plan={plan} streamStatus={streamStatus} />
        </div>
      )}
      {changedPaths.length > 0 && (
        <div className={cn("shrink-0", hasPanel ? "w-full" : "mx-auto max-w-[800px] w-full")}>
          <FileChangesPromptBlock
            fileChanges={changedPaths}
            fileChangesMap={fileChangesMap}
            taskManager={taskManager.current}
            sendUserInput={sendUserInput}
            disabled={!vmOnline}
            streamStatus={streamStatus}
          />
        </div>
      )}
      <div ref={chatInputRefCallback} className={cn("shrink-0 bg-background w-full", hasPanel ? "max-w-full" : "mx-auto max-w-[800px]")} />
      <div className="shrink-0 bg-background">
        <div className={cn("flex flex-col gap-2", hasPanel ? "max-w-full" : "mx-auto max-w-[800px]")}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-0.5">
              <PanelButton
                active={activePanel === "files"}
                disabled={panelsDisabled}
                icon={IconFile}
                label="文件"
                onClick={() => togglePanel("files")}
              />
              <PanelButton
                active={activePanel === "terminal"}
                disabled={panelsDisabled}
                icon={IconTerminal2}
                label="终端"
                onClick={() => togglePanel("terminal")}
              />
              <PanelButton
                active={activePanel === "changes"}
                disabled={panelsDisabled}
                icon={IconGitBranch}
                label={`修改${changedPaths.length > 0 ? `(${changedPaths.length})` : ""}`}
                onClick={() => togglePanel("changes")}
              />
              <PanelButton
                active={activePanel === "preview"}
                disabled={panelsDisabled}
                icon={IconDeviceDesktop}
                label={`预览${(task?.virtualmachine?.ports?.length ?? 0) > 0 ? `(${task?.virtualmachine?.ports?.length})` : ""}`}
                onClick={() => togglePanel("preview")}
              />
              <PanelButton
                active={false}
                disabled={!vmOnline}
                icon={IconClockHour4}
                label="续期"
                onClick={() => setRenewDialogOpen(true)}
                urgent={vmOnline && (task?.virtualmachine?.life_time_seconds ?? Infinity) < 3600 && (task?.virtualmachine?.life_time_seconds ?? 0) !== 0}
              />
            </div>
            {(task?.stats?.input_tokens != null || task?.stats?.output_tokens != null || task?.stats?.total_tokens != null) ? (
              <span className="text-xs text-muted-foreground shrink-0">
                <span className="sm:hidden">
                  {formatTokens(task?.stats?.total_tokens ?? ((task?.stats?.input_tokens ?? 0) + (task?.stats?.output_tokens ?? 0)))} tokens
                </span>
                <span className="hidden sm:inline">
                  输入 {formatTokens(task?.stats?.input_tokens) || "-"} / 输出 {formatTokens(task?.stats?.output_tokens) || "-"} tokens
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      {showPreparing ? (
        <TaskPreparingView task={task} />
      ) : (
        <ResizablePanelGroup direction="horizontal" className="gap-2">
          <ResizablePanel id="chat" order={1} defaultSize={hasPanel ? 50 : 100} minSize={hasPanel ? 30 : 100} className="min-w-0">
            {chatSection}
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
                        taskManager={taskManager.current}
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
                        taskManager={taskManager.current}
                        disabled={!vmOnline}
                        onClosePanel={() => setActivePanel(null)}
                      />
                    </div>
                  )}
                  {activePanel === "preview" && (
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <TaskPreviewPanel
                        ports={task?.virtualmachine?.ports}
                        hostId={task?.virtualmachine?.host?.id}
                        vmId={task?.virtualmachine?.id}
                        onSuccess={fetchTaskDetail}
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
      <VmRenewDialog
        open={renewDialogOpen}
        onOpenChange={setRenewDialogOpen}
        hostId={task?.virtualmachine?.host?.id}
        vmId={task?.virtualmachine?.id}
        onSuccess={fetchTaskDetail}
      />
    </div>
  )
}
