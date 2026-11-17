import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/hooks/use-auth"
import { useAppToast } from "@/components/animated-toast-provider"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  type HostCommand as Command,
  rememberCommand,
} from "@/lib/host-command"

export function HostCommand({
  host,
  refresh,
  onRenewed,
}: {
  host: { id: string }
  refresh: () => void
  onRenewed: (value: Command) => void
}) {
  const { user } = useAuth()
  const { t, i18n } = useTranslation()
  const { showToast } = useAppToast()
  const text = (key: string, options?: Record<string, string>) =>
    t(`pages.engineHosts.${key}`, options)
  const [open, setOpen] = useState(false)
  const [command, setCommand] = useState<Command | null>(null)
  const [now, setNow] = useState(Date.now)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const expired = command !== null && Date.parse(command.expires_at) <= now
  const current = command !== null && command.host_id === host.id

  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open])

  async function renew() {
    if (busy) return
    setOpen(true)
    setBusy(true)
    setError("")
    setCommand(null)
    try {
      const value = await api<Command>(
        `/api/admin/v1/engine-hosts/${host.id}/enrollment`,
        { method: "POST", body: "{}" }
      )
      rememberCommand(user?.id ?? "", value)
      setCommand(value)
      setNow(Date.now())
      onRenewed(value)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : text("createFailed"))
      refresh()
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!command || expired || !current) return
    try {
      await navigator.clipboard.writeText(command.command)
      setError("")
      showToast({ status: "success", title: text("copied") })
    } catch {
      setError(text("copyFailed"))
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        loading={busy}
        disabled={busy}
        onClick={() => void renew()}
      >
        {text("renew")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
          closeLabel={text("close")}
        >
          <DialogHeader>
            <DialogTitle>{text("command")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{t("pages.engineHosts.upgrade.manualHint")}</p>
          {busy && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("resources.loading")}
            </p>
          )}
          {command && current && !expired && (
            <pre
              aria-label={text("command")}
              className="max-h-64 select-text overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-4 font-mono text-xs"
            >
              <code>{command.command}</code>
            </pre>
          )}
          {expired && (
            <p role="status" className="text-sm text-muted-foreground">
              {text("commandExpired")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="items-center sm:justify-between">
            {command && current && (
              <p className="text-xs text-muted-foreground">
                {text("availableUntil", {
                  time: new Date(command.expires_at).toLocaleString(
                    i18n.resolvedLanguage ?? i18n.language,
                    {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }
                  ),
                })}
              </p>
            )}
            <div className="ms-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !command || !current || expired}
                onClick={() => void copy()}
              >
                {text("copy")}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => setOpen(false)}>
                {text("close")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
