import { useState } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog"

export type HostUpgradeState = {
  target_version: string
  version_state: "current" | "available" | "ahead" | "unknown"
  update_available: boolean
  supported: boolean
  can_upgrade: boolean
  task: null | {
    id: string
    version: string
    status: "pending" | "running" | "succeeded" | "failed"
    reason: string
    updated_at: string
  }
}

export function HostUpgradeBadge({ value }: { value?: HostUpgradeState }) {
  const { t } = useTranslation()
  if (!value) return null
  const active =
    value.task?.status === "pending" || value.task?.status === "running"
  const state =
    value.task && (active || value.task.version === value.target_version)
      ? value.task.status
      : value.version_state
  return (
    <Badge variant={state === "failed" ? "destructive" : "outline"}>
      {t(`pages.engineHosts.upgrade.states.${state}`)}
    </Badge>
  )
}

export function HostUpgrade({
  host,
  refresh,
}: {
  host: {
    id: string
    name: string
    version: string
    online: boolean
    upgrade?: HostUpgradeState
  }
  refresh: () => void
}) {
  const { t } = useTranslation()
  const text = (key: string, options?: Record<string, string>) =>
    t(`pages.engineHosts.upgrade.${key}`, options)
  const [target, setTarget] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [command, setCommand] = useState("")
  const value = host.upgrade
  if (!value) return null
  const task = value.task
  const running = task?.status === "pending" || task?.status === "running"
  const hint = running
    ? "waiting"
    : !host.online
      ? "offline"
      : !value.supported
        ? "unsupported"
        : value.version_state

  async function upgrade() {
    if (busy || !target) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await api(`/api/admin/v1/engine-hosts/${host.id}/upgrade`, {
        method: "POST",
        body: JSON.stringify({ version: target }),
      })
      setTarget("")
      setNotice(text("submitted"))
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : text("requestFailed"))
      refresh()
    } finally {
      setBusy(false)
    }
  }

  async function loadCommand() {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const result = await api<{ command: string }>(
        "/api/admin/v1/engine-upgrade"
      )
      setCommand(result.command)
    } catch (err) {
      setError(err instanceof Error ? err.message : text("requestFailed"))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
      setNotice(text("copied"))
    } catch {
      setError(text("copyFailed"))
    }
  }

  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border p-4"
      aria-label={text("title")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{text("title")}</h3>
        <HostUpgradeBadge value={value} />
      </div>
      <p className="break-all text-sm">
        {text("versions", {
          current: host.version,
          target: value.target_version || "—",
        })}
      </p>
      <p className="text-sm text-muted-foreground">{text(`hints.${hint}`)}</p>
      {task && (
        <p className="break-words text-xs text-muted-foreground" role="status">
          {text("task", {
            version: task.version,
            status: text(`states.${task.status}`),
          })}
          {" · "}
          {new Date(task.updated_at).toLocaleString()}
          {task.status === "failed" && (
            <span className="mt-1 block">
              {text(`reasons.${task.reason || "upgrade_failed"}`)}
            </span>
          )}
        </p>
      )}
      {notice &&
        (notice !== text("submitted") ||
          !task ||
          task.status === "pending") && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
      {error && !target && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || !value.can_upgrade}
          onClick={() => {
            setTarget(value.target_version)
            setError("")
            setNotice("")
          }}
        >
          {running ? text("states.running") : text("action")}
        </Button>
        {!running && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void loadCommand()}
          >
            {text("manual")}
          </Button>
        )}
      </div>
      {command && (
        <Field>
          <FieldLabel htmlFor={`upgrade-command-${host.id}`}>
            {text("manual")}
          </FieldLabel>
          <Textarea
            id={`upgrade-command-${host.id}`}
            readOnly
            value={command}
            className="min-h-24 w-full resize-none break-all font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button size="sm" variant="outline" onClick={() => void copy()}>
            {text("copy")}
          </Button>
        </Field>
      )}
      <AlertDialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open && !busy) setTarget("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{text("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {text("confirm", {
                name: host.name,
                current: host.version,
                target,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setTarget("")}
            >
              {text("cancel")}
            </Button>
            <Button
              disabled={busy || !value.can_upgrade}
              onClick={() => void upgrade()}
            >
              {busy ? text("submitting") : text("action")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
