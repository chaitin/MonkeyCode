import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import type {
  AuthorizationSelection,
  AuthorizationGroupNode,
  AuthorizationMember,
} from "@/lib/authorization-groups"
export type Grant = {
  all_users?: boolean
  user_id?: string | null
  group_id?: string | null
  usage_requirement: "optional" | "required"
}
export type ResourceRow = {
  id: string
  name: string
  revision: number
  ownership_type: "system" | "user"
  owner_user_id: string
  owner_name?: string
  description: string
  content: string
  enabled: boolean
  grants: Grant[]
  tags: { id: string; name: string }[]
  package_file_name: string
  file_count: number
  prompt: string
  default_model_id: string | null
  rule_ids: string[]
  skill_ids: string[]
  providers: {
    provider_id: string
    required: boolean
    tool_allowlist: string[]
    tool_denylist: string[]
  }[]
  updated_at: string
  provider_id: string
  url: string
  authorization_mode: "none" | "centralized" | "independent"
  authorization_method: "oauth" | "http_header" | null
  credential_configured: boolean
  icon_path: string
  tool_count: number
  connection_status: "connected" | "error" | "unknown"
  oauth_config: Record<string, string>
  callback_url: string
}
export const base = "/api/admin/v1"
export function selection(
  grants: Grant[] = [],
  required?: boolean
): AuthorizationSelection {
  const gs = grants.filter(
    (g) =>
      required === undefined ||
      (g.usage_requirement === "required") === required
  )
  return {
    allUsers: gs.some((g) => g.all_users),
    groupIds: gs.flatMap((g) => (g.group_id ? [g.group_id] : [])),
    memberIds: gs.flatMap((g) => (g.user_id ? [g.user_id] : [])),
  }
}
export function grants(
  value: AuthorizationSelection,
  required = false
): Grant[] {
  if (value.allUsers) {
    return [
      {
        all_users: true,
        usage_requirement: required ? "required" : "optional",
      },
    ]
  }
  return [
    ...value.groupIds.map((group_id) => ({
      group_id,
      usage_requirement: required
        ? ("required" as const)
        : ("optional" as const),
    })),
    ...value.memberIds.map((user_id) => ({
      user_id,
      usage_requirement: required
        ? ("required" as const)
        : ("optional" as const),
    })),
  ]
}
export function match(revision: number) {
  return { "If-Match": `"${revision}"` }
}
export function saveResource(path: string, body: unknown, revision?: number) {
  return api<ResourceRow>(base + path, {
    method: revision === undefined ? "POST" : "PUT",
    headers: revision === undefined ? {} : match(revision),
    body: JSON.stringify(body),
  })
}
export function useResources<T>(
  path: string,
  convert: (row: ResourceRow) => T
) {
  const [items, setItems] = useState<T[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const lock = useRef(false)
  const reload = useCallback(async () => {
    const result = await listResources(base + path)
    setItems(result.items.map(convert))
  }, [path, convert])
  useEffect(() => {
    let cancelled = false
    listResources(base + path)
      .then((result) => {
        if (!cancelled) setItems(result.items.map(convert))
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path, convert])
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return false
    lock.current = true
    setPending(true)
    setError("")
    try {
      await action()
      await reload()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败")
      return false
    } finally {
      lock.current = false
      setPending(false)
    }
  }
  return { items, reload, run, error, loading, pending }
}
export function useSubjects() {
  const [groups, setGroups] = useState<AuthorizationGroupNode[]>([])
  const [members, setMembers] = useState<AuthorizationMember[]>([])
  const [error, setError] = useState("")
  useEffect(() => {
    let cancelled = false
    api<{
      groups: { id: string; parent_id?: string; name: string }[]
      users: { id: string; name: string; email: string }[]
    }>(base + "/resources/authorization-subjects")
      .then((data) => {
        if (cancelled) return
        const tree = (parent?: string): AuthorizationGroupNode[] =>
          data.groups
            .filter((g) => (g.parent_id ?? undefined) === parent)
            .map((g) => ({
              value: g.id,
              labelKey: g.name,
              children: tree(g.id),
            }))
        setGroups(tree())
        setMembers(data.users.map((u) => ({ ...u, groupId: "" })))
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [])
  const flat = (nodes: AuthorizationGroupNode[]): AuthorizationGroupNode[] =>
    nodes.flatMap((n) => [n, ...flat(n.children ?? [])])
  return { groups, members, flatGroups: flat(groups), error }
}

export async function listResources(
  path: string
): Promise<{ items: ResourceRow[] }> {
  const items: ResourceRow[] = []
  let cursor = ""
  const seen = new Set<string>()
  do {
    const page = await api<{ items: ResourceRow[]; next_cursor?: string }>(
      path +
        (cursor
          ? (path.includes("?") ? "&" : "?") +
            "cursor=" +
            encodeURIComponent(cursor)
          : "")
    )
    items.push(...page.items)
    cursor = page.next_cursor ?? ""
    if (cursor && seen.has(cursor)) throw new Error("资源分页游标重复")
    seen.add(cursor)
  } while (cursor)
  return { items }
}
