import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import { api } from "@/lib/api"

export function useStatistics<T>(path: string, interval = 0) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    path: string
    revision: number
    data?: T
    error?: string
  }>()
  const lastErrorRef = useRef("")
  const reload = useCallback(() => {
    lastErrorRef.current = ""
    setRevision((value) => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const data = await api<T>(path, { signal: controller.signal })
        if (!controller.signal.aborted) {
          lastErrorRef.current = ""
          setResult({ path, revision, data })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error)
          setResult({ path, revision, error: message })
          if (lastErrorRef.current !== message) {
            lastErrorRef.current = message
            showToast({
              status: "error",
              title: message,
              action: { label: t("statistics.retry"), onClick: reload },
            })
          }
        }
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
  }, [path, revision, interval, reload, showToast, t])

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
