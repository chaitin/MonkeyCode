import "@/utils/plain-text-markdown.css"
import type { MessageType } from "./message"
import { Markdown } from "@/components/common/markdown"

export const TextMessageItem = ({ message }: { message: MessageType }) => {
  return (
    <div className="flex flex-col w-full rounded-md px-1 max-w-[100%] mt-0.5">
      <div className="text-sm">
        <Markdown allowHtml>{message.data.content || ''}</Markdown>
      </div>
    </div>
  )
}
