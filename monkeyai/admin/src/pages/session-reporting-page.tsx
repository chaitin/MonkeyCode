import { useState, type FormEvent, type ReactNode } from "react"
import { Search02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { addDays, startOfDay } from "date-fns"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router-dom"
import { DatePickerField } from "@/components/date-picker-field"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CONSOLE_ROUTES } from "@/lib/routes"
import {
  defaultWindow,
  reportPaths,
  reportQuery,
  useReport,
  type ReportClient,
  type ReportOverview,
  type ReportPage,
  type ReportResourceRow,
  type ReportSession,
  type ReportWindow,
} from "@/lib/session-reporting"

const key = "pages.sessionReporting"
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const outcomes = [
  "complete",
  "interrupted",
  "error",
  "max_turns",
  "output_limit",
  "unknown",
]
const clientTypes = ["desktop", "web", "extension", "mobile", "unknown"]
const platforms = ["macos", "windows", "linux", "ios", "android", "web"]

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

function localDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}

export function ReportFilters({
  value,
  onApply,
  resource = false,
  session = false,
}: {
  value: ReportWindow
  onApply: (filters: ReportWindow) => void
  resource?: boolean
  session?: boolean
}) {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const [draft, setDraft] = useState(value)
  const [startDay, setStartDay] = useState<Date | undefined>(
    () => new Date(value.from)
  )
  const [endDay, setEndDay] = useState<Date | undefined>(
    () => new Date(new Date(value.until).getTime() - 1)
  )
  const [sessionId, setSessionId] = useState("")
  const [invalid, setInvalid] = useState(false)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const selected = session
      ? {
          ...draft,
          from: startDay ? startOfDay(startDay).toISOString() : "",
          until: endDay ? startOfDay(addDays(endDay, 1)).toISOString() : "",
        }
      : draft
    if (
      !selected.from ||
      !selected.until ||
      new Date(selected.from) >= new Date(selected.until)
    ) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onApply(selected)
  }
  function goToSession() {
    if (!uuid.test(sessionId.trim())) {
      setInvalid(true)
      return
    }
    navigate(
      `${CONSOLE_ROUTES.sessionDetail.replace(":sessionId", sessionId.trim())}${reportQuery({ from: value.from, until: value.until })}`
    )
  }
  const Frame = session ? "div" : Card
  const FrameContent = session ? "div" : CardContent
  return (
    <Frame>
      <FrameContent className={session ? "flex flex-col gap-4" : undefined}>
        <form
          onSubmit={submit}
          className={cn(
            "flex flex-wrap items-end gap-3",
            session && "px-(--card-spacing)"
          )}
        >
          {session ? (
            <>
              <DatePickerField
                id="session-list-from"
                label={t(`${key}.fields.from`)}
                placeholder={t(`${key}.fields.from`)}
                locale={i18n.resolvedLanguage ?? i18n.language}
                value={startDay}
                onChange={setStartDay}
                disabled={endDay ? { after: endDay } : undefined}
              />
              <DatePickerField
                id="session-list-until"
                label={t(`${key}.fields.until`)}
                placeholder={t(`${key}.fields.until`)}
                locale={i18n.resolvedLanguage ?? i18n.language}
                value={endDay}
                onChange={setEndDay}
                disabled={startDay ? { before: startDay } : undefined}
              />
            </>
          ) : (
            (["from", "until"] as const).map((field) => (
              <label
                key={field}
                className="grid gap-1 text-xs text-muted-foreground"
              >
                {t(`${key}.fields.${field}`)}
                <Input
                  required
                  type="datetime-local"
                  value={localDate(draft[field])}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      [field]: event.target.value
                        ? new Date(event.target.value).toISOString()
                        : "",
                    })
                  }
                />
              </label>
            ))
          )}
          {(["group_id", "user_id", "model_id", "expert_id"] as const).map(
            (field) => (
              <label
                key={field}
                className={cn(
                  "grid gap-1 text-xs text-muted-foreground",
                  session && "sm:w-56"
                )}
              >
                <span className={session ? "sr-only" : undefined}>
                  {t(`${key}.fields.${field}`)}
                </span>
                <Input
                  className={session ? "w-full" : "w-44"}
                  placeholder={session ? t(`${key}.fields.${field}`) : "UUID"}
                  pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                  value={draft[field] ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, [field]: event.target.value.trim() })
                  }
                />
              </label>
            )
          )}
          {(
            [
              ["client_type", clientTypes],
              ["platform", platforms],
              ["outcome", outcomes],
            ] as const
          ).map(([field, values]) => (
            <label
              key={field}
              className="grid gap-1 text-xs text-muted-foreground"
            >
              <span className={session ? "sr-only" : undefined}>
                {t(`${key}.fields.${field}`)}
              </span>
              <Select
                items={[
                  {
                    value: "__all__",
                    label: session
                      ? t(`${key}.fields.${field}`)
                      : t(`${key}.all`),
                  },
                  ...values.map((option) => ({
                    value: option,
                    label:
                      field === "outcome"
                        ? t(`${key}.outcomes.${option}`)
                        : option,
                  })),
                ]}
                value={draft[field] || "__all__"}
                onValueChange={(selected) =>
                  setDraft({
                    ...draft,
                    [field]: selected === "__all__" ? "" : (selected ?? ""),
                  })
                }
              >
                <SelectTrigger
                  className="min-w-32"
                  aria-label={t(`${key}.fields.${field}`)}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    {session ? t(`${key}.fields.${field}`) : t(`${key}.all`)}
                  </SelectItem>
                  {values.map((option) => (
                    <SelectItem key={option} value={option}>
                      {field === "outcome"
                        ? t(`${key}.outcomes.${option}`)
                        : option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ))}
          {resource &&
            (["resource_id", "resource_version"] as const).map((field) => (
              <label
                key={field}
                className={cn(
                  "grid gap-1 text-xs text-muted-foreground",
                  session && "sm:w-56"
                )}
              >
                <span className={session ? "sr-only" : undefined}>
                  {t(`${key}.fields.${field}`)}
                </span>
                <Input
                  maxLength={256}
                  className={session ? "w-full" : "w-44"}
                  placeholder={session ? t(`${key}.fields.${field}`) : undefined}
                  value={draft[field] ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, [field]: event.target.value })
                  }
                />
              </label>
            ))}
          {session && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.include_placeholders ?? false}
                onCheckedChange={(checked) =>
                  setDraft({
                    ...draft,
                    include_placeholders: checked === true,
                  })
                }
              />
              {t(`${key}.fields.include_placeholders`)}
            </label>
          )}
          <Button
            type="submit"
            size={session ? "default" : "sm"}
            className={session ? "w-full sm:w-auto" : undefined}
          >
            {session && (
              <HugeiconsIcon icon={Search02Icon} data-icon="inline-start" />
            )}
            {session
              ? t("pages.operationLogs.filters.search")
              : t(`${key}.apply`)}
          </Button>
        </form>
        {session && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              goToSession()
            }}
            className="flex flex-wrap items-end gap-2 px-(--card-spacing)"
          >
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t(`${key}.fields.session_id`)}
              <Input
                className="w-64"
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                placeholder="UUID"
              />
            </label>
            <Button type="submit" variant="outline" size="sm">
              {t(`${key}.open`)}
            </Button>
          </form>
        )}
        {invalid && (
          <p
            role="alert"
            className={cn(
              "pt-2 text-sm text-destructive",
              session && "px-(--card-spacing)"
            )}
          >
            {t(`${key}.invalidFilter`)}
          </p>
        )}
      </FrameContent>
    </Frame>
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

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-xl font-semibold tabular-nums">
        {children}
      </CardContent>
    </Card>
  )
}

