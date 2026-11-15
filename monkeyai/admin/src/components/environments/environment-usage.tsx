import { CpuIcon, RamMemoryIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { ResourceMeter } from "./resource-meter"
import { GiB, MiB, type Environment } from "@/lib/environments"

export function EnvironmentUsage({
  environment: env,
  compact = false,
}: {
  environment: Environment
  compact?: boolean
}) {
  const { t } = useTranslation()
  const active =
    env.desired === "running" &&
    env.phase === "running" &&
    env.generation === env.observed_generation
  const usage = active ? env.usage : undefined
  const stale = !!usage && !!(env.stale || env.usage_stale)
  const cores = env.spec.resource.cpu_millis / 1000
  const memory = env.spec.resource.memory_bytes
  return (
    <div
      className={compact ? "min-w-48 space-y-1.5" : "grid gap-4 sm:grid-cols-2"}
    >
      {[
        {
          icon: CpuIcon,
          label: "CPU",
          value: usage?.cpu_cores,
          limit: cores,
          display: usage?.cpu_cores?.toFixed(2),
          total: `${cores} CPU`,
        },
        {
          icon: RamMemoryIcon,
          label: t("pages.engineHosts.memory"),
          value: usage?.memory_bytes,
          limit: memory,
          display:
            usage?.memory_bytes === undefined
              ? undefined
              : `${(usage.memory_bytes / MiB).toFixed(1)} MiB`,
          total: `${(memory / GiB).toFixed(1)} GiB`,
        },
      ].map((item) => (
        <div
          key={item.label}
          className={
            compact
              ? "flex items-center gap-2 text-xs"
              : "min-w-0 rounded-lg bg-muted/40 p-3"
          }
        >
          <p className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <HugeiconsIcon
              icon={item.icon}
              className="size-4"
              aria-hidden="true"
            />
            {!compact && item.label}
          </p>
          {compact ? (
            <span className="tabular-nums">
              <span className="font-medium">{item.display ?? "—"}</span>
              <span className="text-muted-foreground"> / {item.total}</span>
            </span>
          ) : (
            <ResourceMeter
              label={item.label}
              value={
                item.value === undefined
                  ? undefined
                  : Math.min(100, (item.value / item.limit) * 100)
              }
              detail={`${item.display ?? "—"} / ${item.total}`}
              stale={stale}
            />
          )}
        </div>
      ))}
      {compact && stale && (
        <p className="text-xs text-muted-foreground">
          {t("pages.engineHosts.lastReport")}
        </p>
      )}
    </div>
  )
}
