import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
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

export function AboutCard({ className }: { className?: string }) {
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
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("pages.otherSettings.about")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Item variant="outline">
          <ItemContent className="min-w-0">
            <ItemTitle>{t("version.current")}</ItemTitle>
            <ItemDescription
              className="line-clamp-none break-all"
              title={current ?? undefined}
            >
              {current ?? "—"}
            </ItemDescription>
          </ItemContent>
          {upgradeURL && (
            <ItemActions>
              <Button
                variant="destructive"
                size="sm"
                nativeButton={false}
                render={
                  <a
                    href={upgradeURL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${t("version.available")} · ${t("version.upgrade", { version: release?.version })}`}
                    title={release?.change_logs || undefined}
                  />
                }
              >
                {t("version.available")}
              </Button>
            </ItemActions>
          )}
        </Item>
      </CardContent>
    </Card>
  )
}
