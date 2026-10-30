import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useSearchParams } from "react-router-dom"
import {
  FilterHorizontalIcon,
  Loading03Icon,
  Search02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { addDays } from "date-fns"
import { useTranslation } from "react-i18next"
import { useAppToast } from "@/components/animated-toast-provider"
import { AccountDialog } from "@/components/billing/account-dialog"
import { ClientDistributionCards } from "@/components/client-distribution-cards"
import { DatePickerField } from "@/components/date-picker-field"
import { TablePagination } from "@/components/table-pagination"
import { TableLoading } from "@/components/table-loading"
import { UserAvatar } from "@/components/user-avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuOptionsContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import {
  devicePaths,
  devicePageParams,
  devicePageState,
  devicePlatform,
  deviceQuery,
  type ClientDevice,
  type DeviceFilters,
  type DeviceOverview,
  type DevicePage,
} from "@/lib/client-devices"
import { startOfLocalDay } from "@/lib/date-range"
import { TABLE_DATE_TIME_OPTIONS } from "@/lib/date-time"
import { cn } from "@/lib/utils"

type ClientColumn =
  | "user"
  | "device_name"
  | "platform"
  | "os_version"
  | "client_type"
  | "client_name"
  | "client_version"
  | "arch"
  | "locale"
  | "system_locale"
  | "timezone"
  | "runtime_version"
  | "engine_version"
  | "status"
  | "machine_id"
  | "created_at"
  | "last_active_at"
type ClientSearchField =
  | "user_id"
  | "client_type"
  | "platform"
  | "arch"
  | "client_version"
  | "status"
  | "last_active_at"
const key = "pages.clientDevices"
const columns: ClientColumn[] = [
  "user",
  "device_name",
  "platform",
  "os_version",
  "client_type",
  "client_name",
  "client_version",
  "arch",
  "locale",
  "runtime_version",
  "engine_version",
  "created_at",
  "last_active_at",
  "system_locale",
  "timezone",
  "status",
  "machine_id",
]
const defaultColumns: ClientColumn[] = [
  "user",
  "device_name",
  "platform",
  "last_active_at",
]
const searchFields: ClientSearchField[] = [
  "user_id",
  "client_type",
  "platform",
  "arch",
  "client_version",
  "status",
  "last_active_at",
]
const clientTypes = [
  "desktop",
  "web",
  "extension",
  "mobile",
  "runtime",
  "unknown",
]

function activeSearchFields(filters: DeviceFilters) {
  return searchFields.filter((field) =>
    field === "last_active_at" ? filters.from || filters.until : filters[field]
  )
}

