import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAppToast } from "@/components/animated-toast-provider"
import { api } from "@/lib/api"
import { base, type ResourceRow } from "@/lib/resources"

export type RuleType = ResourceRow["ownership_type"]
export const RULE_PAGE_SIZE = 48

type RulePage = {
  items: ResourceRow[]
  next_cursor?: string | null
}

type Result = {
  key: string
  data?: RulePage
  error?: string
}

export function useRulePage(type: RuleType, cursor: string, search: string) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const [result, setResult] = useState<Result>()
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState(false)
  const lock = useRef(false)
  const query = new URLSearchParams({
    ownership_type: type,
    limit: String(RULE_PAGE_SIZE),
  })
  if (cursor) query.set("cursor", cursor)
  if (search) query.set("q", search)
  const path = `${base}/rules?${query}`
  const key = `${path}:${revision}`
  const current = result?.key === key ? result : undefined
  const reload = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    api<RulePage>(path, { signal: controller.signal, cache: "no-store" })
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
    items: current?.data?.items ?? [],
    nextCursor: current?.data?.next_cursor ?? "",
    loading: current === undefined,
    error: current?.error ?? "",
    pending,
    reload,
    run,
  }
}
