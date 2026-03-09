import { cn } from "@/lib/utils"
import { ErrorMessageItem } from "./message-error"
import { TextMessageItem } from "./message-text"
import { ToolCallMessageItem } from "./message-toolcall"
import dayjs from "dayjs"
import { AskUserQuestionMessageItem } from "./message-ask-user-question"
import { UserInputMessageItem } from "./message-userinput"
import { SystemMessageItem } from "./message-system"
import type { ConstsCliName } from "@/api/Api"
import { RestartSessionMessageItem } from "./message-restart-session"

interface MessageType {
  id: string
  time: number
  role: 'agent' | 'user' | 'system'
  type: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_input' | 'user_cancel' | 'tool_call' | 'tool_call_update' | 'available_commands_update' | 'plan' | 'error_message' | 'ask_user_question' | 'system_message' | 'restart_session'
  data: {
    _meta?: any
    requestId?: string
    details?: string
    content?: any
    kind?: string
    status?: string
    title?: string
    toolCallId?: string
    rawInput?: any
    rawOutput?: any
    locations?: string
    entries?: {
      content: string
      priority: string
      status: string
    }[]
    askId?: string
    questions?: {
      custom: boolean
      header: string
      multiSelect: boolean
      question: string
      answer?: string
      options: {
        label: string
        description: string
      }[]
    }[]
  }
  onResponseAskUserQuestion?: (askId: string, answers: any) => void
  onReloadSession?: () => void
  onUserInput?: (content: string) => void
}

const MessageItem = ({ message, cli }: { message: MessageType, cli?: ConstsCliName }) => {
  const renderMessage = (message: MessageType) => {
    switch (message.type) {
      case 'agent_message_chunk':
        return <TextMessageItem message={message} />
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
        {dayjs(message.time).format('MM-DD HH:mm:ss')}
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
