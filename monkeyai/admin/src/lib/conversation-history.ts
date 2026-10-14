export type ConversationOutcome =
  | "complete"
  | "interrupted"
  | "error"
  | "max_turns"
  | "output_limit"
  | "unknown"

export type Conversation = {
  session_id: string
  turn_index: number
  task_title: string
  user_id: string
  user_name: string
  user_email: string
  started_at: string
  ended_at: string
  duration_seconds: number
  input_text: string | null
  input_text_truncated: boolean
  input_kind: string
  input_tokens: number | null
  output_tokens: number | null
  outcome: ConversationOutcome
  error_code: string | null
  is_completed: boolean | null
}

export type ConversationPage = {
  items: Conversation[]
  total: number
  page: number
  page_size: number
}

export function conversationResult(outcome: ConversationOutcome) {
  switch (outcome) {
    case "complete":
      return "completed"
    case "interrupted":
      return "interrupted"
    case "error":
      return "failed"
    case "max_turns":
    case "output_limit":
      return "incomplete"
    default:
      return "unknown"
  }
}

export function conversationQuery(
  filters: {
    taskName: string
    taskId: string
    user: string
    content: string
    from?: string
    until?: string
  },
  page: number,
  pageSize: number
) {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })
  for (const [key, value] of [
    ["task", filters.taskName],
    ["task_id", filters.taskId],
    ["user", filters.user],
    ["content", filters.content],
  ]) {
    const trimmed = value.trim()
    if (trimmed) query.set(key, trimmed)
  }
  if (filters.from) query.set("from", filters.from)
  if (filters.until) query.set("until", filters.until)
  return query.toString()
}
