import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { api, ApiError } from "@/lib/api"

type LicenseStatus = {
  state: "missing" | "valid" | "expired" | "invalid"
  not_valid_after?: number
  free_member_limit?: number
  current_members?: number
  can_downgrade?: boolean
}

export function LicenseGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const [info, setInfo] = useState<LicenseStatus | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const revision = useRef(0)

  const load = useCallback(async () => {
    const request = ++revision.current
    try {
      const next = await api<LicenseStatus>("/api/admin/v1/license/status", {
        signal: AbortSignal.timeout(15_000),
      })
      if (request !== revision.current) return
      setInfo(next)
      setError("")
    } catch (reason) {
      if (request !== revision.current) return
      // 开源版不提供私有授权接口。
      if (reason instanceof ApiError && reason.status === 404) {
        setUnsupported(true)
      } else {
        setError((reason as Error).message)
      }
    }
  }, [])

  useEffect(() => {
    if (unsupported) return
    const timer = window.setTimeout(() => void load(), 0)
    const interval = window.setInterval(() => void load(), 30_000)
    const refresh = () => void load()
    window.addEventListener("focus", refresh)
    window.addEventListener("monkeyai-license-changed", refresh)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("monkeyai-license-changed", refresh)
    }
  }, [load, unsupported])

  useEffect(() => {
    if (info?.state !== "valid" || !info.not_valid_after) return
    const deadline = (info.not_valid_after + 1) * 1000
    const timer = window.setTimeout(
      () => {
        if (Date.now() >= deadline) {
          setInfo((current) =>
            current?.state === "valid" &&
            current.not_valid_after === info.not_valid_after
              ? { ...current, state: "expired", can_downgrade: false }
              : current
          )
        }
        void load()
      },
      Math.min(Math.max(deadline - Date.now(), 0), 2_147_483_647)
    )
    return () => window.clearTimeout(timer)
  }, [info, load])

  async function downgrade() {
    setBusy(true)
    setError("")
    try {
      const next = await api<LicenseStatus>("/api/admin/v1/license/downgrade", {
        method: "POST",
      })
      revision.current++
      setInfo(next)
      showToast({
        status: "success",
        title: t("pages.license.downgradeSuccess"),
      })
    } catch (reason) {
      await load()
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function upload(file: File) {
    setBusy(true)
    setError("")
    try {
      const form = new FormData()
      form.append("file", file)
      const next = await api<LicenseStatus>("/api/admin/v1/license/import", {
        method: "POST",
        body: form,
      })
      revision.current++
      setInfo(next)
      showToast({ status: "success", title: t("pages.license.importSuccess") })
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  if (unsupported) return children

  if (info?.state !== "expired") {
    if (info && !error) return children
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background p-6 text-sm text-muted-foreground">
        <p role={error ? "alert" : "status"}>
          {error || t("pages.license.loading")}
        </p>
        {error && (
          <Button onClick={() => void load()}>
            {t("pages.license.retry")}
          </Button>
        )}
      </main>
    )
  }

  const overLimit =
    info.current_members != null &&
    info.current_members > (info.free_member_limit ?? 10)

  return (
    <main className="min-h-svh bg-background">
      <Dialog open disablePointerDismissal onOpenChange={() => {}}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100svh-2rem)] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{t("pages.license.expiredTitle")}</DialogTitle>
            <DialogDescription>
              {t("pages.license.expiredDescription")}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("pages.license.freeLimit", {
              count: info.free_member_limit ?? 10,
            })}
          </p>
          {overLimit ? (
            <p role="alert" className="text-sm text-destructive">
              {t("pages.license.downgradeBlocked", {
                count: info.current_members,
                limit: info.free_member_limit ?? 10,
              })}
            </p>
          ) : info.current_members == null ? (
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p>{t("pages.license.memberCountUnavailable")}</p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void load()}
              >
                {t("pages.license.retry")}
              </Button>
            </div>
          ) : null}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Input
            ref={fileInput}
            type="file"
            accept=".lic,application/octet-stream,text/plain"
            className="sr-only"
            tabIndex={-1}
            aria-label={t("pages.license.uploadNew")}
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void upload(file)
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy || !info.can_downgrade}
              onClick={() => void downgrade()}
            >
              {t("pages.license.downgrade")}
            </Button>
            <Button
              disabled={busy}
              aria-busy={busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy
                ? t("pages.license.processing")
                : t("pages.license.uploadNew")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
