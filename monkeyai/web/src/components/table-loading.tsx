import { HugeiconsIcon } from "@hugeicons/react"
import { Loading03Icon } from "@hugeicons/core-free-icons"
import { useTranslation } from "react-i18next"

export function TableLoading() {
  const { t } = useTranslation()

  return (
    <span
      role="status"
      className="inline-flex items-center gap-2 text-sm text-muted-foreground"
    >
      <HugeiconsIcon
        icon={Loading03Icon}
        aria-hidden="true"
        className="size-4 animate-spin motion-reduce:animate-none"
      />
      {t("resources.tableLoading")}
    </span>
  )
}
