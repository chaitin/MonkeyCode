import { api } from "./api.ts"
import type { AuthorizationSelection } from "./authorization-groups"
import type { ResourceRow } from "./resources"

export type ResourceBatchKind = "skill" | "expert" | "connector" | "rule"
export type ResourceBatchChange =
  | { action: "enable" }
  | { action: "disable" }
  | { action: "delete" }
  | { action: "tags"; tagIds: string[] }
  | { action: "authorization"; authorization: AuthorizationSelection }
export type ResourceBatchResource = Pick<
  ResourceRow,
  | "id"
  | "name"
  | "description"
  | "ownership_type"
  | "origin"
  | "revision"
  | "grants"
> &
  Partial<Pick<ResourceRow, "prompt" | "content">>
export type ResourceBatchProgress = { completed: number; total: number }
export type ResourceBatchResult = {
  succeeded: string[]
  skipped: string[]
  failed: { id: string; name: string; message: string }[]
}

type Request = (path: string, init: RequestInit) => Promise<unknown>
const endpoints: Record<ResourceBatchKind, string> = {
  skill: "skills",
  expert: "experts",
  connector: "connectors",
  rule: "rules",
}

export async function applyResourceBatch(
  kind: ResourceBatchKind,
  resources: readonly ResourceBatchResource[],
  change: ResourceBatchChange,
  request: Request = api,
  onProgress?: (progress: ResourceBatchProgress) => void
): Promise<ResourceBatchResult> {
  const selected = [
    ...new Map(resources.map((item) => [item.id, item])).values(),
  ]
  const result: ResourceBatchResult = { succeeded: [], skipped: [], failed: [] }
  const update: ResourceBatchChange =
    change.action === "tags"
      ? { action: "tags", tagIds: [...change.tagIds] }
      : change.action === "authorization"
        ? {
            action: "authorization",
            authorization: {
              groupIds: [...change.authorization.groupIds],
              memberIds: [...change.authorization.memberIds],
            },
          }
        : { ...change }

  for (const [index, item] of selected.entries()) {
    try {
      if (
        item.ownership_type !== "system" ||
        (item.origin === "package" &&
          (update.action === "tags" || update.action === "delete"))
      ) {
        result.skipped.push(item.id)
        continue
      }
      const path = `/api/admin/v1/${endpoints[kind]}/${item.id}`
      const headers = { "If-Match": `"${item.revision}"` }
      if (update.action === "enable" || update.action === "disable") {
        await request(`${path}/enabled`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ enabled: update.action === "enable" }),
        })
      } else if (update.action === "delete") {
        await request(path, { method: "DELETE", headers })
      } else if (update.action === "tags") {
        // Save validators require the canonical prompt/content for these kinds.
        // Omitted associations, credentials, grants and enabled remain untouched.
        await request(path, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            name: item.name,
            description: item.description,
            ...(kind === "expert" ? { prompt: item.prompt } : {}),
            ...(kind === "rule" ? { content: item.content } : {}),
            tag_ids: [...new Set(update.tagIds)],
          }),
        })
      } else {
        const requirements = new Map(
          item.grants.map((grant) => [
            grant.group_id
              ? `group:${grant.group_id}`
              : `user:${grant.user_id}`,
            grant.usage_requirement,
          ])
        )
        const groupGrants = [...new Set(update.authorization.groupIds)].map(
          (group_id) => ({
            group_id,
            usage_requirement:
              requirements.get(`group:${group_id}`) ?? "optional",
          })
        )
        const userGrants = [...new Set(update.authorization.memberIds)].map(
          (user_id) => ({
            user_id,
            usage_requirement:
              requirements.get(`user:${user_id}`) ?? "optional",
          })
        )
        await request(`/api/admin/v1/resources/${kind}/${item.id}/grants`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ grants: [...groupGrants, ...userGrants] }),
        })
      }
      result.succeeded.push(item.id)
    } catch (reason) {
      result.failed.push({
        id: item.id,
        name: item.name,
        message: reason instanceof Error ? reason.message : String(reason),
      })
    } finally {
      onProgress?.({ completed: index + 1, total: selected.length })
    }
  }
  return result
}
