import { addDays, format, startOfDay } from "date-fns"
import type { SessionOverview } from "../../src/lib/statistics"

export const taskPreviewModels = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "GPT-5.1",
    provider: "OpenAI",
    weight: 38,
    speed: 1.1,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
    weight: 29,
    speed: 1.4,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "DeepSeek V3.2",
    provider: "DeepSeek",
    weight: 23,
    speed: 0.8,
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    name: "Qwen3 Max",
    provider: "阿里云",
    weight: 17,
    speed: 0.65,
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    weight: 12,
    speed: 1.25,
  },
  {
    id: "00000000-0000-4000-8000-000000000006",
    name: "GLM-4.6",
    provider: "智谱",
    weight: 8,
    speed: 0.9,
  },
] as const

export const taskOutcomes = [
  "complete",
  "error",
  "interrupted",
  "max_turns",
  "output_limit",
  "unknown",
] as const
export type TaskOutcome = (typeof taskOutcomes)[number]
export type TaskPreviewTurn = {
  taskId: string
  modelId: string
  date: string
  startedAt: string
  outcome: TaskOutcome
  seconds: number
}

// Browser-test fixtures only. Production statistics come from the backend API.
export function createTaskPreview(now: Date): TaskPreviewTurn[] {
  const first = addDays(startOfDay(now), -89)
  return Array.from({ length: 90 }, (_, day) => {
    const date = format(addDays(first, day), "yyyy-MM-dd")
    const weekday = addDays(first, day).getDay()
    return taskPreviewModels.flatMap((model, modelIndex) => {
      const growth = 0.7 + day / 180
      const wave = 0.85 + Math.sin(day * 0.65 + modelIndex) * 0.2
      const count = Math.max(
        1,
        Math.round(
          model.weight *
            growth *
            wave *
            (weekday === 0 || weekday === 6 ? 0.55 : 1)
        )
      )
      const dayStart = new Date(`${date}T00:00:00+08:00`).getTime()
      const dayElapsed = Math.max(
        0,
        Math.min(86_400_000, now.getTime() - dayStart)
      )
      return Array.from({ length: count }, (_, index) => {
        const seed = (day * 137 + modelIndex * 71 + index * 43) >>> 0
        const result = seed % 1000
        const outcome: TaskOutcome =
          result < 900
            ? "complete"
            : result < 945
              ? "error"
              : result < 975
                ? "interrupted"
                : result < 984
                  ? "max_turns"
                  : result < 993
                    ? "output_limit"
                    : "unknown"
        return {
          taskId: `preview-task-${day * 7 + Math.floor(index / 3)}`,
          modelId: model.id,
          date,
          startedAt: new Date(
            dayStart + Math.floor((dayElapsed * (index + 1)) / (count + 1))
          ).toISOString(),
          outcome,
          seconds: Math.round(
            (7 + (seed % 68) + (seed % 9 === 0 ? 110 + (seed % 140) : 0)) *
              model.speed
          ),
        }
      })
    })
  }).flat()
}

export function taskPreviewOverview(turns: TaskPreviewTurn[], now: Date) {
  const firstTurns = new Map<string, TaskPreviewTurn>()
  const activeByDate = new Map<string, Set<string>>()
  const active24h = new Set<string>()
  const since = now.getTime() - 86_400_000
  for (const turn of turns) {
    const first = firstTurns.get(turn.taskId)
    if (!first || turn.startedAt < first.startedAt)
      firstTurns.set(turn.taskId, turn)
    const active = activeByDate.get(turn.date) ?? new Set<string>()
    active.add(turn.taskId)
    activeByDate.set(turn.date, active)
    const at = Date.parse(turn.startedAt)
    if (at >= since && at < now.getTime()) active24h.add(turn.taskId)
  }
  const newByDate = new Map<string, number>()
  let new24h = 0
  for (const turn of firstTurns.values()) {
    newByDate.set(turn.date, (newByDate.get(turn.date) ?? 0) + 1)
    const at = Date.parse(turn.startedAt)
    if (at >= since && at < now.getTime()) new24h++
  }
  const firstDay = addDays(startOfDay(now), -89)
  return {
    total_tasks: firstTurns.size,
    new_tasks_24h: new24h,
    active_tasks_24h: active24h.size,
    timezone: "Asia/Shanghai" as const,
    generated_at: now.toISOString(),
    days: Array.from({ length: 90 }, (_, index) => {
      const date = format(addDays(firstDay, index), "yyyy-MM-dd")
      return {
        date,
        new_tasks: newByDate.get(date) ?? 0,
        active_tasks: activeByDate.get(date)?.size ?? 0,
      }
    }),
  }
}

