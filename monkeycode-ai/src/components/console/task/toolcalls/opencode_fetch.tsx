import type { MessageType } from "../message";


export const renderTitle = (message: MessageType) => {
  return `读取网页内容 ${message.data.rawInput?.url ? ` "${message.data.rawInput?.url}"` : ''}`
}

export const renderDetail = (message: MessageType) => {
  return <>
    <pre className="text-xs overflow-auto p-2 bg-accent/50 rounded-md max-h-[50vh]">
      {message.data.rawOutput?.output || message.data.rawOutput?.error}
    </pre>
  </>
}