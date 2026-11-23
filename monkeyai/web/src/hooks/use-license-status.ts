import { useEffect, useState } from "react"

import { api } from "@/lib/api"
import { LICENSE_STATUS_CHANGED, type LicenseInfo } from "@/lib/license"

export function useLicenseStatus() {
  const [info, setInfo] = useState<LicenseInfo | null>(null)

  useEffect(() => {
    let controller: AbortController | undefined
    const load = () => {
      controller?.abort()
      const request = new AbortController()
      controller = request
      void api<LicenseInfo>("/api/admin/v1/license/status", {
        signal: request.signal,
      })
        .then((status) => {
          if (!request.signal.aborted) setInfo(status)
        })
        .catch(() => {
          if (!request.signal.aborted) setInfo(null)
        })
    }
    const refresh = () => {
      if (document.visibilityState === "visible") load()
    }
    const onImported = (event: Event) => {
      controller?.abort()
      setInfo((event as CustomEvent<LicenseInfo>).detail)
    }

    load()
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener(LICENSE_STATUS_CHANGED, onImported)
    return () => {
      controller?.abort()
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", refresh)
      window.removeEventListener(LICENSE_STATUS_CHANGED, onImported)
    }
  }, [])

  return info
}
