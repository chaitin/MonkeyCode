import { useEffect, useState } from "react"

import { api } from "@/lib/api"
import {
  normalizeCapabilities,
  NO_CAPABILITIES,
  type Capabilities,
} from "@/lib/capabilities"
import { LICENSE_STATUS_CHANGED } from "@/lib/license"

export function useCapabilities() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)

  useEffect(() => {
    let controller: AbortController | undefined
    const load = () => {
      controller?.abort()
      const request = new AbortController()
      controller = request
      void api<unknown>("/api/auth/v1/capabilities", { signal: request.signal })
        .then((value) => {
          if (!request.signal.aborted)
            setCapabilities(normalizeCapabilities(value))
        })
        .catch(() => {
          if (!request.signal.aborted) setCapabilities(NO_CAPABILITIES)
        })
    }
    const refresh = () => {
      if (document.visibilityState === "visible") load()
    }

    load()
    const timer = window.setInterval(refresh, 30_000)
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener(LICENSE_STATUS_CHANGED, load)
    window.addEventListener("monkeyai-license-changed", load)
    return () => {
      controller?.abort()
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", refresh)
      window.removeEventListener(LICENSE_STATUS_CHANGED, load)
      window.removeEventListener("monkeyai-license-changed", load)
    }
  }, [])

  return capabilities
}
