import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { useReport } from "@/lib/session-reporting"
import { cn } from "@/lib/utils"

const key = "pages.sessionReporting"
const kindLabels: Record<string, string> = {
  model: "audit.targets.model",
  rule: "audit.targets.rule",
  skill: "audit.targets.skill",
  expert: "audit.targets.expert",
  connector: "audit.targets.connector",
  builtin: `${key}.resources.kinds.builtin`,
  workflow: `${key}.resources.kinds.workflow`,
  agent: `${key}.resources.kinds.agent`,
  local_mcp: `${key}.resources.kinds.local_mcp`,
  knowledge: "pages.knowledgeBases.title",
  knowledge_base: "pages.knowledgeBases.title",
  unknown: `${key}.outcomes.unknown`,
}

export function ReportValue({
  value,
}: {
  value: string | number | boolean | null | undefined
}) {
  return (
    <span className="break-all">
      {value === null || value === undefined || value === ""
        ? "—"
        : typeof value === "boolean"
          ? value
            ? "✓"
            : "—"
          : value}
    </span>
  )
}

export function ReportKind({ value }: { value: string | null | undefined }) {
  const { t } = useTranslation()
  const labelKey =
    value && Object.hasOwn(kindLabels, value) ? kindLabels[value] : undefined
  return (
    <ReportValue
      value={labelKey ? t(labelKey, { defaultValue: value ?? "" }) : value}
    />
  )
}

export function ReportTime({ value }: { value: string | null | undefined }) {
  const { i18n } = useTranslation()
  return (
    <span className="whitespace-nowrap">
      {value && !Number.isNaN(Date.parse(value))
        ? new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(value))
        : "—"}
    </span>
  )
}

export function ReportNumber({
  value,
  suffix = "",
}: {
  value: number | null | undefined
  suffix?: string
}) {
  const { i18n } = useTranslation()
  return (
    <>
      {value === null || value === undefined
        ? "—"
        : `${new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, { maximumFractionDigits: 2 }).format(value)}${suffix}`}
    </>
  )
}

export function ReportStatus({
  request,
  empty,
  showGenerated = true,
}: {
  request: ReturnType<typeof useReport<unknown>>
  empty?: boolean
  showGenerated?: boolean
}) {
  const { t } = useTranslation()
  return (
    <>
      {request.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
        >
          <span>
            {t(
              `${key}.errors.${request.error === 401 || request.error === 403 ? "forbidden" : request.error === 410 ? "purged" : request.error === 404 ? "notFound" : request.error === "timeout" ? "timeout" : "general"}`
            )}
            {request.updated &&
              ` · ${t(`${key}.lastSuccess`, { time: request.updated.toLocaleString() })}`}
            {request.stale && ` · ${t(`${key}.stale`)}`}
          </span>
          <Button variant="outline" size="sm" onClick={request.reload}>
            {t("statistics.retry")}
          </Button>
        </div>
      )}
      {request.loading && !request.data && !request.error && (
        <p
          role="status"
          className="rounded-lg border p-4 text-sm text-muted-foreground"
        >
          {t("statistics.loading")}
        </p>
      )}
      {!request.loading && !request.error && empty && (
        <p
          role="status"
          className="rounded-lg border p-4 text-sm text-muted-foreground"
        >
          {t("statistics.empty")}
        </p>
      )}
      {showGenerated && request.data && (
        <p className="text-xs text-muted-foreground">
          {t(`${key}.generated`, {
            time: request.updated?.toLocaleString() ?? "—",
          })}
        </p>
      )}
    </>
  )
}

export function ReportShell({
  title,
  children,
  fillHeight = false,
}: {
  title: string
  children: ReactNode
  fillHeight?: boolean
}) {
  const { t } = useTranslation()
  return (
    <section
      className={cn(
        "flex flex-1 flex-col gap-4 p-4 pt-0",
        fillHeight &&
          "min-h-0 pt-px md:h-[calc(100svh-5rem)] md:flex-none md:overflow-hidden"
      )}
    >
      <h1 className="text-xl font-semibold">{title}</h1>
      {!fillHeight && (
        <p className="text-xs text-muted-foreground">{t(`${key}.privacy`)}</p>
      )}
      {children}
    </section>
  )
}
