import { useContext } from "react"
import { useTranslation } from "react-i18next"

import { VersionUpgradeButton } from "@/components/version-upgrade-button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
import { VersionContext } from "@/lib/version-context"

export function AboutCard({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { current, upgradeURL } = useContext(VersionContext)

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
              <VersionUpgradeButton />
            </ItemActions>
          )}
        </Item>
      </CardContent>
    </Card>
  )
}
