import { useContext } from "react"
import { useTranslation } from "react-i18next"
import { UploadSquare01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button"
import { VersionContext } from "@/lib/version-context"

export function VersionUpgradeButton({
  className,
  variant = "destructive",
  showIcon = false,
}: {
  className?: string
  variant?: "destructive" | "outline"
  showIcon?: boolean
}) {
  const { t } = useTranslation()
  const { release, upgradeURL } = useContext(VersionContext)

  if (!upgradeURL) return null

  return (
    <Button
      className={className}
      variant={variant}
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
      {showIcon && (
        <HugeiconsIcon
          icon={UploadSquare01Icon}
          data-icon="inline-start"
          strokeWidth={2}
          aria-hidden="true"
        />
      )}
      {t("version.available")}
    </Button>
  )
}
