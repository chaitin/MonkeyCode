import { useCallback, useEffect, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

type Host = {
  id: string
  name: string
  architecture: string
  version: string
  status: "pending" | "active" | "revoked"
  online: boolean
  enrollment_expires_at: string
  last_seen_at: string | null
  report: {
    prerequisites_met?: boolean
    checks?: { name: string; passed: boolean; detail: string }[]
  }
}
type Enrollment = { host_id: string; command: string; expires_at: string }

export function EngineHostsPage() {
  const { t } = useTranslation()
  const text = (key: string) => t(`pages.engineHosts.${key}`)
  const [hosts, setHosts] = useState<Host[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState("")
  const [formError, setFormError] = useState("")
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [arch, setArch] = useState("amd64")
  const [dataDir, setDataDir] = useState("/var/lib/monkeyai-engine/data")
  const [busy, setBusy] = useState(false)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [revoking, setRevoking] = useState<Host | null>(null)
  const [revokeError, setRevokeError] = useState("")

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await api<{ items: Host[]; total: number }>(
          `/api/admin/v1/engine-hosts?page=${page}&page_size=20`,
          { signal }
        )
        if (signal?.aborted) return
        setHosts(result.items)
        setTotal(result.total)
        setError("")
      } catch (err) {
        if (!signal?.aborted)
          setError(
            err instanceof Error
              ? err.message
              : t("pages.engineHosts.loadFailed")
          )
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [page, t]
  )

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      await refresh(controller.signal)
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000)
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [refresh])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  async function create(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setFormError("")
    setCopied(false)
    try {
      const result = await api<Enrollment>(
        "/api/admin/v1/engine-host-enrollments",
        {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            architecture: arch,
            data_dir: dataDir,
          }),
        }
      )
      setEnrollment(result)
      setPage(1)
      await refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : text("createFailed"))
    } finally {
      setBusy(false)
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
  async function revoke() {
    if (!revoking || busy) return
    setBusy(true)
    setRevokeError("")
    try {
      await api(`/api/admin/v1/engine-hosts/${revoking.id}`, {
        method: "DELETE",
      })
      if (enrollment?.host_id === revoking.id) setEnrollment(null)
      setRevoking(null)
      await refresh()
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : text("revokeFailed"))
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
      setName("")
    }
  }
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <CardTitle>{text("title")}</CardTitle>
            <CardDescription>{text("description")}</CardDescription>
          </div>
          <Button onClick={() => setOpen(true)}>{text("add")}</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{text("stage")}</p>
          {loading ? (
            <p role="status">{text("loading")}</p>
          ) : hosts.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              {text("empty")}
            </p>
          ) : (
            <ul className="divide-y">
              {hosts.map((host) => {
                const status =
                  host.status === "revoked"
                    ? "revoked"
                    : host.status === "pending"
                      ? new Date(host.enrollment_expires_at).getTime() <= now
                        ? "expired"
                        : "pending"
                      : host.online
                        ? "online"
                        : "offline"
                return (
                  <li key={host.id} className="space-y-3 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-all font-medium">
                            {host.name}
                          </span>
                          <Badge variant="secondary">{text(status)}</Badge>
                        </div>
                        <p className="break-all font-mono text-xs text-muted-foreground">
                          {host.id}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {host.architecture} · {host.version}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {text("lastSeen")}：
                          {host.last_seen_at
                            ? new Date(host.last_seen_at).toLocaleString()
                            : "—"}
                        </p>
                      </div>
                      {host.status !== "revoked" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setRevoking(host)
                            setRevokeError("")
                          }}
                        >
                          {text("revoke")}
                        </Button>
                      )}
                    </div>
                    {host.report.checks && (
                      <Collapsible className="rounded-md border p-3 text-sm">
                        <CollapsibleTrigger className="cursor-pointer rounded text-start underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2">
                          {host.report.prerequisites_met
                            ? text("checksPassed")
                            : text("checksFailed")}
                          {!host.online && ` · ${text("lastReport")}`}
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <ul className="mt-3 space-y-2">
                            {host.report.checks.map((check) => (
                              <li key={check.name} className="break-words">
                                <span
                                  className={
                                    check.passed
                                      ? "text-muted-foreground"
                                      : "text-destructive"
                                  }
                                >
                                  {check.passed
                                    ? text("passed")
                                    : text("failed")}{" "}
                                  · {check.name}
                                </span>
                                <p className="mt-1 text-muted-foreground">
                                  {check.detail}
                                </p>
                              </li>
                            ))}
                          </ul>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              {text("total")}：{total}
            </span>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                {text("previous")}
              </Button>
              <span>{page}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={page * 20 >= total}
                onClick={() => setPage(page + 1)}
              >
                {text("next")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{text("add")}</DialogTitle>
            <DialogDescription>
              {enrollment ? text("commandHint") : text("installHint")}
            </DialogDescription>
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
                  className="min-h-40 font-mono text-xs"
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
            <form onSubmit={create} className="space-y-4">
              <Field>
                <FieldLabel htmlFor="engine-name">{text("name")}</FieldLabel>
                <Input
                  id="engine-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={128}
                  required
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel>{text("architecture")}</FieldLabel>
                <RadioGroup
                  aria-label={text("architecture")}
                  value={arch}
                  onValueChange={setArch}
                  className="flex gap-5"
                  disabled={busy}
                >
                  {["amd64", "arm64"].map((value) => (
                    <label key={value} className="flex items-center gap-2">
                      <RadioGroupItem value={value} />
                      {value}
                    </label>
                  ))}
                </RadioGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor="engine-data">{text("dataDir")}</FieldLabel>
                <Input
                  id="engine-data"
                  value={dataDir}
                  onChange={(e) => setDataDir(e.target.value)}
                  required
                  disabled={busy}
                />
                <FieldDescription>{text("dataHint")}</FieldDescription>
              </Field>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => close(false)}
                >
                  {text("cancel")}
                </Button>
                <Button type="submit" disabled={busy || !name.trim()}>
                  {busy ? text("creating") : text("generate")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!revoking}
        onOpenChange={(value) => {
          if (!value && !busy) setRevoking(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {text("revoke")}：{revoking?.name}
            </DialogTitle>
            <DialogDescription>{text("revokeHint")}</DialogDescription>
          </DialogHeader>
          {revokeError && (
            <p role="alert" className="text-sm text-destructive">
              {revokeError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRevoking(null)}
            >
              {text("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void revoke()}
            >
              {text("revoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
