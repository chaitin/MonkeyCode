// Thin typed wrapper around the public /api/v1/skills and /api/v1/plugins
// endpoints that power the task-creation pickers. The mcai-gh frontend does
// not surface any of the resource-management CRUD (rules / repos / agents):
// those live on the admin console (mcai-admin-new) per the agent-resources
// slim spec §7.4. This module only exposes the read-only listing types that
// the task-input components consume.

// Backend response envelope used by GoYoko/v1 routes.
type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...(init ?? {}),
    headers: {
      ...(init?.body && typeof init.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (res.status === 401) {
    if (
      window.location.pathname.includes("/console") ||
      window.location.pathname.includes("/manager")
    ) {
      window.location.href = "/login"
    }
    throw new Error("未登录")
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }
  const json = (await res.json()) as ApiResponse<T>
  if (json.code !== 0) {
    throw new Error(json.message || "请求失败")
  }
  return json.data
}

// ---- Task-creation pickers (skills / plugins listing) ----
//
// The /api/v1/skills and /api/v1/plugins listing endpoints (mcai-backend, see
// agent-resources slim spec §7.4) return a flat array of "ready-to-pick"
// items: only active, non-orphan resources.

/** Item returned by GET /api/v1/plugins (task-creation picker). */
export type PluginListItem = {
  id: string
  name: string
  description: string
  entry: string
  active_version?: string
  is_force_delivery: boolean
}

export function fetchPluginListing(): Promise<PluginListItem[]> {
  return request<PluginListItem[] | null>(`/api/v1/plugins`).then(
    (data) => data ?? []
  )
}

/** Item returned by GET /api/v1/skills (task-creation picker). */
export type SkillListItem = {
  id: string
  name: string
  description?: string
  tags?: string[]
  categories?: string[]
  args_schema?: Record<string, unknown>
  content?: string
  /** Skill ID surfaced by the swagger model — kept for backward compatibility. */
  skill_id?: string
  is_force_delivery?: boolean
}
