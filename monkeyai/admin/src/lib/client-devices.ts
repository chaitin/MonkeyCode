export type DeviceFilters = Partial<
  Record<
    | "query"
    | "user_id"
    | "platform"
    | "client_type"
    | "client_version"
    | "arch"
    | "status"
    | "from"
    | "until",
    string
  >
>
export type ClientDevice = {
  id: string
  user_id: string
  machine_id: string
  user_name: string | null
  user_email: string | null
  user_avatar_url: string | null
  user_deleted: boolean
  device_name: string
  alias: string | null
  platform: string
  os_version: string
  arch: string
  client_type: string | null
  client_name: string | null
  client_version: string
  locale: string | null
  system_locale: string | null
  timezone: string | null
  runtime_version: string | null
  engine_version: string | null
  status: "active" | "revoked"
  created_at: string
  updated_at: string
  last_seen_at: string | null
  last_reported_at: string | null
  last_active_at: string | null
}
export type DevicePage = {
  items: ClientDevice[]
  page: number
  page_size: number
  has_next: boolean
}
export type DeviceDistributionDimension =
  "client_type" | "platform" | "client_version"
export type DeviceOverview = {
  metric: "devices"
  total: number
  users: number
  distributions: Record<
    DeviceDistributionDimension,
    { value: string | null; count: number }[]
  >
}
export const devicePaths = {
  list: "/api/admin/v1/endpoints",
  overview: "/api/admin/v1/endpoints/overview",
}
export function deviceQuery(filters: DeviceFilters) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters))
    if (value?.trim()) query.set(key, value.trim())
  return query.toString()
}
export function devicePlatform(value: string) {
  const labels: Record<string, string> = {
    windows: "Windows",
    macos: "macOS",
    linux: "Linux",
    ios: "iOS",
    android: "Android",
    web: "Web",
  }
  const key = value.toLowerCase()
  return Object.hasOwn(labels, key) ? labels[key] : value
}
