import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"

export function TableLoadError({
  error,
  onRetry,
}: {
  error: string
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="space-y-2 text-center text-muted-foreground">
      <p>{t("resources.tableLoadError", { error })}</p>
      <Button type="button" variant="outline" className="text-foreground" onClick={onRetry}>
        {t("statistics.retry")}
      </Button>
    </div>
  )
}
