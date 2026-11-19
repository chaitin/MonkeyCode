import { Card, CardContent } from "@/components/ui/card"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { TablePagination } from "@/components/table-pagination"
import {
  ArrowRight01Icon,
  Search02Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  ViewIcon,
  PauseIcon,
  Delete02Icon,
  DotIcon,
} from "@hugeicons/core-free-icons"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuOptionsContent,
} from "@/components/ui/dropdown-menu"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { EnvironmentStatus } from "@/components/environments/status-badge"
import { OSIcon } from "@/components/environments/os-icon"
import { UserAvatar } from "@/components/user-avatar"
import { AccountDialog } from "@/components/billing/account-dialog"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog"
import { useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { api, ApiError } from "@/lib/api"
import { loadEngineHosts } from "@/lib/engine-hosts"
import { TABLE_DATE_TIME_OPTIONS } from "@/lib/date-time"
import {
  MiB,
  canStop,
  canDelete,
  type Environment,
  type Operation,
  type Page,
} from "@/lib/environments"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import {
  LoadState,
  EnvironmentTable,
  FormError,
} from "@/components/environments/common"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

type Action = {
  environment: Environment
  desired: "stopped" | "deleted"
  key: string
}
const statuses = [
  "active",
  "all",
  "running",
  "stopped",
  "failed",
  "pending_running",
  "pending_stopped",
  "pending_deleted",
  "deleted",
]
const columns = [
  "createdAt",
  "creator",
  "status",
  "name",
  "runtimeVersion",
  "host",
  "actions",
] as const
type EnvironmentColumn = (typeof columns)[number]
const pageSizeOptions = ["20", "50", "100"] as const
export function EnvironmentsPage() {
  const { t, i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [visibleColumns, setVisibleColumns] = useState<Set<EnvironmentColumn>>(
    () => new Set(columns.filter((column) => column !== "runtimeVersion"))
  )
  const displayedColumns = columns.filter((column) =>
    visibleColumns.has(column)
  )
  const page = Math.max(
    1,
    Math.min(100000, Number.parseInt(params.get("page") || "1", 10) || 1)
  )
  const pageSize = Number(
    pageSizeOptions.find((size) => size === params.get("page_size")) ?? "20"
  )
  const selected = params.get("environment")
  const hostID = params.get("host_id") || ""
  const hosts = useEnvironmentData<{
    items: { id: string; name: string }[]
    total: number
  }>(
    "/api/admin/v1/engine-hosts",
    false,
    loadEngineHosts<{ id: string; name: string }>
  )
  const hostOptions = [
    { value: "all", label: t("environmentAdmin.allHosts") },
    ...(hosts.data?.items ?? []).map((host) => ({
      value: host.id,
      label: host.name,
    })),
  ]
  if (hostID && !hostOptions.some((option) => option.value === hostID)) {
    hostOptions.push({
      value: hostID,
      label: params.get("host_name") || hostID,
    })
  }
  const status = statuses.includes(params.get("status") || "")
    ? params.get("status")!
    : "active"
  const filterKey = JSON.stringify([status, hostID, params.get("host_name")])
  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey)
  const [draft, setDraft] = useState({ status, hostID })
  if (previousFilterKey !== filterKey) {
    setPreviousFilterKey(filterKey)
    setDraft({ status, hostID })
  }
  const statusOptions = statuses.map((value) => ({
    value,
    label: t(
      `environmentAdmin.${value === "active" || value === "all" ? `filters.${value}` : `states.${value}`}`
    ),
  }))
  const result = useEnvironmentData<Page<Environment>>(
    `/api/admin/v1/environments?page=${page}&page_size=${pageSize}&status=${status}&sort=newest${hostID ? `&host_id=${encodeURIComponent(hostID)}` : ""}`,
    true
  )
  const [accountUserID, setAccountUserID] = useState<string | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState("")
  function request(environment: Environment, desired: Action["desired"]) {
    setError("")
    setConflict(false)
    setNotice("")
    setAction({ environment, desired, key: crypto.randomUUID() })
  }
  async function submit() {
    if (!action || busy || conflict) return
    setBusy(true)
    setError("")
    try {
      await api(
        `/api/admin/v1/environments/${action.environment.id}${action.desired === "stopped" ? "/stop" : ""}`,
        {
          method: action.desired === "stopped" ? "POST" : "DELETE",
          body: JSON.stringify({
            generation: action.environment.generation,
            request_key: action.key,
          }),
        }
      )
      setAction(null)
      setNotice(t("environmentAdmin.accepted"))
      result.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
        setConflict(true)
        result.refresh()
      }
    } finally {
      setBusy(false)
    }
  }
  function select(id: string | null) {
    setParams((old) => {
      const next = new URLSearchParams(old)
      if (id) next.set("environment", id)
      else next.delete("environment")
      return next
    })
  }
  return (
    <>
      <Card
        className="min-w-0 flex-1"
        aria-label={t("environmentAdmin.environmentsTitle")}
      >
        <CardContent className="min-w-0 flex-1 gap-4 px-0">
          <form
            className="flex shrink-0 flex-wrap items-end gap-2 px-[var(--card-spacing)]"
            onSubmit={(event) => {
              event.preventDefault()
              if (result.loading) return
              const next = new URLSearchParams(params)
              next.set("status", draft.status)
              if (draft.hostID) {
                next.set("host_id", draft.hostID)
                next.set(
                  "host_name",
                  hostOptions.find((option) => option.value === draft.hostID)
                    ?.label ?? draft.hostID
                )
              } else {
                next.delete("host_id")
                next.delete("host_name")
              }
              next.delete("sort")
              next.delete("page")
              next.delete("environment")
              if (next.toString() !== params.toString()) setParams(next)
              if (
                draft.status === status &&
                draft.hostID === hostID &&
                page === 1
              )
                result.refresh()
            }}
          >
            <Select
              items={statusOptions}
              value={draft.status}
              onValueChange={(value) => {
                if (value) setDraft((old) => ({ ...old, status: value }))
              }}
            >
              <SelectTrigger
                aria-label={t("environmentAdmin.statusFilter")}
                className="min-w-32"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={hostOptions}
              value={draft.hostID || "all"}
              onValueChange={(value) => {
                if (value)
                  setDraft((old) => ({
                    ...old,
                    hostID: value === "all" ? "" : value,
                  }))
              }}
            >
              <SelectTrigger
                aria-label={t("environmentAdmin.host")}
                className="min-w-32 max-w-64"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hostOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={result.loading}>
              <HugeiconsIcon
                icon={result.loading ? Loading03Icon : Search02Icon}
                className={
                  result.loading
                    ? "animate-spin motion-reduce:animate-none"
                    : undefined
                }
                data-icon="inline-start"
              />
              {t("pages.operationLogs.filters.search")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button type="button" variant="outline" className="ms-auto" />
                }
              >
                {t("pages.sessionReporting.clients.selectColumns")}
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
                      {t("environmentAdmin." + column)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuOptionsContent>
            </DropdownMenu>
          </form>

          {notice && (
            <p role="status" className="px-[var(--card-spacing)] text-sm">
              {notice}
            </p>
          )}
          <EnvironmentTable
            title={t("environmentAdmin.environmentsTitle")}
            columns={displayedColumns.map((column) =>
              t("environmentAdmin." + column)
            )}
            {...result}
            empty={!result.data?.items.length}
          >
            {result.data?.items.map((env) => (
              <TableRow
                key={env.id}
                className="[&>td:first-child]:ps-[var(--card-spacing)] [&>td:last-child]:pe-[var(--card-spacing)]"
              >
                {visibleColumns.has("createdAt") && (
                  <TableCell className="text-muted-foreground">
                    {new Date(env.created_at).toLocaleString(
                      i18n.resolvedLanguage ?? i18n.language,
                      TABLE_DATE_TIME_OPTIONS
                    )}
                  </TableCell>
                )}
                {visibleColumns.has("creator") && (
                  <TableCell>
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-center gap-2 rounded-sm text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring enabled:cursor-pointer account-user-link"
                      title={env.user?.email}
                      disabled={!env.user_id}
                      onClick={() => setAccountUserID(env.user_id)}
                    >
                      <UserAvatar src={env.user?.avatar_url} />
                      <span className="min-w-0 truncate">
                        {env.user?.name || env.user?.email || env.user_id}
                      </span>
                    </button>
                  </TableCell>
                )}
                {visibleColumns.has("status") && (
                  <TableCell>
                    {env.reason &&
                    env.generation === env.observed_generation ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={<span tabIndex={0} className="inline-flex" />}
                        >
                          <EnvironmentStatus environment={env} />
                        </TooltipTrigger>
                        <TooltipContent className="whitespace-normal break-words">
                          {t(`environmentAdmin.reasons.${env.reason}`, {
                            defaultValue: env.reason,
                          })}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <EnvironmentStatus environment={env} />
                    )}
                  </TableCell>
                )}
                {visibleColumns.has("name") && (
                  <TableCell>
                    <Button
                      variant="link"
                      className="h-auto max-w-60 justify-start whitespace-normal break-all p-0 text-start font-medium"
                      onClick={() => select(env.id)}
                    >
                      {env.name}
                    </Button>
                  </TableCell>
                )}
                {visibleColumns.has("runtimeVersion") && (
                  <TableCell>
                    {env.runtime_version ||
                      t("environmentAdmin.runtimeUnknown")}
                  </TableCell>
                )}
                {visibleColumns.has("host") && (
                  <TableCell>
                    <span
                      className="block max-w-48 truncate"
                      title={
                        env.host?.hostname || env.host?.name || env.host_id
                      }
                    >
                      {env.host?.hostname || env.host?.name || env.host_id}
                    </span>
                  </TableCell>
                )}
                {visibleColumns.has("actions") && (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("common.more")}
                          />
                        }
                      >
                        <HugeiconsIcon
                          icon={MoreHorizontalIcon}
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => select(env.id)}>
                            <HugeiconsIcon
                              icon={ViewIcon}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                            {t("environmentAdmin.details")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!canStop(env) || busy}
                            onClick={() => request(env, "stopped")}
                          >
                            <HugeiconsIcon
                              icon={PauseIcon}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                            {t("environmentAdmin.stop")}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={!canDelete(env) || busy}
                            onClick={() => request(env, "deleted")}
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                            {t("environmentAdmin.targets.deleted")}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </EnvironmentTable>
          <TablePagination
            page={page}
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            itemCount={result.data?.items.length ?? 0}
            hasNext={(result.data?.items.length ?? 0) >= pageSize}
            loading={result.loading || busy}
            error={!!result.error}
            onPageSizeChange={(size) =>
              setParams((old) => {
                const next = new URLSearchParams(old)
                next.set("page_size", String(size))
                next.delete("page")
                return next
              })
            }
            onPrevious={() =>
              setParams((old) => {
                const next = new URLSearchParams(old)
                next.set("page", String(Math.max(1, page - 1)))
                return next
              })
            }
            onNext={() =>
              setParams((old) => {
                const next = new URLSearchParams(old)
                next.set("page", String(page + 1))
                return next
              })
            }
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
      {selected && (
        <EnvironmentDetail
          key={selected}
          id={selected}
          close={() => select(null)}
        />
      )}
      <AlertDialog
        open={!!action}
        onOpenChange={(value) => {
          if (!value && !busy) setAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                `environmentAdmin.${action?.desired === "stopped" ? "stop" : "delete"}`
              )}
              ：{action?.environment.name}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t(
              `environmentAdmin.${action?.desired === "stopped" ? "stopHint" : "deleteHint"}`
            )}
          </AlertDialogDescription>
          <FormError error={error} />
          {conflict && (
            <p className="text-sm text-muted-foreground">
              {t("environmentAdmin.conflictHint")}
            </p>
          )}
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setAction(null)}
            >
              {t(`environmentAdmin.${conflict ? "close" : "cancel"}`)}
            </Button>
            <Button
              variant={
                action?.desired === "deleted" ? "destructive" : "default"
              }
              disabled={busy || conflict}
              onClick={() => void submit()}
            >
              {t(`environmentAdmin.${busy ? "submitting" : "confirm"}`)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
function DetailSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-lg border">
      <CollapsibleTrigger
        type="button"
        className="group flex w-full items-center gap-3 rounded-t-lg px-4 py-3 text-start hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <span className="font-medium">{title}</span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          aria-hidden="true"
          className="ms-auto size-4 transition-transform group-aria-expanded:rotate-90 [[dir=rtl]_&]:rotate-180 [[dir=rtl]_&]:group-aria-expanded:-rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted className="border-t">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

function DetailRows({
  items,
}: {
  items: readonly (readonly [string, ReactNode])[]
}) {
  return (
    <dl className="divide-y">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-x-4 px-4 py-3 text-sm"
        >
          <dt className="min-w-0 break-words text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-all text-right [&>button]:ms-auto">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function EnvironmentDetail({ id, close }: { id: string; close: () => void }) {
  const { t, i18n } = useTranslation()
  const [accountUserID, setAccountUserID] = useState<string | null>(null)
  const path = "/api/admin/v1/environments/" + encodeURIComponent(id)
  const result = useEnvironmentData<Environment>(path, true)
  const operations = useEnvironmentData<Page<Operation>>(
    path + "/operations?page=1&page_size=20",
    true
  )
  const env = result.data
  const date = (value: string) =>
    new Date(value).toLocaleString(
      i18n.resolvedLanguage ?? i18n.language,
      TABLE_DATE_TIME_OPTIONS
    )
  const activeUsage =
    env?.desired === "running" &&
    env.phase === "running" &&
    env.generation === env.observed_generation
      ? env.usage
      : undefined
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) close()
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl"
        closeLabel={t("environmentAdmin.close")}
      >
        <DialogHeader>
          <DialogTitle>{t("environmentAdmin.environmentDetails")}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="-me-6 flex min-h-0 flex-1 flex-col [&_[data-slot=scroll-area-viewport]]:min-h-0">
          <div className="space-y-6 pe-6">
            <LoadState {...result} empty={false} />
            {env && (
              <>
                <section className="space-y-4 rounded-xl bg-muted/40 p-4">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-base font-semibold">
                        {env.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t(
                          "environmentAdmin." +
                            (env.stale
                              ? "connectionStale"
                              : env.connectable
                                ? "connectionReady"
                                : "connectionUnavailable")
                        )}
                      </p>
                    </div>
                    {env.reason &&
                    env.generation === env.observed_generation ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={<span tabIndex={0} className="inline-flex" />}
                        >
                          <EnvironmentStatus environment={env} />
                        </TooltipTrigger>
                        <TooltipContent className="whitespace-normal break-words">
                          {t("environmentAdmin.reasons." + env.reason, {
                            defaultValue: env.reason,
                          })}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <EnvironmentStatus environment={env} />
                    )}
                  </div>
                </section>
                <DetailSection title={t("environmentAdmin.basicInfo")}>
                  <DetailRows
                    items={[
                      [t("environmentAdmin.createdAt"), date(env.created_at)],
                      [
                        t("environmentAdmin.creator"),
                        <button
                          type="button"
                          className="flex min-w-0 max-w-full items-center gap-2 rounded-sm text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring enabled:cursor-pointer account-user-link"
                          title={env.user?.email}
                          disabled={!env.user_id}
                          onClick={() => setAccountUserID(env.user_id)}
                        >
                          <UserAvatar src={env.user?.avatar_url} />
                          <span className="min-w-0 truncate">
                            {env.user?.name || env.user?.email || env.user_id}
                          </span>
                        </button>,
                      ],
                      [
                        t("environmentAdmin.host"),
                        <div className="flex items-center justify-end gap-2.5">
                          <OSIcon name={env.host?.os_name} avatar size="sm" />
                          <span className="min-w-0 break-words">
                            {env.host?.hostname ||
                              env.host?.name ||
                              t("environmentAdmin.unknownHost")}
                          </span>
                        </div>,
                      ],
                      [
                        "CPU",
                        (activeUsage?.cpu_cores?.toFixed(2) ?? "—") +
                          " / " +
                          env.spec.resource.cpu_millis / 1000 +
                          " CPU",
                      ],
                      [
                        t("pages.engineHosts.memory"),
                        (activeUsage?.memory_bytes === undefined
                          ? "—"
                          : (activeUsage.memory_bytes / MiB).toFixed(1) +
                            " MiB") +
                          " / " +
                          (env.spec.resource.memory_bytes / MiB).toFixed(1) +
                          " MiB",
                      ],
                    ]}
                  />
                  {activeUsage && (env.stale || env.usage_stale) && (
                    <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                      {t("pages.engineHosts.lastReport")}
                    </p>
                  )}
                </DetailSection>
                <DetailSection title={t("environmentAdmin.technicalDetails")}>
                  <DetailRows
                    items={[
                      [t("environmentAdmin.environmentID"), env.id],
                      [t("environmentAdmin.instanceID"), env.instance_id],
                      [
                        t("environmentAdmin.runtimeVersion"),
                        env.runtime_version ||
                          t("environmentAdmin.runtimeUnknown"),
                      ],
                      [t("environmentAdmin.image"), env.spec.image],
                    ]}
                  />
                </DetailSection>
              </>
            )}
            <DetailSection title={t("environmentAdmin.operations")}>
              <div className="px-4 py-3 empty:hidden">
                <LoadState
                  {...operations}
                  empty={!operations.data?.items.length}
                />
              </div>
              <ol className="divide-y">
                {operations.data?.items.map((op) => (
                  <li
                    key={op.id}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-x-4 px-4 py-3 text-sm"
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>#{op.generation}</span>
                      <HugeiconsIcon
                        icon={DotIcon}
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      {t("environmentAdmin.targets." + op.desired)}
                      <HugeiconsIcon
                        icon={DotIcon}
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span
                        className={
                          op.status === "failed"
                            ? "text-destructive"
                            : undefined
                        }
                      >
                        {t("environmentAdmin.operationStates." + op.status)}
                      </span>
                    </span>
                    <time
                      dateTime={op.created_at}
                      className="shrink-0 text-end text-muted-foreground"
                    >
                      {date(op.created_at)}
                    </time>
                  </li>
                ))}
              </ol>
            </DetailSection>
          </div>
        </ScrollArea>
        <DialogFooter className="shrink-0 items-center pt-4 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {t("environmentAdmin.observed")}：
            {env?.observed_at ? date(env.observed_at) : "—"}
          </p>
          <Button size="sm" onClick={close}>
            {t("environmentAdmin.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
      {accountUserID && (
        <AccountDialog
          key={accountUserID}
          userId={accountUserID}
          onClose={() => setAccountUserID(null)}
        />
      )}
    </Dialog>
  )
}
