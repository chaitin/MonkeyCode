import type { MessageType } from "../message";


export const renderTitle = (message: MessageType) => {
  return `读取网页内容 ${message.data.rawInput?.url ? ` "${message.data.rawInput?.url}"` : ''}`
}

export const renderDetail = (message: MessageType) => {
  return <>
    <pre className="text-xs p-3">
      {message.data.rawOutput?.output || message.data.rawOutput?.error}
    </pre>
  </>
}