import { TypesVirtualMachineStatus, type DomainProjectTask } from "@/api/Api"
import { TaskChatPanel } from "@/components/console/task/chat-panel"
import { TaskFileTree } from "@/components/console/task/file-tree"
import type { MessageType } from "@/components/console/task/message"
import { TaskDetailPanel, type TaskDetailPanelRef } from "@/components/console/task/task-detail-panel"
import { TaskPreparingDialog } from "@/components/console/task/task-preparing-dialog"
import { TaskTerminalPanel } from "@/components/console/task/terminal-panel"
import { TaskFileChangeType, TaskWebSocketManager, type AvailableCommands, type RepoFileChange, type RepoFileStatus, type TaskFileChange, type TaskPlan, type TaskStreamStatus, type TaskWebSocketState } from "@/components/console/task/ws-manager"
import { VmPortForwardDialog } from "@/components/console/vm/vm-port-forward"
import { VmRenewDialog } from "@/components/console/vm/vm-renew"
import { AlertDialog, AlertDialogTitle, AlertDialogAction, AlertDialogFooter, AlertDialogContent, AlertDialogHeader } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { humanTime, stripMarkdown } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconDeviceDesktop, IconDotsVertical, IconFolderOpen, IconMessage, IconShare, IconTerminal2 } from "@tabler/icons-react"
import React from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"

