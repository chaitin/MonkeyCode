import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUp02Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons"

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
    <div className="space-y-3 px-2 pb-2 group-data-[collapsible=icon]:hidden">
      {upgradeURL && (
        <a
          href={upgradeURL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${t("version.available")} · ${t("version.upgrade", { version: release?.version })}`}
          title={release?.change_logs || undefined}
          className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-background p-3 text-sidebar-foreground shadow-xs transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent">
            <HugeiconsIcon
              icon={ArrowUp02Icon}
              strokeWidth={2}
              className="size-4"
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">{t("version.available")}</p>
            <p className="text-xs break-all text-muted-foreground">
              {release?.version}
            </p>
          </div>
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            strokeWidth={2}
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </a>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 px-1 text-xs text-muted-foreground">
        <span>{t("version.current")}</span>
        <span className="min-w-0 break-all" title={current ?? undefined}>
          {current ?? "—"}
        </span>
      </div>
    </div>
  )
}
