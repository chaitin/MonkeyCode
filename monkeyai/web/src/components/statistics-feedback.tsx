import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"

export function StatisticsFeedback({
  loading,
  error,
  empty,
  reload,
}: {
  loading: boolean
  error?: string
  empty?: boolean
  reload: () => void
}) {
  const { t } = useTranslation()
  if (error)
    return (
      <div className="flex justify-end rounded-lg border p-4">
        <Button variant="outline" onClick={reload}>
          {t("statistics.retry")}
        </Button>
      </div>
    )
  if (loading)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        {t("statistics.loading")}
      </p>
    )
  if (empty)
    return (
      <p
        role="status"
        className="rounded-lg border p-4 text-sm text-muted-foreground"
      >
        {t("statistics.empty")}
      </p>
    )
  return null
}
