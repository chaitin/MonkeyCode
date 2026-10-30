import { PAGE_SIZE_OPTIONS } from "./pagination.ts"

export type TableFilters = Record<string, string>
export function tableQueryState(
  search: string,
  keys: readonly string[],
  defaultSize = 50
) {
  const params = new URLSearchParams(search)
  const filters: TableFilters = {}
  for (const key of keys) {
    const value = params.get(key)
    if (value) filters[key] = value
  }
  const rawPage = params.get("page") ?? "1"
  const page =
    /^\d+$/.test(rawPage) && Number(rawPage) >= 1 && Number(rawPage) <= 1000000
      ? Number(rawPage)
      : 1
  const rawSize = params.get("page_size") ?? String(defaultSize)
  const pageSize = PAGE_SIZE_OPTIONS.some((size) => size === rawSize)
    ? Number(rawSize)
    : defaultSize
  const filterQuery = new URLSearchParams(filters).toString()
  return { filters, filterQuery, page, pageSize }
}

export function tableQueryParams(
  search: string,
  keys: readonly string[],
  filters: TableFilters,
  page: number,
  pageSize: number,
  defaultSize = 50
) {
  const params = new URLSearchParams(search)
  for (const key of keys) {
    params.delete(key)
    if (filters[key]) params.set(key, filters[key])
  }
  params.delete("page")
  params.delete("page_size")
  if (page > 1) params.set("page", String(page))
  if (pageSize !== defaultSize) params.set("page_size", String(pageSize))
  return params
}

export function queryDate(value: string | undefined, exclusive = false) {
  if (!value) return undefined
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const date = day
    ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
    : new Date(value)
  if (!Number.isFinite(date.getTime())) return undefined
  // Show the last included day when a history API bound is exclusive.
  return new Date(date.getTime() - (exclusive ? 1 : 0))
}

export function queryDateValue(
  value: Date | undefined,
  previous: string | undefined,
  edge: "from" | "inclusiveUntil" | "exclusiveUntil"
) {
  if (!value || !Number.isFinite(value.getTime())) return ""
  // An unchanged picker keeps the original timestamp and submillisecond precision.
  if (
    previous &&
    queryDate(previous, edge === "exclusiveUntil")?.getTime() ===
      value.getTime()
  )
    return previous
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  if (edge === "inclusiveUntil") date.setHours(23, 59, 59, 999)
  if (edge === "exclusiveUntil") date.setDate(date.getDate() + 1)
  return date.toISOString()
}
