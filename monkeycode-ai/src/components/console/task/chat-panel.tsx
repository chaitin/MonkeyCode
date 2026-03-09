
import { MessageItem, type MessageType } from "./message"
import React from "react"
import { Button } from "@/components/ui/button"
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { Label } from "@/components/ui/label"
import { stripMarkdown } from "@/utils/common"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { IconCircle, IconCircleCheck, IconLoader, IconPlayerStopFilled, IconSparkles, IconSubtask } from "@tabler/icons-react"
import type { AvailableCommands, PlanEntry, RepoFileChange, TaskPlan, TaskStreamStatus, TaskWebSocketManager } from "./ws-manager"
import { TaskChatInputBox } from "./chat-inputbox"
import { cn } from "@/lib/utils"
import { FileChangesDialog } from "./file-changes-dialog"
import type { ConstsCliName } from "@/api/Api"

interface TaskChatPanelProps {
  messages: MessageType[]
  cli?: ConstsCliName
  streamStatus: TaskStreamStatus
  disabled: boolean
  thinkingMessage: string
  plan: TaskPlan | null
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

export const TaskChatPanel = ({ messages, cli, streamStatus, disabled, thinkingMessage, plan, availableCommands, sending, sendUserInput, sendCancelCommand, sendResetSession, sendReloadSession, queueSize, fileChanges, fileChangesMap, taskManager }: TaskChatPanelProps) => {
  const [thinkingOpened, setThinkingOpened] = React.useState(false)
  const [planOpened, setPlanOpened] = React.useState(false)
  const [timeCost, setTimeCost] = React.useState(0)
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const [showSubmitButton, setShowSubmitButton] = React.useState(false)
  const [fileChangesDialogOpen, setFileChangesDialogOpen] = React.useState(false)


  React.useEffect(() => {
    setShowSubmitButton(streamStatus === 'waiting')
  }, [streamStatus])

  React.useEffect(() => {
    if (!plan) {
      return
    }
    
    setPlanOpened(plan.entries.some((entry: PlanEntry) => entry.status !== 'completed'))

  }, [plan])

  const thinkingSummary = React.useMemo(() => {
    const textThinkingMesssage = stripMarkdown(thinkingMessage)
    if (textThinkingMesssage.length <= 200) {
      return textThinkingMesssage
    }
    return textThinkingMesssage.slice(-200)
  }, [thinkingMessage])

  React.useEffect(() => {
    if (streamStatus === 'executing') {
      setTimeCost(0)
      const timer = setInterval(() => {
        setTimeCost(prev => prev + 100)
      }, 100)
      return () => clearInterval(timer)
    }
  }, [streamStatus])

  // 自动滚动到底部
  React.useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [streamStatus])

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

  const renderPlan = () => {
    if (!plan || plan.entries.length === 0) {
      return null
    }
    if (planOpened) {
      return plan.entries.map((entry: PlanEntry, index: number) => (
        <div key={index} className="flex items-center gap-2">
          {entry.status === 'in_progress' && streamStatus === 'executing' ? (
            <IconLoader className="min-w-3 size-3 animate-spin" />
          ) : (
            entry.status === 'completed' ? (
              <IconCircleCheck className="min-w-3 size-3 text-primary" />
            ) : (
              <IconCircle className="min-w-3 size-3 text-muted-foreground" />
            )
          )}
          <div className={cn("line-clamp-1 text-xs", entry.status === 'completed' ? 'text-muted-foreground' : '', (entry.status === 'in_progress' && streamStatus === 'executing') ? 'text-primary' : '')}>
            {entry.content}
          </div>
        </div>
      ))
    } else {
      const firstInProgress = plan.entries.find((entry: PlanEntry) => entry.status === 'in_progress')
      if (!firstInProgress || streamStatus !== 'executing') {
        return null
      }
      return  <div className="flex items-center gap-2">
        {firstInProgress.status === 'in_progress' ? (
          <IconLoader className="min-w-3 size-3 animate-spin" />
        ) : (
          firstInProgress.status === 'completed' ? (
            <IconCircleCheck className="min-w-3 size-3 text-primary" />
          ) : (
            <IconCircle className="min-w-3 size-3 text-muted-foreground" />
          )
        )}
        <div className="line-clamp-1 text-xs text-primary">
          {firstInProgress.content}
        </div>
      </div>
    }
  }

  return (
    <div className="flex flex-col gap-2 h-full w-full">
      {thinkingSummary && <div className="flex w-full flex-col gap-2 border rounded-md p-2">
        <div className="flex items-center justify-between">
          <Label>
            <IconSparkles className="size-4 text-primary" />
            思考过程
          </Label>
          <Button variant={thinkingOpened ? "secondary" : "ghost"} size="icon-sm" className="size-5" onClick={() => setThinkingOpened(!thinkingOpened)}>
            {thinkingOpened ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
          </Button>
        </div>
        {thinkingOpened ? (<div className="w-full">
          <div className="user-message-markdown text-sm max-h-80 overflow-y-auto opacity-60 text-xs px-2 -mx-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{thinkingMessage}</ReactMarkdown>
          </div>
        </div>): (<div className="w-full max-w-full overflow-hidden relative h-4">
            <div className="text-xs text-muted-foreground absolute right-0 min-w-full whitespace-nowrap">
            {thinkingSummary}
          </div>
        </div>)}
      </div>}
      {plan && plan.entries.length > 0 && <div className="flex w-full flex-col gap-2 border rounded-md p-2">
        <div className="flex items-center justify-between">
          <Label>
            <IconSubtask className="size-4 text-primary" />
            执行步骤 ({plan.entries.filter((entry: PlanEntry) => entry.status === 'completed').length}/{plan.entries.length})
          </Label>
          <Button variant={planOpened ? "secondary" : "ghost"} size="icon-sm" className="size-5" onClick={() => setPlanOpened(!planOpened)}>
            {planOpened ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
          </Button>
        </div>
        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
          {renderPlan()}
        </div>
      </div>}

      <div ref={scrollContainerRef} className="h-full overflow-y-auto p-2 border rounded-md">
        <div className="flex flex-col justify-end min-h-full gap-1">
          {messages.filter((message) => message.type !== 'agent_thought_chunk').map((message) => (
            <div key={message.id} id={`message-${message.id}`} className="scroll-mt-4">
              <MessageItem message={message as MessageType} cli={cli} />
            </div>
          ))}
          {renderTaskStatus()}
          {!disabled && fileChanges.length > 0 && showSubmitButton ? (
            <div className="flex flex-row px-3 py-2 border rounded-md items-center bg-muted/50 mt-2">
              <div 
                className="flex-1 text-xs cursor-pointer hover:text-primary transition-colors"
                onClick={() => setFileChangesDialogOpen(true)}
              >
                {fileChanges.length} 个文件被修改，是否提交保存
              </div>
              
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => {
                setShowSubmitButton(false)
              }}>
                不急
              </Button>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => {
                sendUserInput("用 git 提交所有修改，并推送到远程仓库")
              }}>
                提交
              </Button>
            </div>
          ) : null}
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
      {disabled ? (
        <div className="flex items-center justify-center w-ful border bg-muted/50 rounded-md p-2 text-xs text-muted-foreground">
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
      )}

    </div>
  )
}

