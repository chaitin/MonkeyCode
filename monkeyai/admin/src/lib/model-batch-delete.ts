import { api } from "./api.ts"

type ModelTarget = {
  id: string
  displayName: string
  type: "system" | "user"
}

type Request = (path: string, init: RequestInit) => Promise<unknown>

export async function deleteModelBatch(
  models: readonly ModelTarget[],
  request: Request = api,
  onProgress?: (progress: { completed: number; total: number }) => void
) {
  const selected = [
    ...new Map(
      models.filter((model) => model.type === "system").map((model) => [model.id, model])
    ).values(),
  ]
  const succeeded: string[] = []
  const failed: { id: string; name: string; message: string }[] = []
  for (const [index, model] of selected.entries()) {
    try {
      await request(`/api/admin/v1/models/${model.id}`, { method: "DELETE" })
      succeeded.push(model.id)
    } catch (reason) {
      failed.push({
        id: model.id,
        name: model.displayName,
        message: reason instanceof Error ? reason.message : String(reason),
      })
    }
    onProgress?.({ completed: index + 1, total: selected.length })
  }
  return { succeeded, failed }
}
