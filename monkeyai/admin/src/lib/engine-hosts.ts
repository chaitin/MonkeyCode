import { api } from "./api.ts"

export async function loadEngineHosts<T>(path: string, init?: RequestInit) {
  const items: T[] = []
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ page: String(page), page_size: "100" })
    const result = await api<{ items: T[]; total: number }>(
      path + "?" + query,
      init
    )
    items.push(...result.items)
    if (items.length >= result.total || result.items.length === 0) {
      return { items, total: items.length }
    }
  }
}
