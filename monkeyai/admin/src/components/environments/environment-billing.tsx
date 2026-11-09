import { useTranslation } from "react-i18next"
import { type Environment, environmentState } from "@/lib/environments"
import { credits } from "@/lib/billing"
import { Badge } from "@/components/ui/badge"
import { Identity } from "./common"

export function EnvironmentBillingInfo({
  environment,
  compact = false,
}: {
  environment: Environment
  compact?: boolean
}) {
  const { t, i18n } = useTranslation()
  const bill = environment.billing
  if (!bill) return null
  const budget = bill.budget
  const stop = bill.stop_reason || environment.billing_stop_reason
  const duration = (seconds: number) => {
    if (seconds > 365 * 86400) return t("environmentAdmin.billing.overYear")
    if (seconds >= 3600)
      return t("environmentAdmin.billing.hoursMinutes", {
        hours: Math.floor(seconds / 3600),
        minutes: Math.floor(seconds / 60) % 60,
      })
    return t("environmentAdmin.billing.minutesSeconds", {
      minutes: Math.floor(seconds / 60),
      seconds: seconds % 60,
    })
  }
  const reason =
    stop === "insufficient_credits"
      ? t(
          `environmentAdmin.billing.${environmentState(environment) === "stopped" ? "stoppedForBalance" : "stoppingForBalance"}`
        )
      : stop === "billing_unavailable"
        ? t("environmentAdmin.billing.unavailableStop")
        : null
  const status = (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">
        {t(`environmentAdmin.billing.state.${bill.state}`)}
      </Badge>
      {budget?.low_balance && (
        <Badge
          variant="outline"
          className="border-destructive/30 text-destructive"
        >
          {t("environmentAdmin.billing.lowBalance")}
        </Badge>
      )}
    </div>
  )
  if (compact)
    return (
      <div className="max-w-64 space-y-2">
        {status}
        {bill.enabled && (
          <p className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {t("environmentAdmin.billing.hourly", {
              credits: credits(bill.hourly_credits, i18n.language),
            })}
          </p>
        )}
        {reason && (
          <p className="whitespace-normal text-xs text-destructive">{reason}</p>
        )}
      </div>
    )
  return (
    <section
      className="space-y-4 rounded-xl border p-4"
      aria-label={t("environmentAdmin.billing.title")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          {t("environmentAdmin.billing.title")}
        </h3>
        {status}
      </div>
      {reason && (
        <p className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
          {reason}
        </p>
      )}
      <dl className="grid gap-4 sm:grid-cols-2">
        <Identity
          label={t("environmentAdmin.billing.previewTitle")}
          value={t("environmentAdmin.billing.hourly", {
            credits: credits(bill.hourly_credits, i18n.language),
          })}
        />
        <Identity
          label={t("environmentAdmin.billing.settled")}
          value={credits(bill.settled_credits, i18n.language)}
        />
        <Identity
          label={t("environmentAdmin.billing.duration")}
          value={duration(bill.settled_seconds)}
        />
        {budget && (
          <>
            <Identity
              label={t("environmentAdmin.billing.userBalance")}
              value={credits(budget.balance, i18n.language)}
            />
            <Identity
              label={t("environmentAdmin.billing.userRate")}
              value={t("environmentAdmin.billing.hourly", {
                credits: credits(budget.hourly_credits, i18n.language),
              })}
            />
            <Identity
              label={t("environmentAdmin.billing.remaining")}
              value={
                budget.remaining_seconds === null
                  ? t("environmentAdmin.billing.noRunning")
                  : duration(budget.remaining_seconds)
              }
            />
          </>
        )}
      </dl>
      {budget && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("environmentAdmin.billing.budgetHint")}
        </p>
      )}
    </section>
  )
}
