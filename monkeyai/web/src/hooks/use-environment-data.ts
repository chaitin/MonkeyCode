import { useCallback, useEffect, useState } from "react"
import { useAppToast } from "@/components/animated-toast-provider"
import { api } from "@/lib/api"

export function useEnvironmentData<T>(
  path: string | null,
  poll = false,
  loadData: (path: string, init?: RequestInit) => Promise<T> = api<T>
) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    key: string
    data?: T
    error?: string
  }>()
  const key = `${path}:${revision}`
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let initial = true
    async function load() {
      if (initial || !document.hidden) {
        initial = false
        try {
          const data = await loadData(path!, { signal: controller.signal })
          if (!controller.signal.aborted) setResult({ key, data })
        } catch (error) {
          if (!controller.signal.aborted)
            setResult({
              key,
              error: error instanceof Error ? error.message : String(error),
            })
        }
      }
      if (poll && !controller.signal.aborted) timer = setTimeout(load, 5000)
    }
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [path, key, poll, loadData])
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  const current = result?.key === key ? result : undefined
  return {
    data: current?.data,
    error: current?.error,
    loading: path !== null && !current,
    refresh,
  }
}

// Only the two primary cloud lists notify; detail and filter requests stay quiet.
export function useCloudListData<T>(
  path: string,
  loadData?: (path: string, init?: RequestInit) => Promise<T>
) {
  const result = useEnvironmentData<T>(path, true, loadData)
  const { showToast } = useAppToast()
  const { error } = result
  useEffect(() => {
    if (error) showToast({ status: "error", title: error })
  }, [error, showToast])
  return result
}
