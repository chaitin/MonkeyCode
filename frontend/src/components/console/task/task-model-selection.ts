interface ResolveTaskModelSelectionOptions {
  availableModelIds: string[]
  currentModelId: string
  preferredModelId: string
  touched: boolean
}

export function resolveTaskModelSelection({
  availableModelIds,
  currentModelId,
  preferredModelId,
  touched,
}: ResolveTaskModelSelectionOptions): string {
  if (!touched) {
    return preferredModelId
  }

  return availableModelIds.includes(currentModelId) ? currentModelId : ""
}
