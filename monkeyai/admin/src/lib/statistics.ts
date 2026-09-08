export type Period = { from: string; until: string }
export type ModelSummary = {
  calls: number
  input_tokens: number
  output_tokens: number
  cache_hit_rate: number | null
  success_rate: number | null
  credits: string
}
export type ModelStatistics = Period & {
  summary: ModelSummary
  previous: ModelSummary
  models: { id: string; name: string; deleted: boolean }[]
  trend: {
    at: string
    calls: number
    input_tokens: number
    output_tokens: number
    credits: string
  }[]
}
export type TaskSummary = {
  total: number
  completed: number
  failed: number
  running: number
  completion_rate: number | null
  average_duration_seconds: number | null
}
export type TaskStatistics = Period & {
  summary: TaskSummary
  previous: TaskSummary
  trend: { at: string; completed: number; failed: number; running: number }[]
  types: (TaskSummary & { key: string })[]
}
export type RealtimeStatistics = Period & {
  model_consumption: string
  p95_response_time: number | null
  model_success_rate: number | null
  model_calls: number
  tpm: number
  rpm: number
  input_tokens: number
  output_tokens: number
  active_users: number
  active_tasks: number
  new_tasks: number
}

export function change(
  current: number | null,
  previous: number | null,
  locale: string,
  points = false
): string | undefined {
  if (current === null || previous === null || (!points && previous === 0))
    return undefined
  const delta = points
    ? current - previous
    : ((current - previous) / Math.abs(previous)) * 100
  return `${new Intl.NumberFormat(locale, { signDisplay: "exceptZero", maximumFractionDigits: 1 }).format(delta)}${points ? " pp" : "%"}`
}
