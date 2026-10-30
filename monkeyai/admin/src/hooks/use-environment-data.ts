import { useCallback, useEffect, useState } from "react"
import { api } from "@/lib/api"

export function useEnvironmentData<T>(path: string | null, poll = false) {
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
          const data = await api<T>(path!, { signal: controller.signal })
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
  }, [path, key, poll])
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  const current = result?.key === key ? result : undefined
  return {
    data: current?.data,
    error: current?.error,
    loading: path !== null && !current,
    refresh,
  }
}
