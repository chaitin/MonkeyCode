import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import { useAppToast } from "@/components/animated-toast-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
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
  dialog = false,
}: {
  host: {
    id: string
    name: string
    version: string
    online: boolean
    upgrade?: HostUpgradeState
  }
  refresh: () => void
  dialog?: boolean
}) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const text = (key: string, options?: Record<string, string>) =>
    t(`pages.engineHosts.upgrade.${key}`, options)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const commandId = useId()
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
    if (dialog) {
      setCommandOpen(true)
      setCommand("")
      setNotice("")
    }
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

  function closeCommand() {
    if (busy) return
    setCommandOpen(false)
    setError("")
    setNotice("")
  }

  async function copy() {
    setError("")
    setNotice("")
    try {
      await navigator.clipboard.writeText(command)
      showToast({ status: "success", title: text("copied") })
    } catch {
      setError(text("copyFailed"))
    }
  }

  const actions = (
    <>
      <Button
        size="sm"
        variant={dialog ? "outline" : "default"}
        disabled={busy || !value.can_upgrade}
        onClick={() => {
          setTarget(value.target_version)
          setError("")
          setNotice("")
        }}
      >
        {running
          ? text("states.running")
          : text(dialog ? "automatic" : "action")}
      </Button>
      {!running && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void loadCommand()}
        >
          {text(dialog ? "manualUpgrade" : "manual")}
        </Button>
      )}
    </>
  )

  const content = (
    <section
      className={
        dialog ? "min-w-0 space-y-3" : "min-w-0 space-y-3 rounded-lg border p-4"
      }
      aria-label={text("title")}
    >
      {!dialog && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{text("title")}</h3>
          <HostUpgradeBadge value={value} />
        </div>
      )}
      <p className="break-all text-sm">
        {text("versions", {
          current: host.version,
          target: value.target_version || "—",
        })}
      </p>
      {!dialog && (
        <p className="text-sm text-muted-foreground">{text(`hints.${hint}`)}</p>
      )}
      {task?.status === "failed" && (
        <p className="break-words text-xs text-muted-foreground" role="status">
          {text(`reasons.${task.reason || "upgrade_failed"}`)}
        </p>
      )}
      {notice &&
        !commandOpen &&
        (notice !== text("submitted") ||
          !task ||
          task.status === "pending") && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
      {error && !target && !commandOpen && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!dialog && <div className="flex flex-wrap gap-2">{actions}</div>}
      {command && !dialog && (
        <Field>
          <FieldLabel htmlFor={commandId}>{text("manual")}</FieldLabel>
          <Textarea
            id={commandId}
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
        <AlertDialogContent size="sm">
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
              loading={busy}
              disabled={busy || !value.can_upgrade}
              onClick={() => void upgrade()}
            >
              {t("environmentAdmin.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {dialog && (
        <Dialog
          open={commandOpen}
          onOpenChange={(open) => {
            if (!open) closeCommand()
          }}
        >
          <DialogContent
            className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
            closeLabel={text("cancel")}
          >
            <DialogHeader>
              <DialogTitle>{text("manualUpgrade")}</DialogTitle>
            </DialogHeader>
            <p className="text-sm">{text("manualHint")}</p>
            {busy && (
              <p role="status" className="text-sm text-muted-foreground">
                {t("resources.loading")}
              </p>
            )}
            {command && (
              <pre
                aria-label={text("manual")}
                className="max-h-64 select-text overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-4 font-mono text-xs"
              >
                <code>{command}</code>
              </pre>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="text-sm text-muted-foreground">
                {notice}
              </p>
            )}
            <DialogFooter>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !command}
                onClick={() => void copy()}
              >
                {text("copy")}
              </Button>
              <Button
                size="sm"
                variant="default"
                disabled={busy}
                onClick={closeCommand}
              >
                {text("cancel")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
  if (!dialog) return content
  return (
    <>
      {value.update_available && (
        <Button size="xs" variant="default" onClick={() => setDialogOpen(true)}>
          {text("needsUpgrade")}
        </Button>
      )}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!busy) setDialogOpen(open)
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
          closeLabel={text("cancel")}
        >
          <DialogHeader>
            <DialogTitle>{text("upgradeEngine")}</DialogTitle>
          </DialogHeader>
          {content}
          <DialogFooter>
            {actions}
            <Button
              size="sm"
              variant="default"
              disabled={busy}
              onClick={() => setDialogOpen(false)}
            >
              {text("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