export function summarizeTaskPreview(turns: TaskPreviewTurn[]) {
  const counts = Object.fromEntries(
    taskOutcomes.map((outcome) => [outcome, 0])
  ) as Record<TaskOutcome, number>
  const durations = turns.map((turn) => turn.seconds).sort((a, b) => a - b)
  for (const turn of turns) counts[turn.outcome]++
  const known = turns.length - counts.unknown
  const percentile = (value: number) =>
    durations[Math.max(0, Math.ceil(durations.length * value) - 1)] ?? 0
  return {
    ...counts,
    total: turns.length,
    tasks: new Set(turns.map((turn) => turn.taskId)).size,
    successRate: known ? counts.complete / known : null,
    average: turns.length
      ? durations.reduce((sum, value) => sum + value, 0) / turns.length
      : 0,
    p10: percentile(0.1),
    p90: percentile(0.9),
  }
}

export function summarizeTaskMessageCounts(turns: TaskPreviewTurn[]) {
  const messagesByTask = new Map<string, number>()
  for (const turn of turns)
    messagesByTask.set(turn.taskId, (messagesByTask.get(turn.taskId) ?? 0) + 1)
  const counts = [...messagesByTask.values()].sort((a, b) => a - b)
  const percentile = (value: number) =>
    counts[Math.max(0, Math.ceil(counts.length * value) - 1)] ?? 0
  return {
    sessions: counts.length,
    average: counts.length ? turns.length / counts.length : 0,
    p10: percentile(0.1),
    p90: percentile(0.9),
  }
}

export function createSessionOverviewFixture(now: Date): SessionOverview {
  const turns = createTaskPreview(now)
  const overview = taskPreviewOverview(turns, now)
  const recent = turns.filter(
    (turn) =>
      Date.parse(turn.startedAt) >= now.getTime() - 86_400_000 &&
      Date.parse(turn.startedAt) < now.getTime()
  )
  const summary = summarizeTaskPreview(recent)
  const counts = summarizeTaskMessageCounts(recent)
  return {
    timezone: "Asia/Shanghai",
    generated_at: now.toISOString(),
    total_sessions: overview.total_tasks,
    new_sessions_24h: overview.new_tasks_24h,
    active_sessions_24h: overview.active_tasks_24h,
    total_messages: turns.length,
    last_24h: {
      from: new Date(now.getTime() - 86_400_000).toISOString(),
      until: now.toISOString(),
      messages: recent.length,
      outcomes: Object.fromEntries(
        taskOutcomes.map((outcome) => [outcome, summary[outcome]])
      ) as SessionOverview["last_24h"]["outcomes"],
      duration_seconds: {
        average: summary.average,
        p10: summary.p10,
        p90: summary.p90,
      },
      messages_per_session: {
        average: counts.average,
        p10: counts.p10,
        p90: counts.p90,
      },
      models: taskPreviewModels
        .map((model) => ({
          id: model.id,
          name: model.name,
          messages: recent.filter((turn) => turn.modelId === model.id).length,
        }))
        .filter((model) => model.messages > 0)
        .sort((a, b) => b.messages - a.messages || a.id.localeCompare(b.id)),
    },
    days: overview.days.map((day) => ({
      date: day.date,
      new_sessions: day.new_tasks,
      active_sessions: day.active_tasks,
      messages: turns.filter((turn) => turn.date === day.date).length,
    })),
  }
}

export function emptySessionOverviewFixture(now: Date): SessionOverview {
  const overview = createSessionOverviewFixture(now)
  return {
    ...overview,
    total_sessions: 0,
    new_sessions_24h: 0,
    active_sessions_24h: 0,
    total_messages: 0,
    last_24h: {
      ...overview.last_24h,
      messages: 0,
      outcomes: Object.fromEntries(
        taskOutcomes.map((outcome) => [outcome, 0])
      ) as SessionOverview["last_24h"]["outcomes"],
      duration_seconds: { average: null, p10: null, p90: null },
      messages_per_session: { average: null, p10: null, p90: null },
      models: [],
    },
    days: overview.days.map((day) => ({
      ...day,
      new_sessions: 0,
      active_sessions: 0,
      messages: 0,
    })),
  }
}

export function taskPreviewDays(
  turns: TaskPreviewTurn[],
  now: Date,
  range: number
) {
  const first = addDays(startOfDay(now), 1 - range)
  const grouped = new Map<string, TaskPreviewTurn[]>()
  for (const turn of turns) {
    const group = grouped.get(turn.date) ?? []
    group.push(turn)
    grouped.set(turn.date, group)
  }
  return Array.from({ length: range }, (_, index) => {
    const date = format(addDays(first, index), "yyyy-MM-dd")
    return { date, ...summarizeTaskPreview(grouped.get(date) ?? []) }
  })
}
