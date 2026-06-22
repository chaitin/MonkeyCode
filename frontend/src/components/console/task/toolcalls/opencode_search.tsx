import type { MessageType } from "../message";
import { taskDetailT } from "../task-i18n";


export const renderTitle = (message: MessageType) => {
  return `${taskDetailT("toolcall.searchFile")}${message.data.rawInput?.pattern ? ` "${message.data.rawInput?.pattern}"` : ''}`
}

export const renderDetail = (message: MessageType) => {
  return <pre className="text-xs p-3">
    {message.data.rawOutput?.output}
  </pre>
}
