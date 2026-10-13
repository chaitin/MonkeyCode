export type Period = { from: string; until: string }
export type ModelOverview = {
  timezone: "UTC"
  generated_at: string
  last_24h: { model_calls: number; input_tokens: number; output_tokens: number }
  last_30m: {
    tpm: number
    rpm: number
    cache_hit_rate: number | null
    p95_response_time: number | null
    p95_first_token_time: number | null
    model_success_rate: number | null
  }
  days: {
    date: string
    model_calls: number
    input_tokens: number
    output_tokens: number
    credits: string
  }[]
}
export type TaskSummary = {
  total: number
  completed: number
  failed: number
  interrupted: number
  unknown: number
  known_outcomes: number
  anomaly_rate: number | null
  completion_rate: number | null
  average_duration_seconds: number | null
  p50_duration_seconds?: number | null
  p95_duration_seconds?: number | null
}
export type TaskStatistics = Period & {
  summary: TaskSummary
  previous: TaskSummary
  trend: {
    at: string
    completed: number
    failed: number
    interrupted: number
    unknown: number
  }[]
  types: (Omit<TaskSummary, "known_outcomes"> & { key: string })[]
}
export type TaskOverview = {
  total_tasks: number
  new_tasks_24h: number
  active_tasks_24h: number
  timezone: "UTC"
  generated_at: string
  days: { date: string; new_tasks: number; active_tasks: number }[]
}

export type UserStatistics = {
  total_users: number
  new_users_24h: number
  active_users_24h: number
  timezone: "UTC"
  generated_at: string
  days: { date: string; new_users: number; active_users: number }[]
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
