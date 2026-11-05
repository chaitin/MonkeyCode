import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldLabel } from "@/components/ui/field"

import {
  type HostCommand as Command,
  readCommand,
  rememberCommand,
} from "@/lib/host-command"

export function HostCommand({
  host,
  refresh,
}: {
  host: { id: string; enrollment_expires_at: string }
  refresh: () => void
}) {
  const { user } = useAuth()
  const { t } = useTranslation()
  const text = (key: string) => t(`pages.engineHosts.${key}`)
  const [command, setCommand] = useState(() =>
    readCommand(user?.id ?? "", host.id)
  )
  const [now, setNow] = useState(Date.now)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const expired = command !== null && Date.parse(command.expires_at) <= now
  const current =
    command !== null &&
    Date.parse(command.expires_at) >= Date.parse(host.enrollment_expires_at)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  async function renew() {
    if (busy) return
    setBusy(true)
    setError("")
    setCopied(false)
    try {
      const value = await api<Command>(
        `/api/admin/v1/engine-hosts/${host.id}/enrollment`,
        { method: "POST", body: "{}" }
      )
      rememberCommand(user?.id ?? "", value)
      setCommand(value)
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
      setCopied(true)
      setError("")
    } catch {
      setError(text("copyFailed"))
    }
  }

  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border p-4"
      aria-label={text("command")}
    >
      <Field>
        <FieldLabel htmlFor="pending-host-command">
          {text("command")}
        </FieldLabel>
        {command && current && !expired ? (
          <>
            <p className="text-xs text-muted-foreground">
              {text("expires")}：{new Date(command.expires_at).toLocaleString()}
            </p>
            <Textarea
              id="pending-host-command"
              readOnly
              value={command.command}
              className="min-h-28 w-full min-w-0 resize-none break-all font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            {text(expired ? "commandExpired" : "commandMissing")}
          </p>
        )}
      </Field>
      <p className="text-xs text-muted-foreground">{text("renewHint")}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void renew()}>
          {text(busy ? "creating" : "renew")}
        </Button>
        {command && current && !expired && (
          <Button disabled={busy} onClick={() => void copy()}>
            {text(copied ? "copied" : "copy")}
          </Button>
        )}
      </div>
    </section>
  )
}
