import { useCallback, useEffect, useState } from "react"

import { api } from "@/lib/api"

export function useStatistics<T>(path: string, interval = 0) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    path: string
    revision: number
    data?: T
    error?: string
  }>()
  const reload = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const data = await api<T>(path, { signal: controller.signal })
        if (!controller.signal.aborted) setResult({ path, revision, data })
      } catch (error) {
        if (!controller.signal.aborted)
          setResult({
            path,
            revision,
            error: error instanceof Error ? error.message : String(error),
          })
      } finally {
        if (interval > 0 && !controller.signal.aborted) {
          timer = setTimeout(tick, interval)
        }
      }
    }
    function tick() {
      if (document.visibilityState === "hidden")
        timer = setTimeout(tick, interval)
      else void load()
    }
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [path, revision, interval])

  const current =
    result?.path === path && result.revision === revision ? result : undefined
  return {
    data: current?.data,
    lastData: result?.data,
    error: current?.error,
    loading: !current,
    reload,
  }
}
