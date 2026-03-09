import "@/utils/plain-text-markdown.css"
import type { MessageType } from "./message"
import { useMemo } from "react"
import { IconLoader } from "@tabler/icons-react"

export const RestartSessionMessageItem = ({ message }: { message: MessageType }) => {

  const statusIcon = useMemo(() => {
    switch (message.data.status) {
      case 'pending':
        return <IconLoader className="size-4 animate-spin" />
      default:
        return null
    }
  }, [message.data.status])
  
  const reloadText = useMemo(() => {
    switch (message.data.status) {
      case 'pending':
        return '正在重新加载开发工具'
      case 'completed':
        return '开发工具已重新加载'
      default:
        return message.data.status
    }
  }, [message.data.status])

  const resetText = useMemo(() => {
    switch (message.data.status) {
      case 'pending':
        return '正在重置上下文'
      case 'completed':
        return '上下文已重置'
      default:
        return message.data.status
    }
  }, [message.data.status])

  if (message.data.kind === 'reload') {
    return (
      <div className="flex w-full items-center justify-center mt-2">
        <div className="bg-muted/50 rounded-full text-xs px-2 py-1 text-muted-foreground flex items-center gap-2">
          {statusIcon}
          {reloadText}
        </div>
      </div>
    )
  }

  if (message.data.kind === 'reset') {
    return (
      <div className="w-full mt-5 px-1 relative h-8 flex items-center">
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 w-full h-0.5 bg-border" />
        <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 bg-background rounded-full text-xs px-2 py-1 text-foreground/70 flex items-center gap-2">
          {statusIcon}
          {resetText}
        </div>
      </div>
    )
  }

  return null
}
