export const GiB = 1024 ** 3
export const MiB = 1024 ** 2
export type Page<T> = { items: T[]; page: number; page_size: number }
export type Resources = {
  cpu_millis: number
  memory_bytes: number
  host_tasks: number
  temporary_bytes: number
}
export type Capacity = {
  enabled: boolean
  cpu_millis: number
  memory_bytes: number
  max_environments: number
}
export type HostCapacity = Capacity & {
  host_id: string
  architecture: string
  status: string
  protocol: number
  sync_at: string | null
  last_seen_at: string | null
}
export type Quota = {
  host_id: string
  user_id: string
  max_environments: number
}
export type EnvironmentBillingConfig = {
  enabled: boolean
  cpu_credits_per_core_hour: string
  memory_credits_per_gib_hour: string
}
export type EnvironmentBilling = {
  enabled: boolean
  state: "disabled" | "waiting" | "running" | "stopped" | "unknown"
  hourly_credits: string
  settled_credits: string
  settled_seconds: number
  stop_reason?: "insufficient_credits" | "billing_unavailable"
  budget?: {
    balance: string
    hourly_credits: string
    remaining_seconds: number | null
    running_environments: number
    low_balance: boolean
  }
}
export type Environment = {
  billing?: EnvironmentBilling
  billing_stop_reason?: "insufficient_credits" | "billing_unavailable"
  runtime_version?: string
  usage_stale?: boolean
  usage?: { at: string; cpu_cores?: number; memory_bytes?: number }
  connectable?: boolean
  runtime_ready?: boolean
  stale?: boolean
  user?: { name: string; email: string; avatar_url: string }
  host?: { name: string; hostname: string; os_name: string }
  id: string
  name: string
  user_id: string
  host_id: string
  generation: number
  observed_generation: number
  instance_id: string
  desired: "running" | "stopped" | "deleted"
  phase: string
  reason: string
  observed_at: string | null
  storage_retained: boolean
  workload_verified: boolean
  created_at: string
  spec: {
    image: string
    resource: Resources
    volumes: { id: string; purpose: string; bytes: number; inodes: number }[]
    network_policy: string
  }
}
export type Operation = {
  id: string
  generation: number
  desired: string
  status: string
  reason: string
  created_at: string
  finished_at: string | null
}

export function environmentState(
  env: Pick<
    Environment,
    "generation" | "observed_generation" | "phase" | "desired"
  >
) {
  if (env.generation !== env.observed_generation)
    return `pending_${env.desired}`
  return env.phase
}
export function canStop(
  env: Pick<
    Environment,
    "desired" | "phase" | "generation" | "observed_generation"
  >
) {
  return (
    env.desired !== "deleted" &&
    !(
      env.desired === "stopped" &&
      (env.generation !== env.observed_generation || env.phase === "stopped")
    )
  )
}
export function canDelete(
  env: Pick<
    Environment,
    "desired" | "phase" | "generation" | "observed_generation"
  >
) {
  return (
    env.desired !== "deleted" ||
    (env.generation === env.observed_generation && env.phase === "failed")
  )
}
export function hostSyncFresh(
  host: Pick<HostCapacity, "status" | "protocol" | "sync_at" | "last_seen_at">,
  now = Date.now()
) {
  return (
    host.status === "active" &&
    host.protocol === 1 &&
    [host.sync_at, host.last_seen_at].every(
      (value) =>
        value !== null &&
        Number.isFinite(Date.parse(value)) &&
        now - Date.parse(value) <= 90_000
    )
  )
}
export function units(value: string, scale = 1) {
  const scaled = Number(value) * scale
  const number = Math.round(scaled)
  if (
    Math.abs(scaled - number) >
    Math.min(1e-6, Number.EPSILON * Math.abs(scaled) * 2)
  )
    throw new Error("invalid_number")
  if (value.trim() === "" || !Number.isSafeInteger(number) || number < 0)
    throw new Error("invalid_number")
  return number
}
