import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog"
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { CONSOLE_ROUTES } from "@/lib/routes"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import { Button, buttonVariants } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { HostStatus } from "@/components/environments/status-badge"
import {
  EnvironmentFrame,
  EnvironmentTable,
  Pagination,
  Identity,
} from "@/components/environments/common"
import {
  HostUpgrade,
  type HostUpgradeState,
} from "@/components/environments/host-upgrade"
import { HostSetupDialog } from "@/components/environments/host-setup-dialog"
import { ResourceMeter } from "@/components/environments/resource-meter"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  ArrowUp02Icon,
  CpuIcon,
  RamMemoryIcon,
  HardDriveIcon,
  ArrowDown02Icon,
  Wifi01Icon,
} from "@hugeicons/core-free-icons"
import { ActionButton } from "@/components/environments/action-button"
import { OSIcon } from "@/components/environments/os-icon"
import { HostCommand } from "@/components/environments/host-command"
import { rememberCommand } from "@/lib/host-command"
import { useAuth } from "@/hooks/use-auth"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import { TableCell, TableRow } from "@/components/ui/table"
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
  const unit = value >= 1024 ** 4 ? "TiB" : value >= 1024 ** 3 ? "GiB" : "MiB"
  const scale =
    unit === "TiB" ? 1024 ** 4 : unit === "GiB" ? 1024 ** 3 : 1024 ** 2
  return `${(value / scale).toFixed(1)} ${unit}`
}
function rate(value?: number) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "—"
  const units = ["B/s", "KiB/s", "MiB/s", "GiB/s"]
  const index = Math.min(
    3,
    Math.max(0, Math.floor(Math.log2(Math.max(1, value)) / 10))
  )
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}
function usage(value?: Usage) {
  return value && value.total_bytes > 0
    ? (value.used_bytes / value.total_bytes) * 100
    : undefined
}

