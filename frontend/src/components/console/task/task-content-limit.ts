export const MAX_TASK_CONTENT_LENGTH = 10000

export function getTaskContentLimitErrorMessage() {
  return `输入内容不能超过 ${MAX_TASK_CONTENT_LENGTH} 字`
}
