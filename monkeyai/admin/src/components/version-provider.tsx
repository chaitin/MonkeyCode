import { useEffect, useState, type ReactNode } from "react"

import { api } from "@/lib/api"
import {
  secureUpgradeURL,
  VersionContext,
  type Release,
} from "@/lib/version-context"

export function VersionProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<string | null>(null)
  const [release, setRelease] = useState<Release | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void api<{ version: string }>("/api/admin/v1/version", {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setCurrent(value.version)
      })
      .catch(() => {})
    void api<Release>("/api/admin/v1/version/release", {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setRelease(value)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  const upgradeURL =
    current && release?.version && release.version !== current
      ? secureUpgradeURL(release.upgrade_url)
      : null

  return (
    <VersionContext.Provider value={{ current, release, upgradeURL }}>
      {children}
    </VersionContext.Provider>
  )
}
