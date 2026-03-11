import { TypesVirtualMachineStatus, type DomainProjectTask } from "@/api/Api"
import { FileChangesPanel } from "@/components/console/task/file-changes-panel"
import { ChatPanelVm } from "@/components/console/task/chat-panel-vm"
import { FileTreeVm } from "@/components/console/task/file-tree-vm"
import { TerminalPanelVm } from "@/components/console/task/terminal-panel-vm"
import {
  TaskWebSocketManager,
  type AvailableCommands,
  type RepoFileChange,
  type TaskPlan,
  type TaskStreamStatus,
  type TaskWebSocketState,
} from "@/components/console/task/ws-manager"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { stripMarkdown } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { Badge } from "@/components/ui/badge"
import { IconFileDiff, IconFolderOpen, IconTerminal2 } from "@tabler/icons-react"
import React from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"

export default function TaskDevelopNewPage() {
  const { taskId } = useParams()
  const [task, setTask] = React.useState<DomainProjectTask | null>(null)
  const taskManager = React.useRef<TaskWebSocketManager | null>(null)
  const connectedRef = React.useRef(false)
  const [streamStatus, setStreamStatus] = React.useState<TaskStreamStatus>("inited")
  const [messages, setMessages] = React.useState<Parameters<typeof ChatPanelVm>[0]["messages"]>([])
  const [thinkingMessage, setThinkingMessage] = React.useState("")
  const [plan, setPlan] = React.useState<TaskPlan | null>(null)
  const [availableCommands, setAvailableCommands] = React.useState<AvailableCommands | null>(null)
  const [fileChangesMap, setFileChangesMap] = React.useState<Map<string, RepoFileChange>>(new Map())
  const [changedPaths, setChangedPaths] = React.useState<string[]>([])
  const [sending, setSending] = React.useState(false)
  const [queueSize, setQueueSize] = React.useState(0)
  const [showTerminalPanel, setShowTerminalPanel] = React.useState(false)
  const [showFilesPanel, setShowFilesPanel] = React.useState(false)
  const [showChangesPanel, setShowChangesPanel] = React.useState(false)
  const planVersionRef = React.useRef<number | undefined>(undefined)
  const availableCommandsVersionRef = React.useRef<number | undefined>(undefined)
  const fileChangesVersionRef = React.useRef<number | undefined>(undefined)

  const taskName = React.useMemo(
    () => task?.summary || (task?.content ? stripMarkdown(task.content) : taskId || ""),
    [task?.summary, task?.content, taskId]
  )

  const fetchTaskDetail = React.useCallback(async (): Promise<DomainProjectTask | null> => {
    if (!taskId) return null
    let result: DomainProjectTask | null = null
    await apiRequest("v1UsersTasksDetail", {}, [taskId], (resp) => {
      if (resp.code === 0) {
        result = resp.data
        setTask(resp.data)
      } else {
        toast.error(resp.message || "获取任务详情失败")
      }
    })
    return result
  }, [taskId])

  React.useEffect(() => {
    if (!taskId) return
    void fetchTaskDetail()
  }, [taskId, fetchTaskDetail])

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

  const updateTaskState = React.useCallback(
    (state: TaskWebSocketState) => {
      setStreamStatus(state.status)
      setMessages([...state.messages])
      setSending(state.sending)
      setThinkingMessage(state.thinkingMessage)
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
    },
    [fetchFileChanges]
  )

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
  }, [taskId, updateTaskState])

  React.useEffect(() => {
    if (!taskManager.current || connectedRef.current) return
    if (
      task?.virtualmachine?.status !== undefined &&
      task?.virtualmachine?.status !== TypesVirtualMachineStatus.VirtualMachineStatusPending
    ) {
      taskManager.current.connect()
      connectedRef.current = true
    }
  }, [task?.virtualmachine?.status])

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

  const disabled = task?.virtualmachine?.status !== TypesVirtualMachineStatus.VirtualMachineStatusOnline
  const showRightPanel = showTerminalPanel || showFilesPanel || showChangesPanel

  return (
    <div className="flex h-screen w-full flex-col" data-task-id={taskId}>
      <div className="border-b flex items-center p-2 gap-1 shrink-0">
        <div className="flex-1 line-clamp-1 break-all">
          {task ? taskName : "加载中..."}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showFilesPanel ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setShowFilesPanel(!showFilesPanel)}
              disabled={disabled}
            >
              <IconFolderOpen className="size-4" />
              文件
            </Button>
          </TooltipTrigger>
          <TooltipContent>文件</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showTerminalPanel ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setShowTerminalPanel(!showTerminalPanel)}
              disabled={disabled}
            >
              <IconTerminal2 className="size-4" />
              终端
            </Button>
          </TooltipTrigger>
          <TooltipContent>终端</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={showChangesPanel || changedPaths.length > 0 ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5 relative"
              onClick={() => setShowChangesPanel(!showChangesPanel)}
              disabled={disabled}
            >
              <IconFileDiff className="size-4" />
              修改
              {changedPaths.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 size-5 p-0 text-[10px] flex items-center justify-center min-w-5">
                  {changedPaths.length}
                </Badge>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>查看修改</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-1 w-full overflow-hidden p-4">
        <ResizablePanelGroup direction="horizontal" className="gap-2 flex-1">
          <ResizablePanel defaultSize={showRightPanel ? 60 : 100} minSize={30}>
            <div className={cn("h-full w-full", showRightPanel ? "" : "max-w-2xl mx-auto")}>
              <ChatPanelVm
          messages={messages}
          cli={task?.cli_name}
          streamStatus={streamStatus}
          disabled={disabled}
          thinkingMessage={thinkingMessage}
          plan={plan}
          availableCommands={availableCommands}
          sending={sending}
          queueSize={queueSize}
          sendUserInput={sendUserInput}
          sendCancelCommand={sendCancelCommand}
          sendResetSession={sendResetSession}
          sendReloadSession={sendReloadSession}
          fileChanges={changedPaths}
          fileChangesMap={fileChangesMap}
          taskManager={taskManager.current}
        />
            </div>
          </ResizablePanel>
          {showRightPanel && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={40} minSize={25}>
                <div className="flex flex-col h-full w-full border rounded-md overflow-hidden">
                  {[showTerminalPanel, showFilesPanel, showChangesPanel].filter(Boolean).length > 1 ? (
                    <Tabs
                      defaultValue={
                        showTerminalPanel ? "terminal" : showFilesPanel ? "files" : "changes"
                      }
                      className="flex flex-col h-full"
                    >
                      <TabsList className="w-fit">
                        {showTerminalPanel && (
                          <TabsTrigger value="terminal" className="gap-1.5">
                            <IconTerminal2 className="size-4" />
                            终端
                          </TabsTrigger>
                        )}
                        {showFilesPanel && (
                          <TabsTrigger value="files" className="gap-1.5">
                            <IconFolderOpen className="size-4" />
                            文件
                          </TabsTrigger>
                        )}
                        {showChangesPanel && (
                          <TabsTrigger value="changes" className="gap-1.5">
                            <IconFileDiff className="size-4" />
                            修改
                          </TabsTrigger>
                        )}
                      </TabsList>
                      {showTerminalPanel && (
                        <TabsContent value="terminal" className="flex-1 mt-0 overflow-hidden min-h-0">
                          <TerminalPanelVm envid={task?.virtualmachine?.id} disabled={disabled} />
                        </TabsContent>
                      )}
                      {showFilesPanel && (
                        <TabsContent value="files" className="flex-1 mt-0 overflow-hidden min-h-0">
                          <div className="flex flex-col w-full h-full border rounded-md overflow-hidden">
                            <FileTreeVm
                              envid={task?.virtualmachine?.id}
                              disabled={disabled}
                              rootPath="/workspace"
                            />
                          </div>
                        </TabsContent>
                      )}
                      {showChangesPanel && (
                        <TabsContent value="changes" className="flex-1 mt-0 overflow-hidden min-h-0">
                          <FileChangesPanel
                            fileChanges={changedPaths}
                            fileChangesMap={fileChangesMap}
                            taskManager={taskManager.current}
                            onSubmit={(selectedFiles) => {
                              if (selectedFiles.length === changedPaths.length) {
                                sendUserInput("用 git 提交所有修改，并推送到远程仓库")
                              } else {
                                sendUserInput(
                                  `用 git 提交以下文件的修改，并推送到远程仓库:  \n${selectedFiles.map((f) => `- ${f}`).join("\n")}`
                                )
                              }
                            }}
                          />
                        </TabsContent>
                      )}
                    </Tabs>
                  ) : showTerminalPanel ? (
                    <TerminalPanelVm envid={task?.virtualmachine?.id} disabled={disabled} />
                  ) : showChangesPanel ? (
                    <FileChangesPanel
                      fileChanges={changedPaths}
                      fileChangesMap={fileChangesMap}
                      taskManager={taskManager.current}
                      onSubmit={(selectedFiles) => {
                        if (selectedFiles.length === changedPaths.length) {
                          sendUserInput("用 git 提交所有修改，并推送到远程仓库")
                        } else {
                          sendUserInput(
                            `用 git 提交以下文件的修改，并推送到远程仓库:  \n${selectedFiles.map((f) => `- ${f}`).join("\n")}`
                          )
                        }
                      }}
                    />
                  ) : (
                    <div className="flex flex-col w-full h-full border rounded-md overflow-hidden">
                      <FileTreeVm
                        envid={task?.virtualmachine?.id}
                        disabled={disabled}
                        rootPath="/workspace"
                      />
                    </div>
                  )}
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </div>
  )
}
