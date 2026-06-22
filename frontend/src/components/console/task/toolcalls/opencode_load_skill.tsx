import type { MessageType } from "../message";
import { taskDetailT } from "../task-i18n";

export const renderTitle = (message: MessageType) => {
  return `${taskDetailT("toolcall.loadSkill")}${message.data.rawInput?.name ? ` "${message.data.rawInput?.name}"` : ''}`
}

export const renderDetail = (message: MessageType) => {
  return <>
    <pre className="text-xs p-3">
      {message.data.rawOutput?.output}
    </pre>
  </>
}
