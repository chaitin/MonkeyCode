import type { MessageType } from "../message";

export const renderTitle = (message: MessageType) => {
  return `加载技能 ${message.data.rawInput?.name ? ` "${message.data.rawInput?.name}"` : ''}`
}

export const renderDetail = (message: MessageType) => {
  return <>
    <pre className="text-xs p-3">
      {message.data.rawOutput?.output}
    </pre>
  </>
}