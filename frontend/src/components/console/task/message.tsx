import { cn } from "@/lib/utils"
import { ErrorMessageItem } from "./message-error"
import { TextMessageItem } from "./message-text"
import { ThoughtMessageItem } from "./message-thought"
import { ToolCallMessageItem } from "./message-toolcall"
import dayjs from "dayjs"
import { AskUserQuestionMessageItem } from "./message-ask-user-question"
import { UserInputMessageItem } from "./message-userinput"
import { SystemMessageItem } from "./message-system"
import type { ConstsCliName } from "@/api/Api"
import { RestartSessionMessageItem } from "./message-restart-session"
import type { TaskUserInput, TaskUserInputAttachment } from "./task-shared"

const normalizeTimestampToSeconds = (timestamp: number) => {
  if (!Number.isFinite(timestamp)) return timestamp
  if (timestamp >= 1e17) return Math.floor(timestamp / 1e9)
  if (timestamp >= 1e14) return Math.floor(timestamp / 1e6)
  if (timestamp >= 1e11) return Math.floor(timestamp / 1e3)
  return Math.floor(timestamp)
}

interface MessageType {
  id: string
  time: number
  role: 'agent' | 'user' | 'system'
  type: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_input' | 'user_cancel' | 'tool_call' | 'tool_call_update' | 'available_commands_update' | 'plan' | 'error_message' | 'ask_user_question' | 'system_message' | 'restart_session'
  data: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _meta?: any
    requestId?: string
    details?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content?: any
    kind?: string
    status?: string
    title?: string
    toolCallId?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawInput?: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawOutput?: any
    locations?: string
    entries?: {
      content: string
      priority: string
      status: string
    }[]
    attachments?: TaskUserInputAttachment[]
    askId?: string
    questions?: {
      custom: boolean
      header: string
      multiSelect: boolean
      question: string
      answer?: string | string[]
      options: {
        label: string
        description: string
      }[]
    }[]
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onResponseAskUserQuestion?: (askId: string, answers: any) => "sent" | "queued" | "rejected"
  onReloadSession?: () => Promise<boolean> | boolean
  onUserInput?: (content: TaskUserInput) => Promise<boolean> | boolean
}

const MessageItem = ({ message, cli, isLatest = false }: { message: MessageType, cli?: ConstsCliName, isLatest?: boolean }) => {
  const renderMessage = (message: MessageType) => {
    switch (message.type) {
      case 'agent_message_chunk':
        return <TextMessageItem message={message} />
      case 'agent_thought_chunk':
        return <ThoughtMessageItem message={message} isLatest={isLatest} />
      case 'user_input':
        return <UserInputMessageItem message={message} />
      case 'tool_call':
        return <ToolCallMessageItem message={message} cli={cli} />
      case 'error_message':
        return <ErrorMessageItem message={message} />
      case 'ask_user_question':
        return <AskUserQuestionMessageItem message={message} onResponse={message.onResponseAskUserQuestion} />
      case 'system_message':
        return <SystemMessageItem message={message} />
      case 'restart_session':
        return <RestartSessionMessageItem message={message} />
      default:
        console.error('收到奇葩数据', message);
        return null;
    }
  }

  if (message.type === 'agent_message_chunk' && message.data.content?.trim() === '(no content)') {
    return null
  }

  if (message.type === 'agent_thought_chunk' && message.data.content?.trim() === '') {
    return null
  }

  return (
    <div className="flex flex-col w-full group">
      {message.role !== 'system' && <div className={cn("text-[10px] text-transparent group-hover:text-muted-foreground transition-colors px-1", message.role === 'user' ? 'text-right' : 'text-left')}>
        {dayjs.unix(normalizeTimestampToSeconds(message.time)).format('MM-DD HH:mm:ss')}
      </div>}
      <div className={cn("flex text-sm w-full", message.role === 'user' ? 'ml-auto justify-end' : 'mr-auto justify-start')}> 
        {renderMessage(message)}
      </div>
    </div>
  )
}

export { 
  MessageItem,
  type MessageType
}
