import type { MessageType } from "../message";
import { taskDetailT } from "../task-i18n";


export const renderTitle = (message: MessageType) => {
  return `${taskDetailT("toolcall.fetchWebpage")}${message.data.rawInput?.url ? ` "${message.data.rawInput?.url}"` : ''}`
}

export const renderDetail = (message: MessageType) => {
  return <>
    <pre className="text-xs p-3">
      {message.data.rawOutput?.output || message.data.rawOutput?.error}
    </pre>
  </>
}
