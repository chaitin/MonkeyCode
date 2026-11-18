import {
  CloudSection,
  CloudGrid,
} from "@/components/environments/cloud-section"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog"
import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { CONSOLE_ROUTES } from "@/lib/routes"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import { useAppToast } from "@/components/animated-toast-provider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CircularProgress } from "@/components/ui/circular-progress"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"
import { HostStatus } from "@/components/environments/status-badge"
import { ResourceAuthorizationBadge } from "@/components/resource-authorization-badge"
import type { Grant } from "@/lib/resources"
import { loadEngineHosts } from "@/lib/engine-hosts"
import {
  HostUpgrade,
  type HostUpgradeState,
} from "@/components/environments/host-upgrade"
import { HostSetupDialog } from "@/components/environments/host-setup-dialog"
import { SpecificationsDialog } from "@/components/environments/specifications-dialog"
import { HugeiconsIcon } from "@hugeicons/react"
import { Info } from "lucide-react"
import {
  Add01Icon,
  MoreHorizontalIcon,
  PlayIcon,
  PauseIcon,
  Edit02Icon,
  Delete02Icon,
  ArrowRight01Icon,
  DotIcon,
} from "@hugeicons/core-free-icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { OSIcon } from "@/components/environments/os-icon"
import { HostCommand } from "@/components/environments/host-command"
import { rememberCommand } from "@/lib/host-command"
import { useAuth } from "@/hooks/use-auth"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"

