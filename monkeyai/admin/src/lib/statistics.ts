export type ModelOverview = {
  timezone: "Asia/Shanghai"
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
    avg_response_time: number | null
    avg_first_token_time: number | null
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
  timezone: "Asia/Shanghai"
  generated_at: string
  days: { date: string; new_tasks: number; active_tasks: number }[]
}

export type MemberOverview = {
  total_members: number
  last_7d: { active_members: number }
  previous_7d: { active_members: number }
  last_24h: { active_members: number }
  previous_24h: { active_members: number }
  timezone: "Asia/Shanghai"
  generated_at: string
  days: { date: string; new_members: number; active_members: number }[]
}

export type MemberAnalysis = {
  timezone: "Asia/Shanghai"
  generated_at: string
  member: {
    id: string
    name: string
    email: string
    avatar_url: string | null
    status: "active" | "disabled"
    groups: { id: string; name: string }[]
  }
  summary: {
    from: string
    until: string
    tasks: number
    conversations: number
    credits: string
  }
  created_resources: {
    models: number
    knowledge_bases: number | null
    skills: number
    experts: number
    connectors: number
    rules: number
  }
  activity: {
    from: string
    until: string
    days: { date: string; conversations: number }[]
  }
  recent_tasks: {
    id: string
    title: string
    turn_count: number | null
    started_at: string
    last_active_at: string
  }[]
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
