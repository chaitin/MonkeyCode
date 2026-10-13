import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"

type CurrentVersion = { version: string }
type Release = {
  version: string
  upgrade_url: string
  change_logs: string
}

function secureUpgradeURL(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

export function ServiceVersion() {
  const { t } = useTranslation()
  const [current, setCurrent] = useState<string | null>(null)
  const [release, setRelease] = useState<Release | null>(null)

  useEffect(() => {
    let active = true
    void api<CurrentVersion>("/api/admin/v1/version")
      .then((value) => {
        if (active) setCurrent(value.version)
      })
      .catch(() => {})
    void api<Release>("/api/admin/v1/version/release")
      .then((value) => {
        if (active) setRelease(value)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const upgradeURL =
    current && release && release.version !== current
      ? secureUpgradeURL(release.upgrade_url)
      : null

  return (
    <div className="flex min-w-0 items-center justify-between gap-1 px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
      <span className="truncate" title={current ?? undefined}>
        {t("version.current", { version: current ?? "—" })}
      </span>
      {upgradeURL && (
        <Button
          variant="link"
          size="xs"
          render={
            <a
              href={upgradeURL}
              target="_blank"
              rel="noopener noreferrer"
              title={release?.change_logs || undefined}
            />
          }
        >
          {t("version.upgrade", { version: release?.version })}
        </Button>
      )}
    </div>
  )
}
