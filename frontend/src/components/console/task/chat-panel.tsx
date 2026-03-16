import { MessageItem, type MessageType } from "./message"
import React from "react"
import { createPortal } from "react-dom"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Button } from "@/components/ui/button"
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { Label } from "@/components/ui/label"
import { IconCircle, IconCircleCheck, IconLoader, IconPlayerStopFilled, IconSubtask } from "@tabler/icons-react"
import type { AvailableCommands, PlanEntry, RepoFileChange, TaskPlan, TaskStreamStatus, TaskWebSocketManager } from "./ws-manager"

export interface PlanStepsBlockProps {
  plan: TaskPlan
  streamStatus: TaskStreamStatus
}

export function PlanStepsBlock({ plan, streamStatus }: PlanStepsBlockProps) {
  const [planOpened, setPlanOpened] = React.useState(false)

  React.useEffect(() => {
    if (!plan) return
    setPlanOpened(plan.entries.some((entry: PlanEntry) => entry.status !== "completed"))
  }, [plan])

  if (!plan || plan.entries.length === 0) return null

  const renderPlan = () => {
    if (planOpened) {
      return plan.entries.map((entry: PlanEntry, index: number) => (
        <div key={index} className="flex items-center gap-2">
          {entry.status === "in_progress" && streamStatus === "executing" ? (
            <IconLoader className="min-w-3 size-3 animate-spin" />
          ) : entry.status === "completed" ? (
            <IconCircleCheck className="min-w-3 size-3 text-primary" />
          ) : (
            <IconCircle className="min-w-3 size-3 text-muted-foreground" />
          )}
          <div
            className={cn(
              "line-clamp-1 text-xs",
              entry.status === "completed" ? "text-muted-foreground" : "",
              entry.status === "in_progress" && streamStatus === "executing" ? "text-primary" : ""
            )}
          >
            {entry.content}
          </div>
        </div>
      ))
    } else {
      const firstInProgress = plan.entries.find((entry: PlanEntry) => entry.status === "in_progress")
      if (!firstInProgress || streamStatus !== "executing") return null
      return (
        <div className="flex items-center gap-2">
          {firstInProgress.status === "in_progress" ? (
            <IconLoader className="min-w-3 size-3 animate-spin" />
          ) : firstInProgress.status === "completed" ? (
            <IconCircleCheck className="min-w-3 size-3 text-primary" />
          ) : (
            <IconCircle className="min-w-3 size-3 text-muted-foreground" />
          )}
          <div className="line-clamp-1 text-xs text-primary">{firstInProgress.content}</div>
        </div>
      )
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 border rounded-md p-2 shrink-0">
      <div className="flex items-center justify-between">
        <Label>
          <IconSubtask className="size-4 text-primary" />
          执行步骤 ({plan.entries.filter((entry: PlanEntry) => entry.status === "completed").length}/{plan.entries.length})
        </Label>
        <Button variant={planOpened ? "secondary" : "ghost"} size="icon-sm" className="size-5" onClick={() => setPlanOpened(!planOpened)}>
          {planOpened ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
        </Button>
      </div>
      <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">{renderPlan()}</div>
    </div>
  )
}
import { TaskChatInputBox } from "./chat-inputbox"
import { cn } from "@/lib/utils"
import { FileChangesDialog } from "./file-changes-dialog"
import type { ConstsCliName } from "@/api/Api"

interface TaskChatPanelProps {
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
  inputPortalTargetRef?: React.RefObject<HTMLDivElement | null>
  messages: MessageType[]
  cli?: ConstsCliName
  streamStatus: TaskStreamStatus
  disabled: boolean
  plan: TaskPlan | null
  /** 当为 'sticky' 时，执行步骤由父组件渲染并固定在顶部，本组件不渲染 */
  planPosition?: "inline" | "sticky"
  availableCommands: AvailableCommands | null
  sending: boolean
  queueSize: number
  sendUserInput: (content: string) => void
  sendCancelCommand: () => void
  sendResetSession: () => void
  sendReloadSession: () => void
  fileChanges: string[]
  fileChangesMap: Map<string, RepoFileChange>
  taskManager: TaskWebSocketManager | null
}

export const TaskChatPanel = ({ scrollContainerRef: externalScrollRef, inputPortalTargetRef, messages, cli, streamStatus, disabled, plan, planPosition = "inline", availableCommands, sending, sendUserInput, sendCancelCommand, sendResetSession, sendReloadSession, queueSize, fileChanges, fileChangesMap, taskManager }: TaskChatPanelProps) => {
  const [timeCost, setTimeCost] = React.useState(0)
  const internalScrollRef = React.useRef<HTMLDivElement>(null)
  const scrollContainerRef = externalScrollRef ?? internalScrollRef
  const [showSubmitButton, setShowSubmitButton] = React.useState(false)
  const [fileChangesDialogOpen, setFileChangesDialogOpen] = React.useState(false)


  React.useEffect(() => {
    setShowSubmitButton(streamStatus === "waiting")
  }, [streamStatus])

  React.useEffect(() => {
    if (streamStatus === 'executing') {
      setTimeCost(0)
      const timer = setInterval(() => {
        setTimeCost(prev => prev + 100)
      }, 100)
      return () => clearInterval(timer)
    }
  }, [streamStatus])

  const displayMessages = React.useMemo(
    () => messages.filter((message) => message.type !== 'agent_thought_chunk'),
    [messages]
  )

  const virtualRows = React.useMemo(() => {
    const rows: Array<{ type: 'message'; message: MessageType } | { type: 'taskStatus' } | { type: 'fileChanges' }> = displayMessages.map((m) => ({ type: 'message' as const, message: m }))
    if (streamStatus !== 'waiting') {
      rows.push({ type: 'taskStatus' })
    }
    if (!disabled && fileChanges.length > 0 && showSubmitButton) {
      rows.push({ type: 'fileChanges' })
    }
    return rows
  }, [displayMessages, streamStatus, disabled, fileChanges.length, showSubmitButton])

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => {
      const row = virtualRows[index]
      if (row.type === 'taskStatus') return 40
      if (row.type === 'fileChanges') return 50
      return 120
    },
    overscan: 5,
    gap: 4,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // 自动滚动到底部
  React.useEffect(() => {
    if (scrollContainerRef.current && streamStatus !== 'waiting') {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [streamStatus, virtualRows.length])

  const renderTaskStatus = () => {
    if (streamStatus === 'inited') {
      return <div className="w-full flex items-center justify-center mt-2">
        <div className="text-xs border rounded-full px-2 py-1 w-fit flex items-center gap-2 text-muted-foreground">
          <IconLoader className="size-4 animate-spin" />
          正在初始化
        </div>
      </div>
    } else if (streamStatus === 'executing') {
      return <div className="w-full flex items-center justify-center mt-2">
        <div className="text-xs border rounded-full px-2 py-1 w-fit flex items-center gap-2 text-muted-foreground">
          <IconLoader className="size-4 animate-spin" />
          任务执行耗时 {(timeCost / 1000).toFixed(1)} 秒
          {!disabled && <Button variant="ghost" size="icon-sm" className="size-5 cursor-pointer" onClick={sendCancelCommand}>
            <IconPlayerStopFilled className="size-4" />
          </Button>}
        </div>
      </div>
    } else if (streamStatus === 'waiting') {
      return null
    } else if (streamStatus === 'finished') {
      return <div className="w-full flex items-center justify-center mt-2">
        <div className="text-xs border rounded-full px-2 py-1 w-fit flex items-center gap-2 text-muted-foreground">
          任务已终止
        </div>
      </div>
    } else if (streamStatus === 'error') {
      return <div className="w-full flex items-center justify-center mt-2">
        <div className="text-xs border rounded-full px-2 py-1 w-fit flex items-center gap-2 text-muted-foreground">
          连接异常断开，请刷新重试
        </div>
      </div>
    } else {
      return null
    }
  }

  return (
    <div className={cn("flex flex-col gap-2 w-full", externalScrollRef ? "min-h-full" : "h-full")}>
      {planPosition === "inline" && plan && plan.entries.length > 0 && (
        <PlanStepsBlock plan={plan} streamStatus={streamStatus} />
      )}

      <div
        ref={!externalScrollRef ? internalScrollRef : undefined}
        className={cn("py-2", !externalScrollRef && "h-full overflow-y-auto")}
        style={externalScrollRef ? { minHeight: virtualizer.getTotalSize() } : undefined}
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
          }}
        >
          {virtualItems.map((virtualRow) => {
            const row = virtualRows[virtualRow.index]
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {row.type === 'message' && (
                  <div id={`message-${row.message.id}`} className="scroll-mt-4">
                    <MessageItem message={row.message as MessageType} cli={cli} />
                  </div>
                )}
                {row.type === 'taskStatus' && renderTaskStatus()}
                {row.type === 'fileChanges' && (
                  <div className="flex flex-row px-3 py-2 border rounded-md items-center bg-muted/50 mt-2">
                    <div
                      className="flex-1 text-xs cursor-pointer hover:text-primary transition-colors"
                      onClick={() => setFileChangesDialogOpen(true)}
                    >
                      {fileChanges.length} 个文件被修改，是否提交保存
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowSubmitButton(false)}>
                      不急
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => sendUserInput("用 git 提交所有修改，并推送到远程仓库")}>
                      提交
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <FileChangesDialog
        open={fileChangesDialogOpen}
        onOpenChange={setFileChangesDialogOpen}
        fileChanges={fileChanges}
        fileChangesMap={fileChangesMap}
        taskManager={taskManager}
        onSubmit={(selectedFiles) => {
          if (selectedFiles.length === fileChanges.length) {
            sendUserInput("用 git 提交所有修改，并推送到远程仓库")
          } else {
            sendUserInput(`用 git 提交以下文件的修改，并推送到远程仓库:  \n${selectedFiles.map((file) => `- ${file}`).join('\n')}`)
          }
          setShowSubmitButton(false)
        }}
        onCancel={() => {
          setShowSubmitButton(false)
        }}
      />
      {inputPortalTargetRef
        ? inputPortalTargetRef.current &&
          createPortal(
            disabled ? (
              <div className="flex items-center justify-center w-full border bg-muted/50 rounded-md p-2 text-xs text-muted-foreground">
                开发环境不可用
              </div>
            ) : (
              <TaskChatInputBox
                streamStatus={streamStatus}
                availableCommands={availableCommands}
                onSend={sendUserInput}
                sending={sending}
                queueSize={queueSize}
                sendResetSession={sendResetSession}
                sendReloadSession={sendReloadSession}
              />
            ),
            inputPortalTargetRef.current
          )
        : null}
      {!inputPortalTargetRef && (disabled ? (
            <div className="flex items-center justify-center w-full border bg-muted/50 rounded-md p-2 text-xs text-muted-foreground">
              开发环境不可用
            </div>
          ) : (
            <TaskChatInputBox
              streamStatus={streamStatus}
              availableCommands={availableCommands}
              onSend={sendUserInput}
              sending={sending}
              queueSize={queueSize}
              sendResetSession={sendResetSession}
              sendReloadSession={sendReloadSession}
            />
          ))}

    </div>
  )
}