export function ClientAnalysisPage() {
  const { i18n, t } = useTranslation()
  const { showToast } = useAppToast()
  const [params, setParams] = useSearchParams()
  const rawQuery = params.toString()
  const { filters, page, pageSize } = useMemo(
    () => devicePageState(rawQuery),
    [rawQuery]
  )
  const query = deviceQuery(filters)
  const [draftQuery, setDraftQuery] = useState(query)
  const [draft, setDraft] = useState<DeviceFilters>(filters)
  const [visibleFields, setVisibleFields] = useState<Set<ClientSearchField>>(
    () => new Set(["client_type", "platform", ...activeSearchFields(filters)])
  )
  const [visibleColumns, setVisibleColumns] = useState<Set<ClientColumn>>(
    () => new Set(defaultColumns)
  )
  const [invalidRange, setInvalidRange] = useState(false)
  const [revision, setRevision] = useState(0)
  const [listRetry, setListRetry] = useState(0)
  const [overviewRetry, setOverviewRetry] = useState(0)
  const [overviewResponse, setOverviewResponse] = useState<{
    key: string
    data?: DeviceOverview
    error?: string
  }>()
  const searchRevisionRef = useRef<number | null>(null)
  const [data, setData] = useState<DevicePage>()
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [error, setError] = useState<string>()
  const [accountUserID, setAccountUserID] = useState<string | null>(null)
  if (draftQuery !== query) {
    setDraftQuery(query)
    setDraft(filters)
    setInvalidRange(false)
    setVisibleFields(
      (current) => new Set([...current, ...activeSearchFields(filters)])
    )
  }
  const startDay =
    draft.from && !Number.isNaN(Date.parse(draft.from))
      ? startOfLocalDay(new Date(draft.from))
      : undefined
  const endDay =
    draft.until && !Number.isNaN(Date.parse(draft.until))
      ? startOfLocalDay(new Date(new Date(draft.until).getTime() - 1))
      : undefined
  const path = `${devicePaths.list}?${query}&page=${page}&page_size=${pageSize}`
  const overviewPath = `${devicePaths.overview}?${query}`
  const overviewKey = `${overviewPath}:${revision}:${overviewRetry}`
  const overviewLoading = overviewResponse?.key !== overviewKey
  const overview = overviewLoading ? undefined : overviewResponse.data
  const overviewError = overviewLoading ? undefined : overviewResponse.error
  const searchBusy = searching || (hasSearched && overviewLoading)
  const items = data?.items ?? []
  const displayedColumns = columns.filter((column) =>
    visibleColumns.has(column)
  )
  const timeFormatter = new Intl.DateTimeFormat(
    i18n.resolvedLanguage ?? i18n.language,
    TABLE_DATE_TIME_OPTIONS
  )

  useEffect(() => {
    const controller = new AbortController()
    void api<DeviceOverview>(overviewPath, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((result) => {
        if (!controller.signal.aborted)
          setOverviewResponse({ key: overviewKey, data: result })
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted)
          setOverviewResponse({ key: overviewKey, error: reason.message })
      })
    return () => controller.abort()
  }, [overviewPath, overviewKey])

  useEffect(() => {
    const controller = new AbortController()
    const isSearch = searchRevisionRef.current === revision
    let redirecting = false
    if (!isSearch) {
      setLoading(true)
      setError(undefined)
    }
    void api<DevicePage>(path, { signal: controller.signal, cache: "no-store" })
      .then((result) => {
        if (controller.signal.aborted) return
        if (result.items.length === 0 && page > 1) {
          redirecting = true
          setParams(
            (current) => {
              const next = new URLSearchParams(current)
              next.delete("page")
              return next
            },
            { replace: true }
          )
          return
        }
        setData(result)
        setError(undefined)
        if (isSearch)
          showToast({
            status: "success",
            title: t("pages.operationLogs.filters.searchSuccess"),
          })
      })
      .catch((reason: Error) => {
        if (controller.signal.aborted) return
        setError(reason.message)
        showToast({
          status: "error",
          title: reason.message,
          ...(!isSearch && {
            action: {
              label: t("statistics.retry"),
              onClick: () => setListRetry((value) => value + 1),
            },
          }),
        })
      })
      .finally(() => {
        if (controller.signal.aborted || redirecting) return
        setLoading(false)
        if (isSearch) {
          setSearching(false)
          searchRevisionRef.current = null
        }
      })
    return () => controller.abort()
  }, [path, page, revision, listRetry, showToast, t, setParams])

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading || searchBusy || overviewLoading) return
    if (
      draft.from &&
      draft.until &&
      new Date(draft.from) >= new Date(draft.until)
    ) {
      setInvalidRange(true)
      return
    }
    setInvalidRange(false)
    setError(undefined)
    const next = devicePageParams(rawQuery, draft, 1, pageSize)
    const filtersChanged =
      deviceQuery(devicePageState(next.toString()).filters) !== query
    setSearching(true)
    setHasSearched(true)
    if (filtersChanged || page !== 1) {
      // The URL change starts the list request; avoid fetching the previous URL first.
      searchRevisionRef.current = revision
      if (!filtersChanged) setOverviewRetry((value) => value + 1)
    } else {
      const nextRevision = revision + 1
      searchRevisionRef.current = nextRevision
      setRevision(nextRevision)
    }
    if (next.toString() !== rawQuery) setParams(next)
  }

  function renderCell(row: ClientDevice, column: ClientColumn) {
    if (column === "user")
      return (
        <button
          type="button"
          className="flex max-w-52 items-center gap-2 rounded-sm text-left underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring enabled:cursor-pointer [&:enabled:hover_span]:underline"
          title={row.user_email ?? undefined}
          disabled={!row.user_id || row.user_deleted}
          onClick={() => {
            if (row.user_id) setAccountUserID(row.user_id)
          }}
        >
          <UserAvatar src={row.user_avatar_url} />
          <span className="truncate">
            {row.user_name || row.user_email || row.user_id}
            {row.user_deleted ? ` · ${t(`${key}.deletedUser`)}` : ""}
          </span>
        </button>
      )
    if (column === "device_name")
      return (
        <span
          className="block max-w-48 truncate"
          title={`${row.alias || row.device_name} · ${row.machine_id}`}
        >
          {row.alias || row.device_name}
        </span>
      )
    if (column === "created_at" || column === "last_active_at") {
      const value = row[column]
      return (
        <span title={value || undefined}>
          {value && !Number.isNaN(Date.parse(value))
            ? timeFormatter.format(new Date(value))
            : "—"}
        </span>
      )
    }
    if (column === "platform") return devicePlatform(row.platform)
    if (column === "client_type")
      return row.client_type
        ? t(`pages.clientDevices.distribution.types.${row.client_type}`, {
            defaultValue: row.client_type,
          })
        : "—"
    if (column === "status") return t(`${key}.statuses.${row.status}`)
    const value = row[column]
    return (
      <span className="block max-w-48 truncate" title={value || undefined}>
        {!value
          ? "—"
          : value === "unknown"
            ? t("pages.clientDevices.distribution.unknown")
            : value}
      </span>
    )
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 p-4 pt-px lg:h-[calc(100vh-5rem)] lg:flex-none lg:overflow-hidden">
      <ClientDistributionCards
        data={overview}
        loading={overviewLoading}
        error={overviewError}
        onRetry={() => setOverviewRetry((value) => value + 1)}
      />
      <Card className="h-[32rem] min-h-0 flex-none lg:h-auto lg:flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          <form
            onSubmit={applySearch}
            className="flex flex-wrap items-center gap-2 px-[var(--card-spacing)]"
          >
            <Input
              id="client-device-query"
              className="w-56"
              maxLength={200}
              placeholder={t(`${key}.search`)}
              aria-label={t(`${key}.search`)}
              value={draft.query ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  query: event.target.value,
                }))
              }
            />
            {visibleFields.has("client_type") && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        !draft.client_type && "text-muted-foreground"
                      )}
                    />
                  }
                >
                  {draft.client_type
                    ? t(
                        `pages.clientDevices.distribution.types.${draft.client_type}`,
                        { defaultValue: draft.client_type }
                      )
                    : t(`${key}.fields.client_type`)}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      {t(`${key}.fields.client_type`)}
                    </DropdownMenuLabel>
                    {clientTypes.map((value) => (
                      <DropdownMenuCheckboxItem
                        key={value}
                        checked={draft.client_type === value}
                        onCheckedChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            client_type: checked ? value : "",
                          }))
                        }
                      >
                        {t(`pages.clientDevices.distribution.types.${value}`)}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {visibleFields.has("platform") && (
              <Input
                className="w-32"
                maxLength={64}
                placeholder={t(`${key}.fields.platform`)}
                aria-label={t(`${key}.fields.platform`)}
                value={draft.platform ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    platform: event.target.value,
                  }))
                }
              />
            )}
            {visibleFields.has("user_id") && (
              <Input
                id="client-device-user-id"
                className="w-72 max-w-full"
                maxLength={36}
                placeholder={t(`${key}.fields.user_id`)}
                aria-label={t(`${key}.fields.user_id`)}
                value={draft.user_id ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    user_id: event.target.value,
                  }))
                }
              />
            )}
            {(["arch", "client_version"] as const).map(
              (field) =>
                visibleFields.has(field) && (
                  <Input
                    key={field}
                    className="w-32"
                    maxLength={field === "arch" ? 32 : 64}
                    placeholder={t(`${key}.fields.${field}`)}
                    aria-label={t(`${key}.fields.${field}`)}
                    value={draft[field] ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                  />
                )
            )}
            {visibleFields.has("status") && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button type="button" variant="outline" />}
                >
                  {draft.status
                    ? t(`${key}.statuses.${draft.status}`)
                    : t(`${key}.fields.status`)}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    {["active", "revoked"].map((value) => (
                      <DropdownMenuCheckboxItem
                        key={value}
                        checked={draft.status === value}
                        onCheckedChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            status: checked ? value : "",
                          }))
                        }
                      >
                        {t(`${key}.statuses.${value}`)}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {visibleFields.has("last_active_at") && (
              <>
                <DatePickerField
                  id="client-analysis-from"
                  className="w-40 sm:w-40"
                  label={t(`${key}.activeFrom`)}
                  placeholder={t(`${key}.activeFrom`)}
                  locale={i18n.resolvedLanguage ?? i18n.language}
                  value={startDay}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      from: value ? startOfLocalDay(value).toISOString() : "",
                    }))
                  }
                  disabled={endDay ? { after: endDay } : undefined}
                />
                <DatePickerField
                  id="client-analysis-until"
                  className="w-40 sm:w-40"
                  label={t(`${key}.activeUntil`)}
                  placeholder={t(`${key}.activeUntil`)}
                  locale={i18n.resolvedLanguage ?? i18n.language}
                  value={endDay}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      until: value
                        ? startOfLocalDay(addDays(value, 1)).toISOString()
                        : "",
                    }))
                  }
                  disabled={startDay ? { before: startDay } : undefined}
                />
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" variant="outline" />}
              >
                <HugeiconsIcon
                  icon={FilterHorizontalIcon}
                  data-icon="inline-start"
                />
                {t("common.more")}
              </DropdownMenuTrigger>
              <DropdownMenuOptionsContent align="start">
                <DropdownMenuGroup>
                  {searchFields.map((field) => (
                    <DropdownMenuCheckboxItem
                      key={field}
                      checked={visibleFields.has(field)}
                      onCheckedChange={(checked) => {
                        setVisibleFields((current) => {
                          const next = new Set(current)
                          if (checked) next.add(field)
                          else next.delete(field)
                          return next
                        })
                        if (!checked)
                          setDraft((current) =>
                            field === "last_active_at"
                              ? { ...current, from: "", until: "" }
                              : { ...current, [field]: "" }
                          )
                      }}
                    >
                      {t(`${key}.fields.${field}`)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuOptionsContent>
            </DropdownMenu>
            <Button
              type="submit"
              disabled={loading || searchBusy || overviewLoading}
            >
              <HugeiconsIcon
                icon={searchBusy ? Loading03Icon : Search02Icon}
                data-icon="inline-start"
                className={
                  searchBusy
                    ? "animate-spin motion-reduce:animate-none"
                    : undefined
                }
              />
              {t("pages.operationLogs.filters.search")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button type="button" variant="outline" className="ms-auto" />
                }
              >
                {t("pages.clientDevices.selectColumns")}
              </DropdownMenuTrigger>
              <DropdownMenuOptionsContent align="end" className="max-h-80">
                <DropdownMenuGroup>
                  {columns.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column}
                      checked={visibleColumns.has(column)}
                      onCheckedChange={(checked) =>
                        setVisibleColumns((current) => {
                          if (!checked && current.size === 1) return current
                          const next = new Set(current)
                          if (checked) next.add(column)
                          else next.delete(column)
                          return next
                        })
                      }
                    >
                      {t(`${key}.fields.${column}`)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuOptionsContent>
            </DropdownMenu>
            {invalidRange && (
              <p role="alert" className="text-sm text-destructive">
                {t(`${key}.invalidRange`)}
              </p>
            )}
          </form>
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 px-[var(--card-spacing)]"
            >
              <span className="text-sm text-destructive">{error}</span>
              <Button
                variant="outline"
                onClick={() => setListRetry((value) => value + 1)}
              >
                {t("statistics.retry")}
              </Button>
            </div>
          )}
          <ScrollArea
            horizontal
            className="min-h-0 min-w-0 flex-1 [&_[data-slot=table-container]]:h-full [&_[data-slot=table-container]]:overflow-visible"
          >
            <Table
              className={cn(
                !items.length && "h-full",
                "[&_td:first-child]:ps-[var(--card-spacing)] [&_td:last-child]:pe-[var(--card-spacing)] [&_th:first-child]:ps-[var(--card-spacing)] [&_th:last-child]:pe-[var(--card-spacing)]"
              )}
              aria-label={t(`${key}.title`)}
              aria-busy={loading || searching}
            >
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  {displayedColumns.map((column) => (
                    <TableHead
                      key={column}
                      className="whitespace-nowrap"
                      title={
                        column === "created_at"
                          ? t(`${key}.registeredHint`)
                          : column === "last_active_at"
                            ? t(`${key}.activityHint`)
                            : undefined
                      }
                    >
                      {t(`${key}.fields.${column}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length ? (
                  items.map((row) => (
                    <TableRow key={row.id}>
                      {displayedColumns.map((column) => (
                        <TableCell
                          key={column}
                          className={cn(
                            "whitespace-nowrap",
                            (column === "created_at" ||
                              column === "last_active_at") &&
                              "text-muted-foreground"
                          )}
                        >
                          {renderCell(row, column)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="h-full">
                    <TableCell
                      colSpan={displayedColumns.length}
                      className="h-full text-center text-muted-foreground"
                    >
                      {loading ? (
                        <TableLoading />
                      ) : error ? (
                        "—"
                      ) : (
                        t("statistics.empty")
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
          <TablePagination
            page={page}
            pageSize={pageSize}
            itemCount={items.length}
            loading={loading || searching}
            error={Boolean(error)}
            hasNext={Boolean(data?.has_next)}
            onPageSizeChange={(size) =>
              setParams(devicePageParams(rawQuery, filters, 1, size))
            }
            onPrevious={() =>
              setParams(
                devicePageParams(
                  rawQuery,
                  filters,
                  Math.max(1, page - 1),
                  pageSize
                )
              )
            }
            onNext={() => {
              if (data?.has_next)
                setParams(
                  devicePageParams(rawQuery, filters, page + 1, pageSize)
                )
            }}
          />
        </CardContent>
      </Card>
      {accountUserID && (
        <AccountDialog
          key={accountUserID}
          userId={accountUserID}
          onClose={() => setAccountUserID(null)}
        />
      )}
    </section>
  )
}
