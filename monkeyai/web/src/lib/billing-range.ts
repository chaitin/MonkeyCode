function localDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}

export function billingDateDefaults(
  search: string,
  now = new Date()
): Record<string, string> {
  const params = new URLSearchParams(search)
  if (
    params.has("from") ||
    params.has("until") ||
    params.get("range") === "all"
  )
    return {}
  const from = new Date(now)
  from.setDate(from.getDate() - 27)
  return { from: localDate(from), until: localDate(now) }
}

export function billingPageParams(
  search: string,
  now = new Date()
): URLSearchParams {
  const params = new URLSearchParams(search)
  Object.entries(billingDateDefaults(search, now)).forEach(([key, value]) =>
    params.set(key, value)
  )
  return params
}

// The picker includes its final date; the API uses an exclusive upper bound.
export function billingExclusiveUntil(value: Date): Date {
  const result = new Date(value)
  result.setHours(0, 0, 0, 0)
  result.setDate(result.getDate() + 1)
  return result
}
