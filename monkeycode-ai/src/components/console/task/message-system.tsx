import "@/utils/plain-text-markdown.css"
import type { MessageType } from "./message"

export const SystemMessageItem = ({ message }: { message: MessageType }) => {
  return (
    <div className="flex w-full items-center justify-center mt-2">
      <div className="bg-muted/50 rounded-full text-xs px-2 py-1 text-muted-foreground">
        {message.data.content}
      </div>
    </div>
  )
}
