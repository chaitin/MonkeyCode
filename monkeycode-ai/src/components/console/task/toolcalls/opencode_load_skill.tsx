import type { MessageType } from "../message";

export const renderTitle = (message: MessageType) => {
  return `加载技巧 ${message.data.rawInput?.name ? ` "${message.data.rawInput?.name}"` : ''}`
}

export const renderDetail = (message: MessageType) => {
  return <>
    <pre className="text-xs overflow-auto p-2 bg-accent/50 rounded-md max-h-[50vh]">
      {message.data.rawOutput?.output}
    </pre>
  </>
}