
export type ModelOverview = {
  timezone: "UTC"
  generated_at: string
  last_24h: { model_calls: number; input_tokens: number; output_tokens: number }
  previous_24h: {
    model_calls: number
    input_tokens: number
    output_tokens: number
  }
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

export function periodChange(
  current: number | null | undefined,
  previous: number | null | undefined
): { direction: "up" | "down" | "flat"; percent: number | null } | undefined {
  if (
    current == null ||
    previous == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    current < 0 ||
    previous < 0
  )
    return undefined
  if (current === previous) return { direction: "flat", percent: 0 }
  if (previous === 0) return { direction: "up", percent: null }
  return {
    direction: current > previous ? "up" : "down",
    percent: (Math.abs(current - previous) / previous) * 100,
  }
}
