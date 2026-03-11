import { MessageItem, type MessageType } from "./message"
import React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Button } from "@/components/ui/button"
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { Label } from "@/components/ui/label"
import { stripMarkdown } from "@/utils/common"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  IconCircle,
  IconCircleCheck,
  IconLoader,
  IconPlayerStopFilled,
  IconSparkles,
  IconSubtask,
} from "@tabler/icons-react"
import type {
  AvailableCommands,
  PlanEntry,
  RepoFileChange,
  TaskPlan,
  TaskStreamStatus,
  TaskWebSocketManager,
} from "./ws-manager"
import { TaskChatInputBox } from "./chat-inputbox"
import { cn } from "@/lib/utils"
import type { ConstsCliName } from "@/api/Api"

interface ChatPanelVmProps {
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

export const ChatPanelVm = ({
  messages,
  cli,
  streamStatus,
  disabled,
  thinkingMessage,
  plan,
  availableCommands,
  sending,
  queueSize,
  sendUserInput,
  sendCancelCommand,
  sendResetSession,
  sendReloadSession,
}: ChatPanelVmProps) => {
  const [thinkingOpened, setThinkingOpened] = React.useState(false)
  const [planOpened, setPlanOpened] = React.useState(false)
  const [timeCost, setTimeCost] = React.useState(0)
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (plan) {
      setPlanOpened(plan.entries.some((e: PlanEntry) => e.status !== "completed"))
    }
  }, [plan])

  const thinkingSummary = React.useMemo(() => {
    const text = stripMarkdown(thinkingMessage)
    return text.length <= 200 ? text : text.slice(-200)
  }, [thinkingMessage])

  React.useEffect(() => {
    if (streamStatus === "executing") {
      setTimeCost(0)
      const timer = setInterval(() => setTimeCost((p) => p + 100), 100)
      return () => clearInterval(timer)
    }
  }, [streamStatus])

  const displayMessages = React.useMemo(
    () => messages.filter((m) => m.type !== "agent_thought_chunk"),
    [messages]
  )

  const virtualRows = React.useMemo(() => {
    const rows: Array<
      | { type: "message"; message: MessageType }
      | { type: "taskStatus" }
    > = displayMessages.map((m) => ({ type: "message" as const, message: m }))
    if (streamStatus !== "waiting") {
      rows.push({ type: "taskStatus" })
    }
    return rows
  }, [displayMessages, streamStatus])

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (i) => {
      const row = virtualRows[i]
      return row?.type === "taskStatus" ? 40 : 120
    },
    overscan: 5,
    gap: 4,
  })

  const virtualItems = virtualizer.getVirtualItems()

  React.useEffect(() => {
    if (scrollContainerRef.current && streamStatus !== "waiting") {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [streamStatus, virtualRows.length])

  const renderTaskStatus = () => {
    if (streamStatus === "inited") {
      return (
        <div className="w-full flex items-center justify-center mt-2">
          <div className="text-xs border rounded-full px-2 py-1 w-fit flex items-center gap-2 text-muted-foreground">
            <IconLoader className="size-4 animate-spin" />
            正在初始化
          </div>
        </div>
      )
    }
    if (streamStatus === "executing") {
      return (
        <div className="w-full flex items-center justify-center mt-2">
          <div className="text-xs border rounded-full px-2 py-1 w-fit flex items-center gap-2 text-muted-foreground">
            <IconLoader className="size-4 animate-spin" />
            任务执行耗时 {(timeCost / 1000).toFixed(1)} 秒
            {!disabled && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-5 cursor-pointer"
                onClick={sendCancelCommand}
              >
                <IconPlayerStopFilled className="size-4" />
              </Button>
            )}
          </div>
        </div>
      )
    }
    if (streamStatus === "waiting") return null
    if (streamStatus === "finished") {
      return (
        <div className="w-full flex items-center justify-center mt-2">
          <div className="text-xs border rounded-full px-2 py-1 w-fit text-muted-foreground">
            任务已终止
          </div>
        </div>
      )
    }
    if (streamStatus === "error") {
      return (
        <div className="w-full flex items-center justify-center mt-2">
          <div className="text-xs border rounded-full px-2 py-1 w-fit text-muted-foreground">
            连接异常断开，请刷新重试
          </div>
        </div>
      )
    }
    return null
  }

  const renderPlan = () => {
    if (!plan || plan.entries.length === 0) return null
    if (planOpened) {
      return plan.entries.map((entry: PlanEntry, i: number) => (
        <div key={i} className="flex items-center gap-2">
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
              entry.status === "completed" && "text-muted-foreground",
              entry.status === "in_progress" &&
                streamStatus === "executing" &&
                "text-primary"
            )}
          >
            {entry.content}
          </div>
        </div>
      ))
    }
    const first = plan.entries.find((e: PlanEntry) => e.status === "in_progress")
    if (!first || streamStatus !== "executing") return null
    return (
      <div className="flex items-center gap-2">
        <IconLoader className="min-w-3 size-3 animate-spin" />
        <div className="line-clamp-1 text-xs text-primary">{first.content}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 h-full w-full">
      {thinkingSummary && (
        <div className="flex w-full flex-col gap-2 border rounded-md p-2">
          <div className="flex items-center justify-between">
            <Label>
              <IconSparkles className="size-4 text-primary" />
              思考过程
            </Label>
            <Button
              variant={thinkingOpened ? "secondary" : "ghost"}
              size="icon-sm"
              className="size-5"
              onClick={() => setThinkingOpened(!thinkingOpened)}
            >
              {thinkingOpened ? (
                <ChevronsDownUp className="size-4" />
              ) : (
                <ChevronsUpDown className="size-4" />
              )}
            </Button>
          </div>
          {thinkingOpened ? (
            <div className="user-message-markdown text-sm max-h-80 overflow-y-auto opacity-60 text-xs px-2 -mx-2">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{thinkingMessage}</ReactMarkdown>
            </div>
          ) : (
            <div className="w-full max-w-full overflow-hidden relative h-4">
              <div className="text-xs text-muted-foreground absolute right-0 min-w-full whitespace-nowrap">
                {thinkingSummary}
              </div>
            </div>
          )}
        </div>
      )}

      {plan && plan.entries.length > 0 && (
        <div className="flex w-full flex-col gap-2 border rounded-md p-2">
          <div className="flex items-center justify-between">
            <Label>
              <IconSubtask className="size-4 text-primary" />
              执行步骤 (
              {plan.entries.filter((e: PlanEntry) => e.status === "completed").length}/
              {plan.entries.length})
            </Label>
            <Button
              variant={planOpened ? "secondary" : "ghost"}
              size="icon-sm"
              className="size-5"
              onClick={() => setPlanOpened(!planOpened)}
            >
              {planOpened ? (
                <ChevronsDownUp className="size-4" />
              ) : (
                <ChevronsUpDown className="size-4" />
              )}
            </Button>
          </div>
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">{renderPlan()}</div>
        </div>
      )}

      <div ref={scrollContainerRef} className="h-full overflow-y-auto p-2 border rounded-md">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualItems.map((vr) => {
            const row = virtualRows[vr.index]
            return (
              <div
                key={vr.key}
                data-index={vr.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vr.start}px)`,
                }}
              >
                {row.type === "message" && (
                  <div id={`message-${row.message.id}`} className="scroll-mt-4">
                    <MessageItem message={row.message} cli={cli} />
                  </div>
                )}
                {row.type === "taskStatus" && renderTaskStatus()}
              </div>
            )
          })}
        </div>
      </div>

      {disabled ? (
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
      )}
    </div>
  )
}
