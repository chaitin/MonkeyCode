import { useCallback, useEffect, useState } from "react"
import { ApiError, api } from "@/lib/api"

export type ReportWindow = {
  from: string
  until: string
  group_id?: string
  user_id?: string
  model_id?: string
  expert_id?: string
  client_type?: string
  platform?: string
  outcome?: string
  resource_id?: string
  resource_version?: string
  include_placeholders?: boolean
}

export type ReportMeta = {
  generated_at: string
  from: string
  until: string
  data_freshness_seconds: number | null
}
export type ReportPage<T> = ReportMeta & {
  items: T[]
  next_cursor: string | null
  pagination: "cursor"
}
export type ReportOverview = ReportMeta & {
  sessions: number
  placeholders: number
  clock_suspect: number
  turns: number
  complete: number
  anomalies: number
  interrupted: number
  unknown: number
  completion_rate: number | null
  anomaly_rate: number | null
  average_duration_seconds: number | null
  p50_duration_seconds: number | null
  p95_duration_seconds: number | null
  input_tokens: number
  output_tokens: number
  credits: string
  recent_active_tasks: number
  recovered: number
  average_reporting_delay_seconds: number | null
  trend: { at: string; turns: number; complete: number; anomalies: number }[]
  outcomes: { outcome: string; turns: number }[]
}
export type ReportSession = {
  id: string
  owner_user_id: string
  group_id: string | null
  expert_id: string | null
  model_id: string | null
  client_type: string
  platform: string | null
  client_version: string | null
  started_at: string
  last_active_at: string | null
  active_seconds: number
  placeholder: boolean
  clock_suspect: boolean
  turns: number
  last_outcome: string | null
  subsessions: number
  credits: string
  tombstone: boolean
}
export type ReportTurn = {
  turn_index: number
  started_at: string
  ended_at: string
  duration_seconds: number
  outcome: string
  error_code: string | null
  input_kind: string | null
  input_tokens: number | null
  output_tokens: number | null
  recovered: boolean
  resources_snapshot_id: string | null
  tools: number
  skills: number
}
export type ReportTool = {
  turn_index: number
  category: string
  resource_id: string | null
  resource_version: string | null
  calls: number
  failed: number
  duration_ms: number
}
export type ReportSkill = {
  turn_index: number
  skill_id: string
  version: string | null
  trigger: string
  events: number
  succeeded: number
}
export type ReportResource = {
  resource_id: string
  kind: string
  version: string | null
  enabled: boolean
  available: boolean
  snapshots: number
}
export type ReportCall = {
  kind: string
  status: string
  calls: number
  input_tokens: number | null
  output_tokens: number | null
}
export type ReportChild = {
  id: string
  parent_session_id: string
  started_at: string
  turns: number
  last_outcome: string | null
  active_seconds: number
}
export type ReportDetail = ReportMeta &
  Omit<ReportSession, "turns" | "subsessions" | "platform"> & {
    parent_session_id: string | null
    engine_version: string | null
    runtime_version: string | null
    ended_at: string | null
    updated_at: string
    tools: ReportTool[]
    skills: ReportSkill[]
    resources: ReportResource[]
    calls: ReportCall[]
    subsessions: ReportChild[]
    turns: ReportTurn[]
    detail_limit: number
  }
export type ReportResourceRow = Pick<
  ReportResource,
  "kind" | "resource_id" | "version"
> & {
  enabled_sessions: number
  available_sessions: number
  used_sessions: number
  calls: number
  failed: number
  failure_rate: number | null
  sort_key: string
}
export type ReportClient = {
  client_type: string
  platform: string | null
  os_version: string | null
  locale: string | null
  timezone: string | null
  client_version: string | null
  engine_version: string | null
  runtime_version: string | null
  sessions: number
  turns: number
  interrupted: number
  completion_rate: number | null
  anomaly_rate: number | null
  p95_duration_seconds: number | null
  last_active_at: string | null
  sort_key: string
}

const root = "/api/admin/v1/statistics/session-reporting"
export const reportPaths = {
  overview: `${root}/overview`,
  sessions: `${root}/sessions`,
  detail: (id: string) => `${root}/sessions/${encodeURIComponent(id)}`,
  resources: `${root}/resources`,
  clients: `${root}/clients`,
}

export function defaultWindow(): ReportWindow {
  const now = Date.now()
  return {
    from: new Date(now - 86400000).toISOString(),
    until: new Date(now).toISOString(),
  }
}

export function reportQuery(filters: ReportWindow, cursor?: string) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== "" && value !== undefined && value !== false)
      params.set(key, String(value))
  }
  if (cursor) params.set("cursor", cursor)
  return `?${params.toString()}`
}

export function useReport<T>(path: string, interval = 0) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    path: string
    data?: T
    error?: number | "timeout" | "network"
    updated?: Date
    stale?: boolean
  }>()
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    let timedOut = false
    async function load() {
      timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, 20000)
      try {
        const data = await api<T>(path, {
          signal: controller.signal,
          cache: "no-store",
        })
        if (!controller.signal.aborted)
          setResult({ path, data, updated: new Date() })
      } catch (error) {
        if (!disposed) {
          const status = error instanceof ApiError ? error.status : undefined
          const protectedError =
            status === 401 || status === 403 || status === 404 || status === 410
          setResult((previous) => ({
            path,
            data: protectedError ? undefined : previous?.data,
            updated: protectedError ? undefined : previous?.updated,
            stale: previous?.path !== path || previous?.stale,
            error: timedOut ? "timeout" : (status ?? "network"),
          }))
        }
      } finally {
        clearTimeout(timeout)
        if (interval && !controller.signal.aborted)
          timer = setTimeout(load, interval)
      }
    }
    void load()
    return () => {
      disposed = true
      controller.abort()
      clearTimeout(timer)
      clearTimeout(timeout)
    }
  }, [path, revision, interval])
  const current = result?.path === path ? result : undefined
  return {
    data: current?.data,
    error: current?.error,
    updated: current?.updated,
    stale: current?.stale,
    loading: !current,
    reload,
  }
}
