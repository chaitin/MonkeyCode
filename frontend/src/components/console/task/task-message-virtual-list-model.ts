export type TaskMessageVirtualRow =
  | { type: "history-loader" }
  | { type: "message"; messageIndex: number }

export function getTaskMessageVirtualRowCount(messageCount: number, hasHistoryLoader: boolean) {
  return Math.max(messageCount, 0) + (hasHistoryLoader ? 1 : 0)
}

export function getTaskMessageVirtualRow(
  rowIndex: number,
  messageCount: number,
  hasHistoryLoader: boolean,
): TaskMessageVirtualRow | null {
  if (hasHistoryLoader && rowIndex === 0) {
    return { type: "history-loader" }
  }

  const messageIndex = getTaskMessageIndexFromVirtualRow(rowIndex, hasHistoryLoader)
  if (messageIndex === null || messageIndex >= messageCount) {
    return null
  }

  return { type: "message", messageIndex }
}

export function getTaskMessageVirtualRowIndex(messageIndex: number, hasHistoryLoader: boolean) {
  return messageIndex + (hasHistoryLoader ? 1 : 0)
}

export function getTaskMessageIndexFromVirtualRow(rowIndex: number, hasHistoryLoader: boolean) {
  const messageIndex = rowIndex - (hasHistoryLoader ? 1 : 0)
  return messageIndex >= 0 ? messageIndex : null
}