type Host = {
  id: string
  name: string
  architecture: string
  version: string
  status: "pending" | "active" | "revoked"
  online: boolean
  enabled: boolean
  max_environments: number
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
  const { t } = useTranslation()
  const { user } = useAuth()
  const text = (key: string, options?: Record<string, string | number>) =>
    t(`pages.engineHosts.${key}`, options)
  const [page, setPage] = useState(1)
  const [formError, setFormError] = useState("")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [deleting, setDeleting] = useState<Host | null>(null)
  const [deleteError, setDeleteError] = useState("")
  const [scheduling, setScheduling] = useState<string | null>(null)
  const [notice, setNotice] = useState("")

  const [configuring, setConfiguring] = useState<Host | null>(null)
  const [checking, setChecking] = useState<Host | null>(null)
  const result = useEnvironmentData<{ items: Host[]; total: number }>(
    `/api/admin/v1/engine-hosts?page=${page}&page_size=20`,
    true
  )
  const hosts = result.data?.items ?? []
  const total = result.data?.total ?? 0
  const refresh = result.refresh
  const detail = hosts.find((host) => host.id === checking?.id) ?? checking

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  async function create() {
    if (busy) return
    setOpen(true)
    setBusy(true)
    setFormError("")
    setCopied(false)
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
      setPage(1)
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
    setNotice("")
    try {
      await api(`/api/admin/v1/environment-hosts/${host.id}/scheduling`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      })
      setNotice(text(enabled ? "schedulingEnabled" : "schedulingDisabled"))
      refresh()
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : text("schedulingFailed")
      )
    } finally {
      setScheduling(null)
    }
  }
  async function copy() {
    if (!enrollment) return
    try {
      await navigator.clipboard.writeText(enrollment.command)
      setCopied(true)
      setFormError("")
    } catch {
      setFormError(text("copyFailed"))
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
      setNotice(text("deleteSuccess"))
      setDeleting(null)
      if (hosts.length === 1 && page > 1) setPage(page - 1)
      else refresh()
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
      setCopied(false)
    }
  }
  return (
    <EnvironmentFrame
      table
      title={text("title")}
      description={text("description")}
      action={
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" disabled={result.loading} onClick={refresh}>
            {t("environmentAdmin.refresh")}
          </Button>
          <Button disabled={busy} onClick={() => void create()}>
            <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
            {text("add")}
          </Button>
        </div>
      }
    >
      {notice && (
        <p
          role="status"
          className="px-[var(--card-spacing)] py-3 text-sm text-muted-foreground"
        >
          {notice}
        </p>
      )}
      <EnvironmentTable
        title={text("title")}
        columns={[
          text("name"),
          t("environmentAdmin.status"),
          text("environmentCount"),
          text("system"),
          text("network"),
          "CPU",
          text("memory"),
          text("disk"),
          t("environmentAdmin.scheduling"),
          t("environmentAdmin.actions"),
        ]}
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
          const stale = !host.online || host.status !== "active"
          return (
            <TableRow key={host.id}>
              <TableCell className="ps-[var(--card-spacing)]">
                <div className="flex items-center gap-3">
                  <OSIcon name={system?.os_name} />
                  <div className="min-w-0">
                    <Button
                      variant="link"
                      className="h-auto max-w-48 justify-start truncate p-0 font-medium"
                      title={host.name}
                      onClick={() => setChecking(host)}
                    >
                      {host.name}
                    </Button>
                    <p
                      className="mt-1 max-w-48 truncate font-mono text-xs text-muted-foreground"
                      title={system?.hostname || host.id}
                    >
                      {system?.hostname || host.id}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <HostStatus status={status} />
              </TableCell>
              <TableCell>
                {typeof host.environment_count === "number" ? (
                  <Link
                    to={`${CONSOLE_ROUTES.environments}?${new URLSearchParams({ host_id: host.id, host_name: host.name })}`}
                    className={`${buttonVariants({ variant: "link" })} min-w-10 tabular-nums`}
                    aria-label={text("viewEnvironments", {
                      name: host.name,
                      count: host.environment_count,
                    })}
                    title={text("environmentCountHint")}
                  >
                    {host.environment_count}
                  </Link>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>
                <p className="max-w-48 truncate" title={system?.os_name}>
                  {system?.os_name && system.os_name.toLowerCase() !== "linux"
                    ? system.os_name
                    : text("notReported")}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {host.status === "pending" ? "—" : host.architecture} ·{" "}
                    {host.version}
                  </span>
                  {host.status === "active" &&
                    host.upgrade?.update_available && (
                      <Button
                        size="xs"
                        variant="outline"
                        aria-label={text("upgrade.action")}
                        title={text("upgrade.versions", {
                          current: host.version,
                          target: host.upgrade.target_version,
                        })}
                        onClick={() => setChecking(host)}
                      >
                        {text("upgrade.shortAction")}
                      </Button>
                    )}
                </div>
              </TableCell>
              <TableCell>
                <div className="space-y-1 text-xs">
                  {(["private_ips", "public_ips"] as const).map((key) => (
                    <div key={key} className="flex items-baseline gap-2">
                      <span className="shrink-0 text-muted-foreground">
                        {text(key === "private_ips" ? "privateIP" : "publicIP")}
                      </span>
                      <span
                        className="max-w-48 truncate font-mono"
                        title={system?.[key]?.join(", ")}
                      >
                        {system?.[key]?.join(", ") || "—"}
                      </span>
                    </div>
                  ))}
                  <p className="flex flex-wrap gap-x-3 tabular-nums text-muted-foreground">
                    <span title={text("receiveRate")}>
                      ↓ {rate(system?.network?.receive_bytes_per_second)}
                    </span>
                    <span title={text("transmitRate")}>
                      ↑ {rate(system?.network?.transmit_bytes_per_second)}
                    </span>
                    {!host.online && system?.network && (
                      <span>{text("lastReport")}</span>
                    )}
                  </p>
                </div>
              </TableCell>
              <TableCell>
                <ResourceMeter
                  label={text("cpuUsage")}
                  value={system?.cpu?.usage_percent}
                  stale={stale}
                  detail={
                    system?.cpu
                      ? text("cores", { count: system.cpu.logical_cores })
                      : text("notReported")
                  }
                />
              </TableCell>
              <TableCell>
                <ResourceMeter
                  label={text("memoryUsage")}
                  value={usage(system?.memory)}
                  stale={stale}
                  detail={
                    system?.memory
                      ? `${bytes(system.memory.used_bytes)} / ${bytes(system.memory.total_bytes)}`
                      : text("notReported")
                  }
                />
              </TableCell>
              <TableCell>
                <ResourceMeter
                  label={text("diskUsage")}
                  value={usage(system?.disk)}
                  stale={stale}
                  detail={
                    system?.disk
                      ? `${bytes(system.disk.used_bytes)} / ${bytes(system.disk.total_bytes)}`
                      : text("notReported")
                  }
                />
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {text("readRate")}{" "}
                  {rate(system?.disk_io?.read_bytes_per_second)} ·{" "}
                  {text("writeRate")}{" "}
                  {rate(system?.disk_io?.write_bytes_per_second)}
                </p>
              </TableCell>
              <TableCell>
                <Switch
                  checked={host.enabled}
                  disabled={
                    host.status !== "active" || scheduling !== null || busy
                  }
                  aria-label={`${t("environmentAdmin.schedulingLabel")} · ${host.name}`}
                  title={t("environmentAdmin.schedulingLabel")}
                  aria-busy={scheduling === host.id}
                  onCheckedChange={(enabled) =>
                    void changeScheduling(host, enabled)
                  }
                />
              </TableCell>
              <TableCell className="pe-[var(--card-spacing)]">
                <div className="flex items-center gap-1">
                  <ActionButton
                    label={t("environmentAdmin.configure")}
                    disabled={host.status !== "active" || busy}
                    onClick={() => setConfiguring(host)}
                  />
                  <ActionButton
                    label={t("environmentAdmin.details")}
                    onClick={() => setChecking(host)}
                  />
                  <ActionButton
                    label={t("environmentAdmin.targets.deleted")}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy}
                    onClick={() => {
                      setDeleting(host)
                      setNotice("")
                      setDeleteError("")
                    }}
                  />
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </EnvironmentTable>
      {configuring && (
        <HostSetupDialog
          host={configuring}
          close={() => setConfiguring(null)}
          saved={() => {
            setConfiguring(null)
            setNotice(t("environmentAdmin.setupSaved"))
            refresh()
          }}
        />
      )}
      <Pagination
        page={page}
        count={hosts.length}
        total={total}
        disabled={result.loading || !!result.error || busy}
        onChange={setPage}
      />
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
            <DialogDescription className="break-all">
              {detail?.name}
              {detail && !detail.online && ` · ${text("lastReport")}`}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="-me-3 flex min-h-0 flex-1 flex-col [&_[data-slot=scroll-area-viewport]]:min-h-0">
            {detail && (
              <div className="space-y-6 pe-3">
                {detail.status === "pending" && (
                  <HostCommand
                    key={detail.id}
                    host={detail}
                    refresh={refresh}
                    onRenewed={(value) => {
                      setChecking(null)
                      setEnrollment(value)
                      setOpen(true)
                    }}
                  />
                )}
                <section className="space-y-4 rounded-xl bg-muted/40 p-4">
                  <div className="flex items-center gap-3">
                    <OSIcon name={detail.report.system?.os_name} />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-base font-semibold">
                        {detail.report.system?.hostname || detail.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {detail.report.system?.os_name || text("notReported")} ·{" "}
                        {detail.architecture} · {detail.version}
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
                  <dl className="grid gap-3 border-t pt-4 sm:grid-cols-2">
                    <Identity
                      label={t("environmentAdmin.activatedAt")}
                      value={
                        detail.activated_at
                          ? new Date(detail.activated_at).toLocaleString()
                          : "—"
                      }
                    />
                    <Identity
                      label={t("environmentAdmin.hostMaxEnvironments")}
                      value={detail.max_environments}
                    />
                    <Identity
                      label={text("privateIP")}
                      value={
                        detail.report.system?.private_ips?.join(", ") ||
                        text("notReported")
                      }
                    />
                    <Identity
                      label={text("publicIP")}
                      value={
                        detail.report.system?.public_ips?.join(", ") ||
                        text("notReported")
                      }
                    />
                  </dl>
                </section>
                <section
                  className="space-y-4 rounded-lg border p-4"
                  aria-label={text("resourceUsage")}
                >
                  <div>
                    <h3 className="text-sm font-medium">
                      {text("resourceUsage")}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {text("lastSeen")} ·{" "}
                      {detail.last_seen_at
                        ? new Date(detail.last_seen_at).toLocaleString()
                        : "—"}
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3 [&>div]:rounded-lg [&>div]:bg-muted/40 [&>div]:p-3 [&_.font-medium]:text-2xl">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <HugeiconsIcon
                          icon={CpuIcon}
                          className="size-4"
                          aria-hidden="true"
                        />
                        CPU
                      </p>
                      <ResourceMeter
                        label={text("cpuUsage")}
                        value={detail.report.system?.cpu?.usage_percent}
                        stale={!detail.online}
                        detail={
                          detail.report.system?.cpu
                            ? text("cores", {
                                count: detail.report.system.cpu.logical_cores,
                              })
                            : text("notReported")
                        }
                      />
                    </div>
                    <div>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <HugeiconsIcon
                          icon={RamMemoryIcon}
                          className="size-4"
                          aria-hidden="true"
                        />
                        {text("memory")}
                      </p>
                      <ResourceMeter
                        label={text("memoryUsage")}
                        value={usage(detail.report.system?.memory)}
                        stale={!detail.online}
                        detail={
                          detail.report.system?.memory
                            ? `${bytes(detail.report.system.memory.used_bytes)} / ${bytes(detail.report.system.memory.total_bytes)}`
                            : text("notReported")
                        }
                      />
                    </div>
                    <div>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <HugeiconsIcon
                          icon={HardDriveIcon}
                          className="size-4"
                          aria-hidden="true"
                        />
                        {text("disk")}
                      </p>
                      <ResourceMeter
                        label={text("diskUsage")}
                        value={usage(detail.report.system?.disk)}
                        stale={!detail.online}
                        detail={
                          detail.report.system?.disk
                            ? `${bytes(detail.report.system.disk.used_bytes)} / ${bytes(detail.report.system.disk.total_bytes)}`
                            : text("notReported")
                        }
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {[
                      {
                        icon: Wifi01Icon,
                        label: text("networkThroughput"),
                        first: text("receiveRate"),
                        second: text("transmitRate"),
                        a: detail.report.system?.network
                          ?.receive_bytes_per_second,
                        b: detail.report.system?.network
                          ?.transmit_bytes_per_second,
                      },
                      {
                        icon: HardDriveIcon,
                        label: text("diskThroughput"),
                        first: text("readRate"),
                        second: text("writeRate"),
                        a: detail.report.system?.disk_io?.read_bytes_per_second,
                        b: detail.report.system?.disk_io
                          ?.write_bytes_per_second,
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="space-y-3 rounded-lg bg-muted/40 p-3"
                      >
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <HugeiconsIcon
                            icon={item.icon}
                            className="size-4"
                            aria-hidden="true"
                          />
                          {item.label}
                          {!detail.online &&
                            (item.a !== undefined || item.b !== undefined) && (
                              <span className="ml-auto">
                                {text("lastReport")}
                              </span>
                            )}
                        </p>
                        <dl className="grid grid-cols-2 gap-3">
                          <div>
                            <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                              <HugeiconsIcon
                                icon={ArrowDown02Icon}
                                className="size-3"
                                aria-hidden="true"
                              />
                              {item.first}
                            </dt>
                            <dd className="mt-1 text-sm font-semibold tabular-nums">
                              {rate(item.a)}
                            </dd>
                          </div>
                          <div>
                            <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                              <HugeiconsIcon
                                icon={ArrowUp02Icon}
                                className="size-3"
                                aria-hidden="true"
                              />
                              {item.second}
                            </dt>
                            <dd className="mt-1 text-sm font-semibold tabular-nums">
                              {rate(item.b)}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {text("throughputHint")}
                  </p>
                </section>
                <Collapsible className="rounded-lg border p-4">
                  <CollapsibleTrigger className="group/section flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {text("systemDetails")}
                    <HugeiconsIcon
                      icon={ArrowDown02Icon}
                      aria-hidden="true"
                      className="size-4 group-aria-expanded/section:rotate-180"
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-4 space-y-4">
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <Identity
                        label={text("hostname")}
                        value={
                          detail.report.system?.hostname || text("notReported")
                        }
                      />
                      <Identity
                        label={t("environmentAdmin.host")}
                        value={detail.id}
                      />
                      <Identity
                        label={text("system")}
                        value={
                          detail.report.system?.os_name &&
                          detail.report.system.os_name.toLowerCase() !== "linux"
                            ? detail.report.system.os_name
                            : text("notReported")
                        }
                      />
                      <Identity
                        label={text("kernel")}
                        value={
                          detail.report.system?.kernel_version ||
                          text("notReported")
                        }
                      />
                      <Identity
                        label={text("architecture")}
                        value={
                          detail.status === "pending"
                            ? "—"
                            : detail.architecture
                        }
                      />
                      <Identity
                        label={t("environmentAdmin.version")}
                        value={detail.version}
                      />
                      <Identity
                        label={text("cpuModel")}
                        value={
                          detail.report.system?.cpu?.model ||
                          text("notReported")
                        }
                      />
                      <Identity
                        label={text("lastSeen")}
                        value={
                          detail.last_seen_at
                            ? new Date(detail.last_seen_at).toLocaleString()
                            : "—"
                        }
                      />
                    </dl>
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <Identity
                        label={text("dataDir")}
                        value={
                          detail.report.system?.disk?.path ||
                          text("notReported")
                        }
                      />
                      <Identity
                        label={text("diskAvailable")}
                        value={
                          detail.report.system?.disk
                            ? bytes(detail.report.system.disk.available_bytes)
                            : text("notReported")
                        }
                      />
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      {text("metricsHint")}
                    </p>
                  </CollapsibleContent>
                </Collapsible>
                {detail.status === "active" && (
                  <Collapsible
                    key={`upgrade-${detail.id}`}
                    defaultOpen={Boolean(
                      detail.upgrade?.update_available ||
                      (detail.upgrade?.task &&
                        detail.upgrade.task.status !== "succeeded")
                    )}
                    className="rounded-lg border p-4"
                  >
                    <CollapsibleTrigger className="group/section flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {text("engineMaintenance")}
                      <HugeiconsIcon
                        icon={ArrowDown02Icon}
                        aria-hidden="true"
                        className="size-4 group-aria-expanded/section:rotate-180"
                      />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-4">
                      <HostUpgrade
                        key={detail.id}
                        host={detail}
                        refresh={refresh}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            )}
          </ScrollArea>
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
                  {copied ? text("copied") : text("copy")}
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
    </EnvironmentFrame>
  )
}
