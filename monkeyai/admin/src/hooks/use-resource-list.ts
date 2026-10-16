import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { useAppToast } from "@/components/animated-toast-provider"
import { api } from "@/lib/api"
import { base, type ResourceRow } from "@/lib/resources"

export type ResourceType = ResourceRow["ownership_type"]
export const RESOURCE_PAGE_SIZE = 50

type ResourcePage<T> = {
  items?: T[]
  models?: T[]
  next_cursor?: string | null
}

type Result<T> = {
  key: string
  data?: ResourcePage<T>
  error?: string
}

export function useResourcePage<T = ResourceRow>(
  endpoint: string,
  type: ResourceType,
  cursor: string,
  search: string,
  itemsKey: "items" | "models" = "items",
  pageSize = RESOURCE_PAGE_SIZE
) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const [result, setResult] = useState<Result<T>>()
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState(false)
  const lock = useRef(false)
  const query = new URLSearchParams({
    ownership_type: type,
    limit: String(pageSize),
  })
  if (cursor) query.set("cursor", cursor)
  if (search) query.set("q", search)
  const path = `${base}${endpoint}?${query}`
  const key = `${path}:${revision}`
  const current = result?.key === key ? result : undefined
  const reload = useCallback(async () => {
    setRevision((value) => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    api<ResourcePage<T>>(path, { signal: controller.signal, cache: "no-store" })
      .then((data) => {
        if (!disposed) setResult({ key, data })
      })
      .catch((reason: unknown) => {
        if (disposed) return
        const error = reason instanceof Error ? reason.message : String(reason)
        setResult({ key, error })
        showToast({
          status: "error",
          title: error,
          action: { label: t("statistics.retry"), onClick: reload },
        })
      })
    return () => {
      disposed = true
      controller.abort()
    }
  }, [path, key, reload, showToast, t])

  const run = async (action: () => Promise<void>, successMessage?: string) => {
    if (lock.current) return false
    lock.current = true
    setPending(true)
    try {
      await action()
      reload()
      if (successMessage)
        showToast({ status: "success", title: successMessage })
      return true
    } catch (reason: unknown) {
      showToast({
        status: "error",
        title: reason instanceof Error ? reason.message : String(reason),
      })
      return false
    } finally {
      lock.current = false
      setPending(false)
    }
  }

  return {
    items: current?.data?.[itemsKey] ?? [],
    nextCursor: current?.data?.next_cursor ?? "",
    loading: current === undefined,
    error: current?.error ?? "",
    pending,
    reload,
    run,
  }
}

export function useResourceList<T = ResourceRow>(
  endpoint: string,
  itemsKey: "items" | "models" = "items"
) {
  const [type, setType] = useState<ResourceType>("system")
  const [pageSize, setPageSize] = useState(RESOURCE_PAGE_SIZE)
  const [searchDraft, setSearchDraft] = useState("")
  const [search, setSearch] = useState("")
  const [cursors, setCursors] = useState<Record<ResourceType, string[]>>({
    system: [""],
    user: [""],
  })
  const pageCursors = cursors[type]
  const remote = useResourcePage<T>(
    endpoint,
    type,
    pageCursors.at(-1) ?? "",
    search,
    itemsKey,
    pageSize
  )
  const previousPage = (ownership: ResourceType = type) => {
    setCursors((current) => ({
      ...current,
      [ownership]:
        current[ownership].length > 1
          ? current[ownership].slice(0, -1)
          : current[ownership],
    }))
  }
  const nextPage = () => {
    if (remote.loading || remote.pending || !remote.nextCursor) return
    setCursors((current) => ({
      ...current,
      [type]: [...current[type], remote.nextCursor],
    }))
  }
  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (remote.pending) return
    setSearch(searchDraft.trim())
    setCursors({ system: [""], user: [""] })
    remote.reload()
  }
  return {
    ...remote,
    pageSize,
    setPageSize: (size: number) => {
      setPageSize(size)
      setCursors({ system: [""], user: [""] })
    },
    type,
    setType,
    searchDraft,
    setSearchDraft,
    search,
    handleSearch,
    previousPage,
    nextPage,
    page: pageCursors.length,
  }
}
