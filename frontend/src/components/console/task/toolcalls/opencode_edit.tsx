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
  const filePath = formatFilePath(message.data.rawInput?.filePath)
  const action = message.data.status === "failed"
    ? taskDetailT("toolcall.editFailed")
    : message.data.status === "pending" || message.data.status === "in_progress"
      ? taskDetailT("toolcall.editingFile")
      : taskDetailT("toolcall.editFile")
  return `${action}${filePath ? ` "${filePath}"` : ""}`
}

export const renderDetail = (message: MessageType) => {
  const oldString = message.data.rawInput?.oldString
  const newString = message.data.rawInput?.newString ?? message.data.rawInput?.content
  const filePath = message.data.rawInput?.filePath

  return (
    <div 
      className="text-xs"
      style={{ '--diff-font-family': 'var(--font-code)' } as React.CSSProperties}
    >
      <style>{`
        .user-diff-style .diff-line td:nth-child(2) {
          border-left: 1px var(--border) solid;
        }
      `}</style>
      <EditDiffPreview filePath={filePath} oldValue={oldString} newValue={newString} hunkClassName="user-diff-style" />
    </div>
  )
}
