import {
  ChartBarLineIcon,
  Coins01Icon,
  Share01Icon,
  ShieldCheckIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

const features = [
  { key: "sharing", icon: Share01Icon },
  { key: "billing", icon: Coins01Icon },
  { key: "governance", icon: ShieldCheckIcon },
  { key: "statistics", icon: ChartBarLineIcon },
] as const

export function EnterpriseFeatures() {
  const { t } = useTranslation()

  return (
    <section
      className="px-6 pb-16 sm:pb-20"
      aria-labelledby="enterprise-features-title"
    >
      <div className="mx-auto max-w-6xl rounded-3xl border bg-card p-6 sm:p-10">
        <div className="max-w-2xl">
          <h2
            id="enterprise-features-title"
            className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            {t("landing.enterprise.title")}
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
            {t("landing.management")}
          </p>
        </div>
        <div className="mt-8 grid gap-3 md:grid-cols-2">
          {features.map((feature) => (
            <article
              key={feature.key}
              className="flex gap-4 rounded-2xl border bg-background p-5"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                <HugeiconsIcon
                  icon={feature.icon}
                  className="size-5"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">
                  {t(`landing.enterprise.${feature.key}Title`)}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t(`landing.enterprise.${feature.key}Description`)}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
