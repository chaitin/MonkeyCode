import type { DomainProviderModelListItem } from "@/api/Api"

interface ProviderModelGroup {
  key: string
  models: DomainProviderModelListItem[]
}

function getProviderModelCommandValue(modelId: string): string {
  return JSON.stringify(modelId)
}

function filterAndGroupProviderModels(
  models: DomainProviderModelListItem[],
  query: string,
  fallbackGroup: string,
): ProviderModelGroup[] {
  const normalizedQuery = query.trim().toLowerCase()
  const seenModelIds = new Set<string>()
  const groups = new Map<string, DomainProviderModelListItem[]>()

  for (const item of models) {
    const originalModelId = item.model
    const modelId = originalModelId?.trim()
    if (!originalModelId || !modelId || seenModelIds.has(originalModelId)) continue
    seenModelIds.add(originalModelId)
    if (!modelId.toLowerCase().includes(normalizedQuery)) continue

    const groupKey = modelId.split("-")[0] || fallbackGroup
    const group = groups.get(groupKey) ?? []
    group.push(item)
    groups.set(groupKey, group)
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, groupModels]) => ({
      key,
      models: groupModels.sort((left, right) =>
        (left.model ?? "").localeCompare(right.model ?? ""),
      ),
    }))
}

export {
  filterAndGroupProviderModels,
  getProviderModelCommandValue,
  type ProviderModelGroup,
}
