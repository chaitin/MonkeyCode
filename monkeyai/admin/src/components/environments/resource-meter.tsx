import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

export function ResourceMeter({
  label,
  value,
  detail,
  stale = false,
}: {
  label: string
  value?: number
  detail: string
  stale?: boolean
}) {
  const { t } = useTranslation()
  const percent =
    value !== undefined && Number.isFinite(value) && value >= 0 && value <= 100
      ? value
      : undefined
  return (
    <div className="min-w-32 space-y-1.5 py-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium tabular-nums">
          {percent === undefined ? "—" : `${percent.toFixed(1)}%`}
        </span>
        {stale && (
          <span className="text-muted-foreground">
            {t("pages.engineHosts.lastReport")}
          </span>
        )}
      </div>
      <div
        role={percent === undefined ? undefined : "meter"}
        aria-label={label}
        aria-valuemin={percent === undefined ? undefined : 0}
        aria-valuemax={percent === undefined ? undefined : 100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        {percent !== undefined && (
          <div
            className={cn(
              "h-full rounded-full",
              stale
                ? "bg-muted-foreground/40"
                : percent >= 90
                  ? "bg-destructive"
                  : "bg-primary/70"
            )}
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">{detail}</p>
    </div>
  )
}