type Usage = {
  total_bytes: number
  used_bytes: number
  available_bytes: number
}
type HostSystem = {
  network?: {
    receive_bytes_per_second: number
    transmit_bytes_per_second: number
  }
  disk_io?: { read_bytes_per_second: number; write_bytes_per_second: number }
  private_ips?: string[]
  public_ips?: string[]
  hostname: string
  os_name: string
  kernel_version: string
  cpu?: { model: string; logical_cores: number; usage_percent?: number }
  memory?: Usage
  disk?: Usage & { path: string }
}
function bytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—"
  const unit = value >= 1000 ** 4 ? "TB" : value >= 1000 ** 3 ? "GB" : "MB"
  const scale =
    unit === "TB" ? 1000 ** 4 : unit === "GB" ? 1000 ** 3 : 1000 ** 2
  return `${(value / scale).toFixed(1)} ${unit}`
}
function rate(value?: number) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "—"
  const units = ["Bps", "KBps", "MBps", "GBps"]
  const index = Math.min(
    3,
    Math.max(0, Math.floor(Math.log10(Math.max(1, value)) / 3))
  )
  return `${(value / 1000 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}
function relativeTime(
  value: string,
  now: number,
  formatter: Intl.RelativeTimeFormat
) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return "—"
  const elapsed = Math.max(0, now - timestamp)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 86_400_000],
    ["month", 30 * 86_400_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
  ]
  const [unit, duration] = units.find(
    ([, duration]) => elapsed >= duration
  ) ?? ["second", 1000]
  return formatter
    .format(-Math.floor(elapsed / duration), unit)
    .replace(/([0-9])(?=[一-龥])/g, "$1 ")
}
const missingValue = <span className="text-muted-foreground">—</span>
const authorizationNames: ReadonlyMap<string, string> = new Map()

function displayValue(value: string) {
  const trimmed = value.trim()
  return trimmed === "" || /^[−–—-]$/.test(trimmed) ? missingValue : value
}

function ReportAge({
  value,
  formatter,
}: {
  value: string
  formatter: Intl.RelativeTimeFormat
}) {
  const [receivedAt] = useState(Date.now)
  return relativeTime(value, receivedAt, formatter)
}

function percentColor(value?: number) {
  if (
    value === undefined ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  )
    return undefined
  return value > 80
    ? "text-destructive"
    : value > 50
      ? "text-orange-600 dark:text-orange-400"
      : undefined
}
function percent(value?: number) {
  return value !== undefined &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? `${value.toFixed(1)}%`
    : "—"
}
function usage(value?: Usage) {
  return value && value.total_bytes > 0
    ? (value.used_bytes / value.total_bytes) * 100
    : undefined
}

type Host = {
  grants: Grant[]
  id: string
  name: string
  architecture: string
  version: string
  status: "pending" | "active" | "revoked"
  online: boolean
  enabled: boolean
  user_id: string
  environment_count: number
  upgrade?: HostUpgradeState
  activated_at: string | null
  last_seen_at: string | null
  report: {
    at?: string
    os?: string
    system?: HostSystem
    prerequisites_met?: boolean
    checks?: { name: string; passed: boolean; detail: string }[]
  }
}
type Enrollment = {
  host_id: string
  command: string
  version: string
  expires_at: string
}

export function EngineHostsPage() {
  const { showToast } = useAppToast()
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const relativeFormatter = useMemo(
    () => new Intl.RelativeTimeFormat(locale, { numeric: "always" }),
    [locale]
  )
  const { user } = useAuth()
  const text = (key: string, options?: Record<string, string | number>) =>
    t(`pages.engineHosts.${key}`, options)
  const [formError, setFormError] = useState("")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [deleting, setDeleting] = useState<Host | null>(null)
  const [deleteError, setDeleteError] = useState("")
  const [scheduling, setScheduling] = useState<string | null>(null)

  const [managingSpecifications, setManagingSpecifications] = useState(false)
  const [configuring, setConfiguring] = useState<Host | null>(null)
  const [checking, setChecking] = useState<Host | null>(null)
  const result = useEnvironmentData<{ items: Host[]; total: number }>(
    "/api/admin/v1/engine-hosts",
    true,
    loadEngineHosts<Host>
  )
  const hosts = result.data?.items ?? []
  const refresh = result.refresh
  const detail = hosts.find((host) => host.id === checking?.id) ?? checking
  const detailAddresses = [
    ...new Set([
      ...(detail?.report.system?.public_ips ?? []),
      ...(detail?.report.system?.private_ips ?? []),
    ]),
  ].join(", ")

  useEffect(() => {
    if (!open || !enrollment) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open, enrollment])

  async function create() {
    if (busy) return
    setOpen(true)
    setBusy(true)
    setFormError("")
    try {
      const result = await api<Enrollment>(
        "/api/admin/v1/engine-host-enrollments",
        {
          method: "POST",
          body: "{}",
        }
      )
      setEnrollment(result)
      rememberCommand(user?.id ?? "", result)
      refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : text("createFailed"))
    } finally {
      setBusy(false)
    }
  }
  async function changeScheduling(host: Host, enabled: boolean) {
    if (scheduling) return
    setScheduling(host.id)
    try {
      await api(`/api/admin/v1/environment-hosts/${host.id}/scheduling`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      })
      showToast({
        status: "success",
        title: text(enabled ? "schedulingEnabled" : "schedulingDisabled"),
      })
      refresh()
    } catch (error) {
      showToast({
        status: "error",
        title:
          error instanceof Error ? error.message : text("schedulingFailed"),
      })
    } finally {
      setScheduling(null)
    }
  }
  async function copy() {
    if (!enrollment) return
    try {
      await navigator.clipboard.writeText(enrollment.command)
      showToast({ status: "success", title: text("copied") })
      setFormError("")
    } catch {
      showToast({ status: "error", title: text("copyFailed") })
    }
  }
  async function deleteHost() {
    if (!deleting || busy) return
    setBusy(true)
    setDeleteError("")
    try {
      await api(`/api/admin/v1/engine-hosts/${deleting.id}/record`, {
        method: "DELETE",
      })
      if (enrollment?.host_id === deleting.id) setEnrollment(null)
      if (checking?.id === deleting.id) setChecking(null)
      showToast({ status: "success", title: text("deleteSuccess") })
      setDeleting(null)
      refresh()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : text("deleteFailed"))
    } finally {
      setBusy(false)
    }
  }
  const expired =
    enrollment !== null && new Date(enrollment.expires_at).getTime() <= now
  const close = (value: boolean) => {
    if (busy) return
    setOpen(value)
    if (!value) {
      setEnrollment(null)
      setFormError("")
    }
  }
  return (
    <CloudSection
      title={text("title")}
      headerAction={
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setManagingSpecifications(true)}
          >
            {t("environmentAdmin.specifications.title")}
          </Button>
          <Button
            variant={result.data?.total === 0 ? "default" : "outline"}
            disabled={busy}
            onClick={() => void create()}
          >
            <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
            {text("add")}
          </Button>
        </div>
      }
    >
      <CloudGrid
        singleColumn
        title={text("title")}
        {...result}
        empty={!hosts.length}
      >
        {hosts.map((host) => {
          const status =
            host.status === "revoked"
              ? "revoked"
              : host.status === "pending"
                ? "pending"
                : host.online
                  ? "online"
                  : "offline"
          const system = host.report.system
          const addresses = [
            ...new Set([
              ...(system?.public_ips ?? []),
              ...(system?.private_ips ?? []),
            ]),
          ].join(", ")
          return (
            <Card
              key={host.id}
              size="sm"
              className={cn(
                "min-w-0",
                !host.enabled &&
                  "bg-muted ring-gray-300 dark:bg-muted dark:ring-gray-700"
              )}
            >
              <CardHeader>
                <div className="flex min-w-0 items-start gap-3">
                  <OSIcon name={system?.os_name} avatar />
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        className="min-w-0 truncate text-start transition-colors hover:text-blue-600 dark:hover:text-blue-400"
                        title={host.name}
                        onClick={() => setChecking(host)}
                      >
                        {host.name}
                      </button>
                      {!host.enabled && (
                        <Badge variant="outline">{text("disabled")}</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="flex min-w-0 items-center gap-1">
                      <span className="shrink-0">
                        {system?.os_name || missingValue}
                      </span>
                      <HugeiconsIcon
                        icon={DotIcon}
                        className="size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span
                        className="truncate"
                        title={addresses || text("ipPending")}
                      >
                        {addresses || text("ipPending")}
                      </span>
                    </CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          aria-label={t("common.more")}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
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
                        <DropdownMenuItem
                          disabled={
                            host.enabled ||
                            host.status !== "active" ||
                            scheduling !== null ||
                            busy
                          }
                          onClick={() => void changeScheduling(host, true)}
                        >
                          <HugeiconsIcon
                            icon={PlayIcon}
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          {text("enable")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={
                            !host.enabled ||
                            host.status !== "active" ||
                            scheduling !== null ||
                            busy
                          }
                          onClick={() => void changeScheduling(host, false)}
                        >
                          <HugeiconsIcon
                            icon={PauseIcon}
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          {text("disable")}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          disabled={host.status !== "active" || busy}
                          onClick={() => setConfiguring(host)}
                        >
                          <HugeiconsIcon
                            icon={Edit02Icon}
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          {t("environmentAdmin.configure")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setChecking(host)}>
                          <Info aria-hidden="true" />
                          {t("environmentAdmin.details")}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={busy}
                          onClick={() => {
                            setDeleting(host)
                            setDeleteError("")
                          }}
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
                </div>
              </CardHeader>
              <CardFooter
                className={cn(
                  "min-w-0 flex-wrap gap-2 border-t",
                  !host.enabled && "border-gray-300 dark:border-gray-700"
                )}
              >
                <ResourceAuthorizationBadge
                  grants={host.grants}
                  groupNames={authorizationNames}
                  memberNames={authorizationNames}
                />
                <HostStatus status={status} />
                {typeof host.environment_count === "number" && (
                  <Badge
                    variant="outline"
                    className="border-blue-200 bg-blue-50 tabular-nums text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 [&:is(a)]:hover:bg-blue-100 [&:is(a)]:hover:text-blue-900 dark:[&:is(a)]:hover:bg-blue-900 dark:[&:is(a)]:hover:text-blue-100"
                    render={
                      <Link
                        to={`${CONSOLE_ROUTES.cloudHosts}?${new URLSearchParams({ host_id: host.id, host_name: host.name })}`}
                      />
                    }
                    aria-label={text("viewEnvironments", {
                      name: host.name,
                      count: host.environment_count,
                    })}
                    title={text("environmentCountHint")}
                  >
                    {text("environmentCountBadge", {
                      count: host.environment_count,
                    })}
                  </Badge>
                )}
                {host.status !== "pending" && host.architecture && (
                  <Badge
                    variant="outline"
                    className="border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200"
                    title={text("architecture")}
                  >
                    {host.architecture}
                  </Badge>
                )}
                {system?.cpu && system.cpu.logical_cores > 0 && (
                  <Tooltip>
                    <Badge
                      variant="outline"
                      className="cursor-default"
                      render={<TooltipTrigger render={<span />} tabIndex={0} />}
                    >
                      <CircularProgress value={system.cpu.usage_percent} />
                      {text("cpuCapacityBadge", {
                        count: system.cpu.logical_cores,
                      })}
                    </Badge>
                    <TooltipContent>
                      {text("cpuUsage")}: {percent(system.cpu.usage_percent)}
                    </TooltipContent>
                  </Tooltip>
                )}
                {system?.memory && system.memory.total_bytes > 0 && (
                  <Tooltip>
                    <Badge
                      variant="outline"
                      className="cursor-default"
                      render={<TooltipTrigger render={<span />} tabIndex={0} />}
                    >
                      <CircularProgress value={usage(system.memory)} />
                      {text("memoryCapacityBadge", {
                        size: Math.ceil(system.memory.total_bytes / 1024 ** 3),
                      })}
                    </Badge>
                    <TooltipContent>
                      {text("memoryUsage")}: {percent(usage(system.memory))}
                    </TooltipContent>
                  </Tooltip>
                )}
                {system?.disk && system.disk.total_bytes > 0 && (
                  <Tooltip>
                    <Badge
                      variant="outline"
                      className="cursor-default"
                      render={<TooltipTrigger render={<span />} tabIndex={0} />}
                    >
                      <CircularProgress value={usage(system.disk)} />
                      {text("diskCapacityBadge", {
                        size: Math.ceil(system.disk.total_bytes / 1024 ** 3),
                      })}
                    </Badge>
                    <TooltipContent>
                      {text("diskUsage")}: {percent(usage(system.disk))}
                    </TooltipContent>
                  </Tooltip>
                )}
              </CardFooter>
            </Card>
          )
        })}
      </CloudGrid>
      {managingSpecifications && (
        <SpecificationsDialog
          onClose={() => setManagingSpecifications(false)}
          onSave={() => {
            setManagingSpecifications(false)
            showToast({
              status: "success",
              title: t("environmentAdmin.specifications.saved"),
            })
          }}
        />
      )}
      {configuring && (
        <HostSetupDialog
          host={configuring}
          close={() => setConfiguring(null)}
          saved={() => {
            setConfiguring(null)
            showToast({
              status: "success",
              title: t("environmentAdmin.setupSaved"),
            })
            refresh()
          }}
        />
      )}
      <Dialog
        open={!!checking}
        onOpenChange={(value) => {
          if (!value) setChecking(null)
        }}
      >
        <DialogContent
          className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl"
          closeLabel={text("close")}
        >
          <DialogHeader>
            <DialogTitle>{text("details")}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="-me-6 flex min-h-0 flex-1 flex-col [&_[data-slot=scroll-area-viewport]]:min-h-0">
            {detail && (
              <div className="space-y-6 pe-6">
                <section className="space-y-4 rounded-xl bg-muted/40 p-4">
                  <div className="flex items-center gap-3">
                    <OSIcon name={detail.report.system?.os_name} avatar />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-base font-semibold">
                        {displayValue(
                          detail.report.system?.hostname || detail.name || ""
                        )}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <span>
                          {detail.report.system?.os_name || missingValue}
                        </span>
                        <HugeiconsIcon
                          icon={DotIcon}
                          className="size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span
                          className="min-w-0 truncate"
                          title={detailAddresses || "—"}
                        >
                          {detailAddresses || "—"}
                        </span>
                      </p>
                    </div>
                    <HostStatus
                      status={
                        detail.status === "revoked"
                          ? "revoked"
                          : detail.status === "pending"
                            ? "pending"
                            : detail.online
                              ? "online"
                              : "offline"
                      }
                    />
                  </div>
                </section>
                <Collapsible defaultOpen className="rounded-lg border">
                  <CollapsibleTrigger
                    type="button"
                    className="group flex w-full items-center gap-3 rounded-t-lg px-4 py-3 text-start hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                  >
                    <span className="font-medium">
                      {text("engineInformation")}
                    </span>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      strokeWidth={2}
                      aria-hidden="true"
                      className="ms-auto size-4 transition-transform group-aria-expanded:rotate-90 [[dir=rtl]_&]:rotate-180 [[dir=rtl]_&]:group-aria-expanded:-rotate-90"
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent keepMounted className="border-t">
                    <dl className="divide-y">
                      {(
                        [
                          [
                            t("environmentAdmin.activatedAt"),
                            detail.activated_at
                              ? new Date(detail.activated_at).toLocaleString()
                              : missingValue,
                          ],
                          [
                            t("environmentAdmin.version"),
                            <span className="flex flex-wrap items-center justify-end gap-2">
                              {detail.status === "active" && (
                                <HostUpgrade
                                  key={detail.id}
                                  host={detail}
                                  refresh={refresh}
                                  dialog
                                />
                              )}
                              <span>{displayValue(detail.version || "")}</span>
                            </span>,
                          ] as const,
                        ] as const
                      ).map(([label, value]) => (
                        <div
                          key={label}
                          className={cn(
                            "flex items-center justify-between gap-4 px-4 text-sm",
                            label === t("environmentAdmin.version") &&
                              detail.status === "active" &&
                              detail.upgrade?.update_available
                              ? "py-2.5"
                              : "py-3"
                          )}
                        >
                          <dt className="shrink-0 text-muted-foreground">
                            {label}
                          </dt>
                          <dd className="min-w-0 break-all text-right">
                            {typeof value === "string"
                              ? displayValue(value)
                              : value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </CollapsibleContent>
                </Collapsible>
                <Collapsible defaultOpen className="rounded-lg border">
                  <CollapsibleTrigger
                    type="button"
                    className="group flex w-full items-center gap-3 rounded-t-lg px-4 py-3 text-start hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                  >
                    <span className="font-medium">{text("resourceUsage")}</span>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      strokeWidth={2}
                      aria-hidden="true"
                      className="ms-auto size-4 transition-transform group-aria-expanded:rotate-90 [[dir=rtl]_&]:rotate-180 [[dir=rtl]_&]:group-aria-expanded:-rotate-90"
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent keepMounted className="border-t">
                    <dl className="divide-y">
                      {(
                        [
                          [
                            "CPU",
                            detail.report.system?.cpu ? (
                              <span className="inline-flex flex-wrap items-center justify-end gap-1">
                                <span className="text-muted-foreground">
                                  {detail.report.system?.cpu
                                    ? text("cores", {
                                        count:
                                          detail.report.system.cpu
                                            .logical_cores,
                                      })
                                    : missingValue}
                                </span>
                                <HugeiconsIcon
                                  icon={DotIcon}
                                  className="size-4 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                                <span
                                  className={percentColor(
                                    detail.report.system?.cpu?.usage_percent
                                  )}
                                >
                                  {displayValue(
                                    percent(
                                      detail.report.system?.cpu?.usage_percent
                                    )
                                  )}
                                </span>
                              </span>
                            ) : (
                              missingValue
                            ),
                          ],
                          [
                            text("memory"),
                            detail.report.system?.memory ? (
                              <span className="inline-flex flex-wrap items-center justify-end gap-1">
                                <span className="text-muted-foreground">
                                  {displayValue(
                                    bytes(
                                      detail.report.system.memory.used_bytes
                                    )
                                  )}{" "}
                                  /{" "}
                                  {displayValue(
                                    bytes(
                                      detail.report.system.memory.total_bytes
                                    )
                                  )}
                                </span>
                                <HugeiconsIcon
                                  icon={DotIcon}
                                  className="size-4 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                                <span
                                  className={percentColor(
                                    usage(detail.report.system.memory)
                                  )}
                                >
                                  {displayValue(
                                    percent(usage(detail.report.system.memory))
                                  )}
                                </span>
                              </span>
                            ) : (
                              missingValue
                            ),
                          ],
                          [
                            text("disk"),
                            detail.report.system?.disk ? (
                              <span className="inline-flex flex-wrap items-center justify-end gap-1">
                                <span className="text-muted-foreground">
                                  {displayValue(
                                    bytes(detail.report.system.disk.used_bytes)
                                  )}{" "}
                                  /{" "}
                                  {displayValue(
                                    bytes(detail.report.system.disk.total_bytes)
                                  )}
                                </span>
                                <HugeiconsIcon
                                  icon={DotIcon}
                                  className="size-4 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                                <span
                                  className={percentColor(
                                    usage(detail.report.system.disk)
                                  )}
                                >
                                  {displayValue(
                                    percent(usage(detail.report.system.disk))
                                  )}
                                </span>
                              </span>
                            ) : (
                              missingValue
                            ),
                          ],
                          [
                            text("networkThroughput"),
                            detail.report.system?.network ? (
                              <span className="inline-flex flex-wrap items-center justify-end gap-1">
                                <span>
                                  {text("receiveRate")}{" "}
                                  {displayValue(
                                    rate(
                                      detail.report.system?.network
                                        ?.receive_bytes_per_second
                                    )
                                  )}
                                </span>
                                <HugeiconsIcon
                                  icon={DotIcon}
                                  className="size-4 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                                <span>
                                  {text("transmitRate")}{" "}
                                  {displayValue(
                                    rate(
                                      detail.report.system?.network
                                        ?.transmit_bytes_per_second
                                    )
                                  )}
                                </span>
                              </span>
                            ) : (
                              missingValue
                            ),
                          ],
                          [
                            text("diskThroughput"),
                            detail.report.system?.disk_io ? (
                              <span className="inline-flex flex-wrap items-center justify-end gap-1">
                                <span>
                                  {text("readRate")}{" "}
                                  {displayValue(
                                    rate(
                                      detail.report.system?.disk_io
                                        ?.read_bytes_per_second
                                    )
                                  )}
                                </span>
                                <HugeiconsIcon
                                  icon={DotIcon}
                                  className="size-4 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                                <span>
                                  {text("writeRate")}{" "}
                                  {displayValue(
                                    rate(
                                      detail.report.system?.disk_io
                                        ?.write_bytes_per_second
                                    )
                                  )}
                                </span>
                              </span>
                            ) : (
                              missingValue
                            ),
                          ],
                        ] as const
                      ).map(([label, value]) => (
                        <div
                          key={label}
                          className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                        >
                          <dt className="shrink-0 text-muted-foreground">
                            {label}
                          </dt>
                          <dd className="min-w-0 break-all text-right tabular-nums">
                            {typeof value === "string"
                              ? displayValue(value)
                              : value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </CollapsibleContent>
                </Collapsible>
                <Collapsible defaultOpen className="rounded-lg border">
                  <CollapsibleTrigger
                    type="button"
                    className="group flex w-full items-center gap-3 rounded-t-lg px-4 py-3 text-start hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                  >
                    <span className="font-medium">{text("systemDetails")}</span>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      strokeWidth={2}
                      aria-hidden="true"
                      className="ms-auto size-4 transition-transform group-aria-expanded:rotate-90 [[dir=rtl]_&]:rotate-180 [[dir=rtl]_&]:group-aria-expanded:-rotate-90"
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent keepMounted className="border-t">
                    <dl className="divide-y">
                      {(
                        [
                          [
                            text("hostname"),
                            detail.report.system?.hostname || missingValue,
                          ],
                          [
                            text("system"),
                            detail.report.system?.os_name &&
                            detail.report.system.os_name.toLowerCase() !==
                              "linux"
                              ? detail.report.system.os_name
                              : missingValue,
                          ],
                          [
                            text("kernel"),
                            detail.report.system?.kernel_version ||
                              missingValue,
                          ],
                          [
                            text("architecture"),
                            detail.status === "pending"
                              ? missingValue
                              : detail.architecture || missingValue,
                          ],
                          [
                            text("cpuModel"),
                            detail.report.system?.cpu?.model || missingValue,
                          ],
                          [
                            text("privateIP"),
                            detail.report.system?.private_ips?.join(", ") ||
                              missingValue,
                          ],
                          [
                            text("publicIP"),
                            detail.report.system?.public_ips?.join(", ") ||
                              missingValue,
                          ],
                          [
                            text("dataDir"),
                            detail.report.system?.disk?.path || missingValue,
                          ],
                        ] as const
                      ).map(([label, value]) => (
                        <div
                          key={label}
                          className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                        >
                          <dt className="shrink-0 text-muted-foreground">
                            {label}
                          </dt>
                          <dd className="min-w-0 break-all text-right">
                            {typeof value === "string"
                              ? displayValue(value)
                              : value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}
          </ScrollArea>
          {detail && (
            <DialogFooter className="shrink-0 items-center pt-4 sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {text("reportTime")}
                {"："}
                {detail.last_seen_at ? (
                  <time
                    dateTime={detail.last_seen_at}
                    title={new Date(detail.last_seen_at).toLocaleString()}
                  >
                    <ReportAge
                      key={detail.last_seen_at}
                      value={detail.last_seen_at}
                      formatter={relativeFormatter}
                    />
                  </time>
                ) : (
                  missingValue
                )}
              </p>
              <div className="flex items-center gap-2">
                {detail.status === "pending" && (
                  <HostCommand
                    host={detail}
                    refresh={refresh}
                    onRenewed={(value) => {
                      setChecking((current) =>
                        current
                          ? {
                              ...current,
                              id: value.host_id,
                              version: value.version,
                            }
                          : current
                      )
                    }}
                  />
                )}
                <Button size="sm" onClick={() => setChecking(null)}>
                  {text("close")}
                </Button>
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent
          className="min-w-0 [&>*]:min-w-0"
          closeLabel={text("close")}
        >
          <DialogHeader>
            <DialogTitle>{text("add")}</DialogTitle>
            <DialogDescription>{text("commandHint")}</DialogDescription>
          </DialogHeader>
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          {enrollment ? (
            <div className="space-y-4">
              <p
                role="status"
                className={
                  expired
                    ? "text-sm text-destructive"
                    : "text-sm text-muted-foreground"
                }
              >
                {expired
                  ? text("commandExpired")
                  : `${text("expires")}：${new Date(enrollment.expires_at).toLocaleString()}`}
              </p>
              <Field>
                <FieldLabel htmlFor="engine-command">
                  {text("command")}
                </FieldLabel>
                <Textarea
                  id="engine-command"
                  readOnly
                  value={expired ? "" : enrollment.command}
                  className="min-h-28 w-full min-w-0 max-w-full resize-none break-all font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
              </Field>
              <DialogFooter>
                <Button variant="outline" onClick={() => close(false)}>
                  {text("close")}
                </Button>
                <Button disabled={expired} onClick={() => void copy()}>
                  {text("copy")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              {busy && (
                <p role="status" className="text-sm text-muted-foreground">
                  {text("creating")}
                </p>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => close(false)}
                >
                  {text("close")}
                </Button>
                {!busy && (
                  <Button onClick={() => void create()}>{text("retry")}</Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(value) => {
          if (!value && !busy) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {text("delete")}：{deleting?.name}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>{text("deleteHint")}</AlertDialogDescription>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              {text("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void deleteHost()}
            >
              {busy ? text("processing") : text("delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CloudSection>
  )
}