function Freshness({
  data,
}: {
  data: {
    data_freshness_seconds: number | null
    generated_at: string
    from: string
    until: string
  }
}) {
  const { t } = useTranslation()
  return (
    <p className="text-xs text-muted-foreground">
      {t(`${key}.window`)}: <ReportTime value={data.from} /> –{" "}
      <ReportTime value={data.until} /> ·{" "}
      {t(`${key}.generated`, {
        time: new Date(data.generated_at).toLocaleString(),
      })}{" "}
      · {t(`${key}.freshness`)}:{" "}
      <ReportNumber value={data.data_freshness_seconds} suffix="s" />
      {data.data_freshness_seconds === null && ` (${t(`${key}.pending`)})`}
    </p>
  )
}

export function SessionOverviewPage() {
  const { t } = useTranslation()
  const [filters, setFilters] = useState(defaultWindow)
  const request = useReport<ReportOverview>(
    reportPaths.overview + reportQuery(filters),
    30000
  )
  const data = request.data
  const metrics: { label: string; value: number | null; suffix?: string }[] =
    data
      ? [
          { label: "sessions", value: data.sessions },
          { label: "turns", value: data.turns },
          {
            label: "completion_rate",
            value: data.completion_rate,
            suffix: "%",
          },
          { label: "anomaly_rate", value: data.anomaly_rate, suffix: "%" },
          { label: "interrupted", value: data.interrupted },
          { label: "unknown", value: data.unknown },
          {
            label: "average_duration_seconds",
            value: data.average_duration_seconds,
            suffix: "s",
          },
          {
            label: "p50_duration_seconds",
            value: data.p50_duration_seconds,
            suffix: "s",
          },
          {
            label: "p95_duration_seconds",
            value: data.p95_duration_seconds,
            suffix: "s",
          },
          { label: "recent_active_tasks", value: data.recent_active_tasks },
          { label: "input_tokens", value: data.input_tokens },
          { label: "output_tokens", value: data.output_tokens },
          { label: "placeholders", value: data.placeholders },
          { label: "clock_suspect", value: data.clock_suspect },
          { label: "recovered", value: data.recovered },
          {
            label: "average_reporting_delay_seconds",
            value: data.average_reporting_delay_seconds,
            suffix: "s",
          },
        ]
      : []
  return (
    <ReportShell title={t(`${key}.overview.title`)}>
      <ReportFilters value={filters} onApply={setFilters} />
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={request.reload}>
          {t("statistics.refresh")}
        </Button>
      </div>
      <ReportStatus
        request={request}
        empty={data?.sessions === 0 && data.turns === 0}
      />
      {data && (
        <>
          <Freshness data={data} />
          <p className="text-xs text-muted-foreground">
            {t(`${key}.recentNote`)}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((row) => (
              <Metric key={row.label} label={t(`${key}.fields.${row.label}`)}>
                <ReportNumber value={row.value} suffix={row.suffix} />
              </Metric>
            ))}
            <Metric label={t(`${key}.fields.credits`)}>
              <ReportValue value={data.credits} />
            </Metric>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t(`${key}.trend`)}</CardTitle>
              </CardHeader>
              <CardContent className="max-h-80 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {["at", "turns", "complete", "anomalies"].map(
                        (column) => (
                          <TableHead key={column}>
                            {t(`${key}.fields.${column}`)}
                          </TableHead>
                        )
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.trend.map((row) => (
                      <TableRow key={row.at}>
                        <TableCell>
                          <ReportTime value={row.at} />
                        </TableCell>
                        <TableCell>{row.turns}</TableCell>
                        <TableCell>{row.complete}</TableCell>
                        <TableCell>{row.anomalies}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t(`${key}.distribution`)}</CardTitle>
              </CardHeader>
              <CardContent>
                {data.outcomes.map((row) => (
                  <div
                    className="flex justify-between border-b py-2 text-sm"
                    key={row.outcome}
                  >
                    <span>
                      {t(`${key}.outcomes.${row.outcome}`, {
                        defaultValue: row.outcome,
                      })}
                    </span>
                    <ReportNumber value={row.turns} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </ReportShell>
  )
}

function PaginatedReport<T>({
  path,
  filters,
  columns,
  renderRow,
  inline = false,
}: {
  path: string
  filters: ReportWindow
  columns: string[]
  renderRow: (row: T) => ReactNode
  inline?: boolean
}) {
  const { t } = useTranslation()
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [active, setActive] = useState(0)
  const [oldPath, setOldPath] = useState(path + reportQuery(filters))
  const base = path + reportQuery(filters)
  if (base !== oldPath) {
    setOldPath(base)
    setCursors([undefined])
    setActive(0)
  }
  const request = useReport<ReportPage<T>>(
    path + reportQuery(filters, cursors[active])
  )
  const table = request.data && (
    <Table
      className={
        inline
          ? "[&_th:first-child]:ps-(--card-spacing) [&_td:first-child]:ps-(--card-spacing) [&_th:last-child]:pe-(--card-spacing) [&_td:last-child]:pe-(--card-spacing)"
          : undefined
      }
    >
      <TableHeader
        className={
          inline
            ? "sticky top-0 z-10 bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0"
            : undefined
        }
      >
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column}>{t(`${key}.fields.${column}`)}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{request.data.items.map(renderRow)}</TableBody>
    </Table>
  )
  return (
    <>
      <ReportStatus
        request={request}
        empty={request.data?.items.length === 0 && active === 0}
        showGenerated={!inline}
      />
      {request.data && (
        <>
          {!inline && <Freshness data={request.data} />}
          {inline ? (
            <ScrollArea
              horizontal
              className="min-h-0 min-w-0 flex-1 [&_[data-slot=table-container]]:h-full [&_[data-slot=table-container]]:overflow-visible"
            >
              {table}
            </ScrollArea>
          ) : (
            <Card>
              <CardContent className="overflow-x-auto">{table}</CardContent>
            </Card>
          )}
          <div
            className={cn(
              "flex justify-end gap-2",
              inline && "px-(--card-spacing)"
            )}
          >
            <Button
              variant="outline"
              size="sm"
              disabled={active === 0 || request.loading}
              onClick={() => setActive(active - 1)}
            >
              {t(`${key}.previous`)}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={
                !request.data.next_cursor || request.loading || !!request.error
              }
              onClick={() => {
                const next = request.data?.next_cursor
                if (next) {
                  setCursors((current) => [
                    ...current.slice(0, active + 1),
                    next,
                  ])
                  setActive(active + 1)
                }
              }}
            >
              {t(`${key}.next`)}
            </Button>
            <Button variant="outline" size="sm" onClick={request.reload}>
              {t("statistics.refresh")}
            </Button>
          </div>
        </>
      )}
    </>
  )
}

export function SessionListPage() {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<ReportWindow>(() => {
    const today = startOfDay(new Date())
    return {
      from: startOfDay(addDays(today, -1)).toISOString(),
      until: startOfDay(addDays(today, 1)).toISOString(),
    }
  })
  return (
    <ReportShell title={t(`${key}.sessions.title`)} fillHeight>
      <Card className="min-h-0 flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          <ReportFilters
            value={filters}
            onApply={setFilters}
            resource
            session
          />
          <PaginatedReport<ReportSession>
            inline
            path={reportPaths.sessions}
            filters={filters}
            columns={[
              "started_at",
              "last_active_at",
              "session_id",
              "user_id",
              "group_id",
              "client_type",
              "platform",
              "client_version",
              "model_id",
              "turns",
              "active_seconds",
              "last_outcome",
              "credits",
              "subsessions",
              "placeholder",
              "clock_suspect",
            ]}
            renderRow={(row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <ReportTime value={row.started_at} />
                </TableCell>
                <TableCell>
                  <ReportTime value={row.last_active_at} />
                </TableCell>
                <TableCell>
                  <Link
                    className="block max-w-40 truncate text-primary underline"
                    title={row.id}
                    to={`${CONSOLE_ROUTES.sessionDetail.replace(":sessionId", row.id)}${reportQuery({ from: filters.from, until: filters.until })}`}
                  >
                    {row.id}
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void navigator.clipboard.writeText(row.id)}
                  >
                    {t(`${key}.copy`)}
                  </Button>
                </TableCell>
                {[
                  row.owner_user_id,
                  row.group_id,
                  row.client_type,
                  row.platform,
                  row.client_version,
                  row.model_id,
                  row.turns,
                  row.active_seconds,
                  row.last_outcome,
                  row.credits,
                  row.subsessions,
                  row.placeholder,
                  row.clock_suspect,
                ].map((v, i) => (
                  <TableCell key={i}>
                    <ReportValue value={v} />
                  </TableCell>
                ))}
              </TableRow>
            )}
          />
        </CardContent>
      </Card>
    </ReportShell>
  )
}

export function ResourceAnalysisPage() {
  const { t } = useTranslation()
  const [filters, setFilters] = useState(defaultWindow)
  return (
    <ReportShell title={t(`${key}.resources.title`)}>
      <ReportFilters value={filters} onApply={setFilters} resource />
      <p className="text-xs text-muted-foreground">
        {t(`${key}.resources.note`)}
      </p>
      <PaginatedReport<ReportResourceRow>
        path={reportPaths.resources}
        filters={filters}
        columns={[
          "kind",
          "resource_id",
          "version",
          "enabled_sessions",
          "available_sessions",
          "used_sessions",
          "calls",
          "failed",
          "failure_rate",
        ]}
        renderRow={(row) => (
          <TableRow key={row.sort_key}>
            {[
              row.kind,
              row.resource_id,
              row.version,
              row.enabled_sessions,
              row.available_sessions,
              row.used_sessions,
              row.calls,
              row.failed,
            ].map((v, i) => (
              <TableCell key={i}>
                <ReportValue value={v} />
              </TableCell>
            ))}
            <TableCell>
              <ReportNumber value={row.failure_rate} suffix="%" />
            </TableCell>
          </TableRow>
        )}
      />
    </ReportShell>
  )
}

export function ClientAnalysisPage() {
  const { t } = useTranslation()
  const [filters, setFilters] = useState(defaultWindow)
  return (
    <ReportShell title={t(`${key}.clients.title`)}>
      <ReportFilters value={filters} onApply={setFilters} />
      <p className="text-xs text-muted-foreground">
        {t(`${key}.clients.note`)}
      </p>
      <PaginatedReport<ReportClient>
        path={reportPaths.clients}
        filters={filters}
        columns={[
          "client_type",
          "platform",
          "os_version",
          "client_version",
          "engine_version",
          "runtime_version",
          "locale",
          "timezone",
          "sessions",
          "turns",
          "interrupted",
          "completion_rate",
          "anomaly_rate",
          "p95_duration_seconds",
          "last_active_at",
        ]}
        renderRow={(row) => (
          <TableRow key={row.sort_key}>
            {[
              row.client_type,
              row.platform,
              row.os_version,
              row.client_version,
              row.engine_version,
              row.runtime_version,
              row.locale,
              row.timezone,
              row.sessions,
              row.turns,
              row.interrupted,
            ].map((v, i) => (
              <TableCell key={i}>
                <ReportValue value={v} />
              </TableCell>
            ))}
            {[
              row.completion_rate,
              row.anomaly_rate,
              row.p95_duration_seconds,
            ].map((v, i) => (
              <TableCell key={i}>
                <ReportNumber value={v} suffix={i < 2 ? "%" : "s"} />
              </TableCell>
            ))}
            <TableCell>
              <ReportTime value={row.last_active_at} />
            </TableCell>
          </TableRow>
        )}
      />
    </ReportShell>
  )
}
