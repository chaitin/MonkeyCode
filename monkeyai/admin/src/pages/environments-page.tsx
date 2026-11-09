import { ArrowDown02Icon } from "@hugeicons/core-free-icons"
import { ActionButton } from "@/components/environments/action-button"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { EnvironmentUsage } from "@/components/environments/environment-usage"
import { EnvironmentBillingInfo } from "@/components/environments/environment-billing"
import { EnvironmentStatus } from "@/components/environments/status-badge"
import { OSIcon } from "@/components/environments/os-icon"
import { UserAvatar } from "@/components/user-avatar"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog"
import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { api, ApiError } from "@/lib/api"
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
  EnvironmentFrame,
  EnvironmentTable,
  LoadState,
  Pagination,
  Identity,
  FormError,
} from "@/components/environments/common"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
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
  DialogDescription,
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
const sorts = ["newest", "cpu_desc", "cpu_asc", "memory_desc", "memory_asc"]
export function EnvironmentsPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const page = Math.max(
    1,
    Math.min(100000, Number.parseInt(params.get("page") || "1", 10) || 1)
  )
  const selected = params.get("environment")
  const hostID = params.get("host_id") || ""
  const hostName = params.get("host_name") || hostID
  const status = statuses.includes(params.get("status") || "")
    ? params.get("status")!
    : "active"
  const sort = sorts.includes(params.get("sort") || "")
    ? params.get("sort")!
    : "newest"
  const statusOptions = statuses.map((value) => ({
    value,
    label: t(
      `environmentAdmin.${value === "active" || value === "all" ? `filters.${value}` : `states.${value}`}`
    ),
  }))
  const sortOptions = sorts.map((value) => ({
    value,
    label: t(`environmentAdmin.sorts.${value}`),
  }))
  const result = useEnvironmentData<Page<Environment>>(
    `/api/admin/v1/environments?page=${page}&page_size=20&status=${status}&sort=${sort}${hostID ? `&host_id=${encodeURIComponent(hostID)}` : ""}`,
    true
  )
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
  function filter(key: "status" | "sort", value: string | null) {
    if (!value) return
    setParams((old) => {
      const next = new URLSearchParams(old)
      next.set(key, value)
      next.delete("page")
      return next
    })
  }
  return (
    <EnvironmentFrame
      table
      title={t("environmentAdmin.environmentsTitle")}
      description={t("environmentAdmin.environmentsDescription")}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            items={statusOptions}
            value={status}
            onValueChange={(value) => filter("status", value)}
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
            items={sortOptions}
            value={sort}
            onValueChange={(value) => filter("sort", value)}
          >
            <SelectTrigger
              aria-label={t("environmentAdmin.sortLabel")}
              className="min-w-44"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={result.loading}
            onClick={result.refresh}
          >
            {t("environmentAdmin.refresh")}
          </Button>
        </div>
      }
    >
      {hostID && (
        <div className="flex flex-wrap items-center gap-2 border-b px-[var(--card-spacing)] py-2 text-sm">
          <span className="min-w-0 break-all">
            {t("environmentAdmin.hostFilter", { name: hostName })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setParams((old) => {
                const next = new URLSearchParams(old)
                for (const key of [
                  "host_id",
                  "host_name",
                  "page",
                  "environment",
                ])
                  next.delete(key)
                return next
              })
            }
          >
            {t("environmentAdmin.clearHostFilter")}
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="px-[var(--card-spacing)] text-sm">
          {notice}
        </p>
      )}
      <EnvironmentTable
        title={t("environmentAdmin.environmentsTitle")}
        columns={[
          "name",
          "status",
          "runtimeVersion",
          "resourceUsage",
          "billing.title",
          "user",
          "host",
          "observed",
          "actions",
        ].map((key) => t(`environmentAdmin.${key}`))}
        {...result}
        empty={!result.data?.items.length}
      >
        {result.data?.items.map((env) => (
          <TableRow key={env.id}>
            <TableCell className="min-w-40 ps-[var(--card-spacing)]">
              <Button
                variant="link"
                className="h-auto max-w-60 justify-start whitespace-normal break-all p-0 text-start font-medium"
                onClick={() => select(env.id)}
              >
                {env.name}
              </Button>
            </TableCell>
            <TableCell>
              <EnvironmentStatus environment={env} />
              {env.reason && env.generation === env.observed_generation && (
                <p className="mt-1 max-w-60 whitespace-normal break-words text-xs text-destructive">
                  {t(`environmentAdmin.reasons.${env.reason}`, {
                    defaultValue: env.reason,
                  })}
                </p>
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
              {env.runtime_version || t("environmentAdmin.runtimeUnknown")}
            </TableCell>
            <TableCell>
              <EnvironmentUsage environment={env} compact />
            </TableCell>
            <TableCell>
              <EnvironmentBillingInfo environment={env} compact />
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2.5">
                <UserAvatar src={env.user?.avatar_url} size="default" />
                <div className="min-w-0">
                  <p
                    className="max-w-48 truncate font-medium"
                    title={env.user?.name || env.user_id}
                  >
                    {env.user?.name || env.user?.email || env.user_id}
                  </p>
                  {env.user?.email && (
                    <p
                      className="mt-1 max-w-48 truncate text-xs text-muted-foreground"
                      title={env.user.email}
                    >
                      {env.user.email}
                    </p>
                  )}
                </div>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2.5">
                <OSIcon name={env.host?.os_name} />
                <span
                  className="max-w-48 truncate"
                  title={env.host?.hostname || env.host?.name || env.host_id}
                >
                  {env.host?.hostname || env.host?.name || env.host_id}
                </span>
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {env.observed_at
                ? new Date(env.observed_at).toLocaleString()
                : t("environmentAdmin.notObserved")}
            </TableCell>
            <TableCell className="pe-[var(--card-spacing)]">
              <div className="flex items-center gap-1">
                <ActionButton
                  label={t("environmentAdmin.details")}
                  onClick={() => select(env.id)}
                />
                <ActionButton
                  label={t("environmentAdmin.stop")}
                  disabled={!canStop(env) || busy}
                  onClick={() => request(env, "stopped")}
                />
                <ActionButton
                  label={t("environmentAdmin.targets.deleted")}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={!canDelete(env) || busy}
                  onClick={() => request(env, "deleted")}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </EnvironmentTable>
      <Pagination
        page={page}
        count={result.data?.items.length ?? 0}
        disabled={result.loading || !!result.error || busy}
        onChange={(value) =>
          setParams((old) => {
            const next = new URLSearchParams(old)
            next.set("page", String(value))
            return next
          })
        }
      />
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
    </EnvironmentFrame>
  )
}
function EnvironmentDetail({ id, close }: { id: string; close: () => void }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const path = `/api/admin/v1/environments/${encodeURIComponent(id)}`
  const result = useEnvironmentData<Environment>(path, true)
  const operations = useEnvironmentData<Page<Operation>>(
    `${path}/operations?page=${page}&page_size=20`,
    true
  )
  const env = result.data
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) close()
      }}
    >
      <DialogContent
        className="max-h-[85dvh] w-[calc(100vw_-_2rem)] overflow-y-auto sm:max-w-3xl"
        closeLabel={t("environmentAdmin.close")}
      >
        <DialogHeader>
          <DialogTitle>
            {env?.name || t("environmentAdmin.details")}
          </DialogTitle>
          <DialogDescription>
            {t("environmentAdmin.detailHint")}
          </DialogDescription>
        </DialogHeader>
        <LoadState {...result} empty={false} />
        {env && (
          <div className="space-y-5">
            <section className="space-y-4 rounded-xl bg-muted/40 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <EnvironmentStatus environment={env} />
                <span className="text-sm text-muted-foreground">
                  {t(
                    `environmentAdmin.${env.stale ? "connectionStale" : env.connectable ? "connectionReady" : "connectionUnavailable"}`
                  )}
                </span>
              </div>
              {env.reason && env.generation === env.observed_generation && (
                <p className="text-sm text-destructive">
                  {t(`environmentAdmin.reasons.${env.reason}`, {
                    defaultValue: env.reason,
                  })}
                </p>
              )}
              <dl>
                <Identity
                  label={t("environmentAdmin.runtimeVersion")}
                  value={
                    env.runtime_version || t("environmentAdmin.runtimeUnknown")
                  }
                />
              </dl>
              <div className="grid gap-5 border-t pt-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <p className="mb-2 text-xs text-muted-foreground">
                    {t("environmentAdmin.user")}
                  </p>
                  <div className="flex items-center gap-2.5">
                    <UserAvatar src={env.user?.avatar_url} size="default" />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">
                        {env.user?.name ||
                          env.user?.email ||
                          t("environmentAdmin.unknownUser")}
                      </p>
                      {env.user?.email && (
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          {env.user.email}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="mb-2 text-xs text-muted-foreground">
                    {t("environmentAdmin.host")}
                  </p>
                  <div className="flex items-center gap-2.5">
                    <OSIcon name={env.host?.os_name} />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">
                        {env.host?.hostname ||
                          env.host?.name ||
                          t("environmentAdmin.unknownHost")}
                      </p>
                      {env.host?.os_name && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {env.host.os_name}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
            <EnvironmentBillingInfo environment={env} />
            <section className="space-y-3 rounded-lg border p-4">
              <h3 className="text-sm font-medium">
                {t("environmentAdmin.resourceUsage")}
              </h3>
              <div className="[&_.font-medium]:text-2xl">
                <EnvironmentUsage environment={env} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("environmentAdmin.usageHint")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("environmentAdmin.sampledAt")} ·{" "}
                {env.usage?.at ? new Date(env.usage.at).toLocaleString() : "—"}
              </p>
            </section>
            <Collapsible className="rounded-lg border p-4">
              <CollapsibleTrigger className="group/section flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("environmentAdmin.technicalDetails")}
                <HugeiconsIcon
                  icon={ArrowDown02Icon}
                  aria-hidden="true"
                  className="size-4 group-aria-expanded/section:rotate-180"
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4 space-y-5">
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Identity
                    label={t("environmentAdmin.environmentID")}
                    value={env.id}
                  />
                  <Identity
                    label={t("environmentAdmin.instanceID")}
                    value={env.instance_id}
                  />
                  <Identity
                    label={t("environmentAdmin.user")}
                    value={env.user_id}
                  />
                  <Identity
                    label={t("environmentAdmin.host")}
                    value={env.host_id}
                  />
                  <Identity
                    label={t("environmentAdmin.generation")}
                    value={`${env.observed_generation} / ${env.generation}`}
                  />
                  <Identity
                    label={t("environmentAdmin.fields.tasks")}
                    value={env.spec.resource.host_tasks}
                  />
                  <Identity
                    label={t("environmentAdmin.fields.temporary")}
                    value={env.spec.resource.temporary_bytes / MiB}
                  />
                  <Identity
                    label={t("environmentAdmin.image")}
                    value={env.spec.image}
                  />
                  <Identity
                    label={t("environmentAdmin.network")}
                    value={t(`environmentAdmin.${env.spec.network_policy}`)}
                  />
                </dl>
                <div className="rounded-md border p-3">
                  <h3 className="mb-3 font-medium">
                    {t("environmentAdmin.volumes")}
                  </h3>
                  <ul className="space-y-2">
                    {env.spec.volumes.map((volume) => (
                      <li key={volume.id} className="text-sm">
                        <p>
                          {t(`environmentAdmin.volumeNames.${volume.purpose}`)}
                        </p>
                        <p className="break-all font-mono text-xs text-muted-foreground">
                          {volume.id}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
        <Collapsible className="rounded-lg border p-4">
          <CollapsibleTrigger className="group/section flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("environmentAdmin.operations")}
            <HugeiconsIcon
              icon={ArrowDown02Icon}
              aria-hidden="true"
              className="size-4 group-aria-expanded/section:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            <LoadState {...operations} empty={!operations.data?.items.length} />
            <ol className="divide-y">
              {operations.data?.items.map((op) => (
                <li key={op.id} className="space-y-1 py-3 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <span>
                      #{op.generation} ·{" "}
                      {t(`environmentAdmin.targets.${op.desired}`)}
                    </span>
                    <Badge variant="outline">
                      {t(`environmentAdmin.operationStates.${op.status}`)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(op.created_at).toLocaleString()}
                  </p>
                  {op.reason && (
                    <p className="text-destructive">
                      {t(`environmentAdmin.reasons.${op.reason}`, {
                        defaultValue: op.reason,
                      })}
                    </p>
                  )}
                </li>
              ))}
            </ol>
            <Pagination
              page={page}
              count={operations.data?.items.length ?? 0}
              disabled={operations.loading || !!operations.error}
              onChange={setPage}
            />
          </CollapsibleContent>
        </Collapsible>
      </DialogContent>
    </Dialog>
  )
}
