import type { MessageType } from "../message";
import { EditDiffPreview } from "./edit-diff-preview";
import { taskDetailT } from "../task-i18n";

const formatFilePath = (value: unknown) => {
  if (typeof value !== "string") {
    return ""
  }

  return value.replace(/[\r\n\t]+/g, " ").trim()
}

export const renderTitle = (message: MessageType) => {
  const filePath = formatFilePath(message.data.rawInput?.file_path || message.data._meta?.claudeCode?.toolResponse?.filePath)
  const action = message.data.status === "failed"
    ? taskDetailT("toolcall.editFailed")
    : message.data.status === "pending" || message.data.status === "in_progress"
      ? taskDetailT("toolcall.editingFile")
      : taskDetailT("toolcall.editFile")
  return `${action}${filePath ? ` "${filePath}"` : ""}`
}

export const renderDetail = (message: MessageType) => {
  const oldString = message.data.rawInput?.old_string ?? message.data._meta?.claudeCode?.toolResponse?.oldString
  const newString = message.data.rawInput?.new_string
    ?? message.data.rawInput?.content
    ?? message.data._meta?.claudeCode?.toolResponse?.newString
    ?? message.data._meta?.claudeCode?.toolResponse?.content
  const filePath = message.data.rawInput?.file_path ?? message.data._meta?.claudeCode?.toolResponse?.filePath

  return (
    <div 
      className="text-xs p-3"
      style={{ '--diff-font-family': 'var(--font-code)' } as React.CSSProperties}
    >
      <EditDiffPreview filePath={filePath} oldValue={oldString} newValue={newString} padded />
    </div>
  )
}