export default function TaskDevelopPage() {
  const { taskId } = useParams()
  const [ task, setTask] = React.useState<DomainProjectTask | null>(null)
  const [ showFilesPanel, setShowFilesPanel] = React.useState(false)
  const [ showTerminalPanel, setShowTerminalPanel] = React.useState(false)
  const taskManager = React.useRef<TaskWebSocketManager | null>(null)
  const connectedRef = React.useRef<boolean>(false)
  const [thinkingMessage, setThinkingMessage] = React.useState("")
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [renewDialogOpen, setRenewDialogOpen] = React.useState(false)
  const [availableCommands, setAvailableCommands] = React.useState<AvailableCommands | null>(null)
  const fileChangesVersionRef = React.useRef<number | undefined>(undefined)
  const [fileChangesMap, setFileChangesMap] = React.useState<Map<string, RepoFileChange>>(new Map())
  const [changedPaths, setChangedPaths] = React.useState<string[]>([])
  const [streamStatus, setStreamStatus] = React.useState<TaskStreamStatus>('inited')
  const [messages, setMessages] = React.useState<MessageType[]>([])
  const [plan, setPlan] = React.useState<TaskPlan | null>(null)

  const [showReloadAlert, setShowReloadAlert] = React.useState(false)

  // 使用 ref 跟踪最新值，避免闭包陷阱
  const planVersionRef = React.useRef<number | undefined>(undefined)
  const availableCommandsVersionRef = React.useRef<number | undefined>(undefined)
  const [sending, setSending] = React.useState(false)
  const [queueSize, setQueueSize] = React.useState(0)
  // 文件详情面板 ref
  const taskDetailPanelRef = React.useRef<TaskDetailPanelRef>(null)
  
  // 在线预览对话框状态
  const [portForwardDialogOpen, setPortForwardDialogOpen] = React.useState(false)
  
  // 检查是否有已开放的端口
  const existPorts = React.useMemo(() => {
    return task?.virtualmachine?.ports?.length && task?.virtualmachine?.ports?.length > 0
  }, [task?.virtualmachine?.ports])

  // 获取任务详情
  const fetchTaskDetail = React.useCallback(async (): Promise<DomainProjectTask | null> => {
    if (!taskId) {
      return null
    }
    let result: DomainProjectTask | null = null
    await apiRequest('v1UsersTasksDetail', {}, [taskId], (resp) => {
      if (resp.code === 0) {
        result = resp.data
        setTask(resp.data)
      } else {
        toast.error(resp.message || "获取任务详情失败")
      }
    })
    return result
  }, [taskId])

  // 请求文件变更状态
  const fetchFileChanges = React.useCallback(() => {
    taskManager.current?.getFileChanges().then((changes: RepoFileChange[] | null) => {
      if (changes === null) {
        return
      }

      const newMap = new Map<string, RepoFileChange>()
      const newFileChanges: TaskFileChange[] = []
      changes.forEach(change => {
        newMap.set(change.path, change)
        // 将 RepoFileChange 的 status 转换为 TaskFileChange 的 type
        const type = change.status === 'A' ? TaskFileChangeType.Created :
                      change.status === 'D' ? TaskFileChangeType.Delete :
                      change.status === 'R' ? TaskFileChangeType.Renamed : TaskFileChangeType.Modified
        newFileChanges.push({ path: change.path, type })
      })
      setFileChangesMap(newMap)
      setChangedPaths(newFileChanges.map(f => f.path))
    })
  }, [])

  const scheduleFetchTaskDetail = async () => {
    const currentTask = await fetchTaskDetail()

    let delay = 1000


    switch (currentTask?.virtualmachine?.status) {
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
  }

  // 定时获取任务详情
  React.useEffect(() => {
    if (!taskId) {
      return
    }

    scheduleFetchTaskDetail()

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [taskId])

  // 阻止页面意外关闭（浏览器关闭/刷新）
  React.useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // 现代浏览器会忽略自定义消息，但仍需设置 returnValue
      e.returnValue = ''
      return ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  // 阻止浏览器后退/前进按钮导航
  React.useEffect(() => {
    // 推入一个状态，用于检测后退操作
    window.history.pushState(null, '', window.location.href)
    
    const handlePopState = () => {
      const confirmed = window.confirm('确定要离开此页面吗？未保存的更改可能会丢失。')
      if (!confirmed) {
        // 用户取消，重新推入状态阻止导航
        window.history.pushState(null, '', window.location.href)
      }
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  const updateTaskState = (state: TaskWebSocketState) => {
    // 直接更新状态，创建新的数组引用让 React 正确检测变化
    setStreamStatus(state.status)
    setMessages([...state.messages])
    setSending(state.sending)
    setThinkingMessage(state.thinkingMessage)
    setQueueSize(state.queueSize)
    // 使用 ref 比较版本号，避免闭包陷阱
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

  // 初始化 websocket manager
  React.useEffect(() => {
    if (!taskId) {
      return
    }

    connectedRef.current = false
    const manager = new TaskWebSocketManager(taskId, updateTaskState, false, false)
    taskManager.current = manager

    return () => {
      manager.disconnect()
      taskManager.current = null
      connectedRef.current = false
    }
  }, [taskId])

  // 当虚拟机状态变为 online 时连接 websocket（只连接一次）
  React.useEffect(() => {
    if (!taskManager.current || connectedRef.current) {
      return
    }
    console.log('task?.virtualmachine?.status', task?.virtualmachine?.status)
    if (task?.virtualmachine?.status !== undefined && task?.virtualmachine?.status !== TypesVirtualMachineStatus.VirtualMachineStatusPending) {
      taskManager.current.connect()
      connectedRef.current = true
    }
  }, [task?.virtualmachine?.status])

  // 每次 streamStatus 变成 waiting 时重新获取文件变更
  React.useEffect(() => {
    if (task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusOnline && streamStatus === 'waiting') {
      fetchFileChanges()
    }
  }, [streamStatus, fetchFileChanges])

  React.useEffect(() => {
    if (task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusOnline && (streamStatus == 'waiting' || streamStatus == 'executing')) {
      fetchFileChanges()
    }
  }, [task?.virtualmachine?.status, fetchFileChanges])

  const checkIsTaskFinished = async () => {
    if (streamStatus === 'finished' || streamStatus === 'error') {
      const newTask = await fetchTaskDetail()
      if (newTask?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusOnline) {
        setShowReloadAlert(true)
      }
    }
  }

  React.useEffect(() => {
    checkIsTaskFinished()
  }, [streamStatus])



  const onSelectFile = React.useCallback((path: string, _file: RepoFileStatus) => {
    if (_file?.size && _file.size > 1 * 1024 * 1024) {
      toast.error('文件过大，无法在线预览')
      return
    }
    taskDetailPanelRef.current?.openFile(path)
  }, [])

  const taskName = React.useMemo(() => {
    return task?.summary || stripMarkdown(task?.content)
  }, [task?.content])

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

  return (
    <div className="flex flex-col h-screen">
      <div className="border-b flex items-center p-2 gap-1">
        <div className="flex-1 line-clamp-1 break-all">
          {taskName}
        </div>
        {task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusOnline && task?.virtualmachine?.life_time_seconds !== 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant={task?.virtualmachine?.life_time_seconds && task?.virtualmachine?.life_time_seconds < 1800 ? 'default' : 'outline'}
                className={cn(
                  "hidden lg:flex cursor-pointer", 
                  task?.virtualmachine?.life_time_seconds && task?.virtualmachine?.life_time_seconds < 600 ? 'animate-bounce' : '',
                )}
                onClick={() => setRenewDialogOpen(true)}>
                {`开发环境将于 ${humanTime(task?.virtualmachine?.life_time_seconds as number)}后回收`}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>点击续期</TooltipContent>
          </Tooltip>
        )}

        {((streamStatus === 'finished' || streamStatus === 'error') && (task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusOnline)) ? (
          <Badge className="animate-pulse cursor-pointer" onClick={() => setShowReloadAlert(true)}>网络连接已断开</Badge> 
        ) : null}

        <Button 
          variant={existPorts ? "default" : "ghost"} size="sm" 
          disabled={task?.virtualmachine?.status !== TypesVirtualMachineStatus.VirtualMachineStatusOnline} 
          className={cn(
            "hidden lg:flex gap-1", 
            existPorts ? "animate-bounce" : ""
          )}
          onClick={() => setPortForwardDialogOpen(true)}
        >
          <IconDeviceDesktop className="size-4" />
          预览
        </Button>

        <Button 
          variant="ghost"
          size="sm" 
          className={cn(
            "gap-1",
            showFilesPanel ? "text-primary bg-accent" : ""
          )}
          onClick={() => setShowFilesPanel(!showFilesPanel)}
        >
          <IconFolderOpen className="size-4" />
          文件
        </Button>

        <Button 
          variant="ghost"
          size="sm" 
          className={cn(
            "gap-1",
            showTerminalPanel ? "text-primary bg-accent" : ""
          )}
          onClick={() => setShowTerminalPanel(!showTerminalPanel)}
        >
          <IconTerminal2 className="size-4" />
          终端
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="rounded-full">
              <IconDotsVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem 
              disabled={task?.virtualmachine?.status !== TypesVirtualMachineStatus.VirtualMachineStatusOnline}
              onClick={() => setPortForwardDialogOpen(true)}
              className="lg:hidden"
            >
              <IconDeviceDesktop />
              在线预览
            </DropdownMenuItem>
            <DropdownMenuItem 
              disabled={task?.virtualmachine?.status !== TypesVirtualMachineStatus.VirtualMachineStatusOnline}
              onClick={() => window.open(`/console/terminal?envid=${task?.virtualmachine?.id}`, '_blank')}
            >
              <IconTerminal2 />
              终端
            </DropdownMenuItem>
            <DropdownMenuItem 
              disabled={task?.virtualmachine?.status !== TypesVirtualMachineStatus.VirtualMachineStatusOnline}
              onClick={() => window.open(`/console/files?envid=${task?.virtualmachine?.id}&path=/workspace`, '_blank')}
            >
              <IconFolderOpen />
              文件
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open(`/playground/create?taskid=${task?.id}`, '_blank')}>
              <IconShare />
              分享到广场
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ResizablePanelGroup direction="horizontal" className="gap-1 p-2">
        {(showTerminalPanel || showFilesPanel) && <ResizablePanel defaultSize={60} className="hidden sm:block">
          <ResizablePanelGroup direction="vertical" className="gap-1">
            {showFilesPanel && <>
              <ResizablePanel defaultSize={70} minSize={35}>
                <ResizablePanelGroup direction="horizontal" className="gap-1">
                  <ResizablePanel defaultSize={30} minSize={20} className="">
                    <div className="flex flex-col w-full h-full border rounded-md overflow-hidden">
                      <TaskFileTree 
                        onFileSelect={onSelectFile} 
                        disabled={task?.virtualmachine?.status !== TypesVirtualMachineStatus.VirtualMachineStatusOnline} 
                        streamStatus={streamStatus} 
                        fileChanges={changedPaths}
                        fileChangesMap={fileChangesMap}
                        changedPaths={changedPaths}
                        taskManager={taskManager.current}
                        onRefresh={fetchFileChanges}
                        sendUserInput={sendUserInput}
                        envid={task?.virtualmachine?.id}
                      />
                    </div>
                  </ResizablePanel>
                  <ResizableHandle className="invisible" />
                  <ResizablePanel defaultSize={70} minSize={40} className="">
                    <TaskDetailPanel
                      ref={taskDetailPanelRef}
                      envid={task?.virtualmachine?.id}
                      taskManager={taskManager.current}
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
            </>}
            {showTerminalPanel && showFilesPanel && <ResizableHandle className="invisible" />}
            {showTerminalPanel && <ResizablePanel defaultSize={30} minSize={20} className="">
              <div className="flex flex-col w-full h-full border rounded-md overflow-hidden">
                <TaskTerminalPanel envid={task?.virtualmachine?.id} disabled={task?.virtualmachine?.status !== TypesVirtualMachineStatus.VirtualMachineStatusOnline} />
              </div>
            </ResizablePanel>}
          </ResizablePanelGroup>
        </ResizablePanel>}
        {(showTerminalPanel || showFilesPanel) && <ResizableHandle className="invisible hidden sm:block" />}
        <ResizablePanel defaultSize={40} minSize={35} style={{overflow: 'visible'}}>
          <TaskChatPanel 
            messages={messages} 
            cli={task?.cli_name}
            availableCommands={availableCommands}
            streamStatus={streamStatus}
            disabled={task?.virtualmachine?.status !== TypesVirtualMachineStatus.VirtualMachineStatusOnline} 
            sending={sending}
            thinkingMessage={thinkingMessage}
            plan={plan}
            sendUserInput={sendUserInput}
            sendCancelCommand={sendCancelCommand}
            sendResetSession={sendResetSession}
            sendReloadSession={sendReloadSession}
            queueSize={queueSize}
            fileChanges={changedPaths}
            fileChangesMap={fileChangesMap}
            taskManager={taskManager.current}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <TaskPreparingDialog task={task} />
      <VmPortForwardDialog
        open={portForwardDialogOpen}
        onOpenChange={setPortForwardDialogOpen}
        ports={task?.virtualmachine?.ports}
        hostId={task?.virtualmachine?.host?.id}
        vmId={task?.virtualmachine?.id}
        onSuccess={fetchTaskDetail}
      />
      <VmRenewDialog
        open={renewDialogOpen}
        onOpenChange={setRenewDialogOpen}
        hostId={task?.virtualmachine?.host?.id}
        vmId={task?.virtualmachine?.id}
        onSuccess={fetchTaskDetail}
      />
      <AlertDialog open={showReloadAlert} onOpenChange={setShowReloadAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>连接异常断开，请重新连接</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => window.location.reload()}>重连</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}