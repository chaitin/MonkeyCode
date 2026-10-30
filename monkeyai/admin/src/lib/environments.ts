export const GiB = 1024 ** 3
export const MiB = 1024 ** 2
export type Page<T> = { items: T[]; page: number; page_size: number }
export type Profile = {
  architecture: "amd64" | "arm64"
  image: string
  network_policy: "isolated" | "public-only"
  resource: {
    cpu_millis: number
    memory_bytes: number
    host_tasks: number
    temporary_bytes: number
  }
  storage: {
    workspace_bytes: number
    home_bytes: number
    runtime_bytes: number
    inodes: number
  }
}
export type Preset = {
  id: string
  name: string
  enabled: boolean
  configuration: Profile
  created_at: string
}
export type Capacity = {
  enabled: boolean
  cpu_millis: number
  memory_bytes: number
  storage_bytes: number
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
  user_id: string
  max_environments: number
  max_running: number
  cpu_millis: number
  memory_bytes: number
  storage_bytes: number
}
export type Environment = {
  id: string
  name: string
  user_id: string
  host_id: string
  preset_id: string
  generation: number
  observed_generation: number
  instance_id: string
  desired: "running" | "stopped" | "deleted"
  phase: string
  reason: string
  observed_at: string | null
  compute_reserved: boolean
  storage_retained: boolean
  workload_verified: boolean
  created_at: string
  spec: {
    image: string
    resource: Profile["resource"]
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
