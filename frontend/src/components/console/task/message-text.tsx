import "@/utils/plain-text-markdown.css"
import type { MessageType } from "./message"
import { Markdown } from "@/components/common/markdown"

export const TextMessageItem = ({ message, fileLinkEnvid, onWorkspaceFileClick }: { message: MessageType, fileLinkEnvid?: string, onWorkspaceFileClick?: (path: string) => void }) => {
  return (
    <div className="flex flex-col w-full rounded-md px-1 max-w-[100%] mt-0.5">
      <div className="text-sm">
        <Markdown allowHtml fileLinkEnvid={fileLinkEnvid} onWorkspaceFileClick={onWorkspaceFileClick}>{message.data.content || ''}</Markdown>
      </div>
    </div>
  )
}
