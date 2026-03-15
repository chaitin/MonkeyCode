import { ConstsTaskStatus, type DomainProjectTask } from "@/api/Api"
import { useBreadcrumbTask } from "@/components/console/breadcrumb-task-context"
import { TaskFileExplorer } from "@/components/console/task/task-file-explorer"
import { TaskTerminalPanel } from "@/components/console/task/task-terminal-panel"
import { TaskWebSocketManager, type RepoFileChange, type TaskStreamStatus, type TaskWebSocketState } from "@/components/console/task/ws-manager"
import { TaskChangesPanel } from "@/components/console/task/task-changes-panel"
import { TaskPreviewPanel } from "@/components/console/task/task-preview-panel"
import { TaskChatSection, type PanelType } from "@/components/console/task/task-chat-section"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { apiRequest } from "@/utils/requestUtils"
import React from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { TypesVirtualMachineStatus } from "@/api/Api"

export default function TaskDetailPage() {
  const { taskId } = useParams()
  const { setTaskName } = useBreadcrumbTask() ?? {}
  const [task, setTask] = React.useState<DomainProjectTask | null>(null)
  const [activePanel, setActivePanel] = React.useState<PanelType | null>(null)
  const [inputValue, setInputValue] = React.useState("")
  const [fileChangesMap, setFileChangesMap] = React.useState<Map<string, RepoFileChange>>(new Map())
  const [changedPaths, setChangedPaths] = React.useState<string[]>([])
  const [streamStatus, setStreamStatus] = React.useState<TaskStreamStatus>("inited")
  const taskManager = React.useRef<TaskWebSocketManager | null>(null)
  const connectedRef = React.useRef(false)

  const vmOnline = task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusOnline
  const envid = task?.virtualmachine?.id

  const fetchTaskDetail = React.useCallback(async () => {
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
    if (state.fileChanges.version !== undefined) {
      fetchFileChanges()
    }
  }

  React.useEffect(() => {
    if (!taskId) return
    fetchTaskDetail()
  }, [taskId, fetchTaskDetail])

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

  const handleSend = () => {
    if (!inputValue.trim()) return
    // TODO: 发送后续变更请求
    setInputValue("")
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

    const hasPanel = activePanel !== null
  const togglePanel = (panel: PanelType) => {
    setActivePanel((prev) => (prev === panel ? null : panel))
  }

  const panelsDisabled = task?.status !== ConstsTaskStatus.TaskStatusProcessing

  const chatSection = (
    <TaskChatSection
      inputValue={inputValue}
      onInputChange={setInputValue}
      onSend={handleSend}
      onKeyDown={handleKeyDown}
      hasPanel={hasPanel}
      activePanel={activePanel}
      onTogglePanel={togglePanel}
      panelsDisabled={panelsDisabled}
    />
  )

  if (!hasPanel) {
    return (
      <div className="flex flex-col h-full min-h-0">
        {chatSection}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <ResizablePanelGroup direction="horizontal" className="gap-2">
        <ResizablePanel defaultSize={50} minSize={30} className="min-w-0">
          {chatSection}
        </ResizablePanel>
        <ResizableHandle withHandle className="shrink-0" />
        <ResizablePanel defaultSize={50} minSize={30} className="min-w-0">
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
                  envid={envid}
                />
              </div>
            )}
            {activePanel === "terminal" && (
              <div className="flex-1 min-h-0 overflow-hidden">
                <div className="h-full w-full border rounded-md overflow-hidden">
                  <TaskTerminalPanel envid={envid} disabled={!vmOnline} />
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
                />
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
