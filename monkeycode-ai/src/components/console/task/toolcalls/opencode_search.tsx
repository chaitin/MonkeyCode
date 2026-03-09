import type { MessageType } from "../message";


export const renderTitle = (message: MessageType) => {
  return `查找文件${message.data.rawInput?.pattern ? ` "${message.data.rawInput?.pattern}"` : ''}`
}

export const renderDetail = (message: MessageType) => {
  return <pre className="text-xs p-2 bg-accent/50 rounded-md max-h-[50vh] overflow-auto">
    {message.data.rawOutput?.output}
  </pre>
}