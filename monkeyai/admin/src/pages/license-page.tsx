import { useCallback, useEffect, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import { FileInput } from "@/components/ui/file-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { api } from "@/lib/api"

type LicenseInfo = {
  state: "missing" | "valid" | "expired" | "invalid"
  product_type?: string
  client_name?: string
  client_id?: string
  license_id?: string
  custom_product_name?: string
  machine_ids?: string[]
  max_members?: number
  not_valid_before?: number
  not_valid_after?: number
}

type MachineCodeResponse = {
  machine_code: string
}

function formatTimestamp(value: number | undefined, locale: string) {
  if (!value) return "—"
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value * 1000))
}

export function LicensePage() {
  const { i18n, t } = useTranslation()
  const { showToast } = useAppToast()
  const [info, setInfo] = useState<LicenseInfo | null>(null)
  const [machineCode, setMachineCode] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [status, machine] = await Promise.all([
        api<LicenseInfo>("/api/admin/v1/license/status"),
        api<MachineCodeResponse>("/api/admin/v1/license/machine-code"),
      ])
      setInfo(status)
      setMachineCode(machine.machine_code)
    } catch (error) {
      showToast({ status: "error", title: (error as Error).message })
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function importLicense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) return

    setImporting(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const next = await api<LicenseInfo>("/api/admin/v1/license/import", {
        method: "POST",
        body: form,
      })
      setInfo(next)
      setFile(null)
      event.currentTarget.reset()
      showToast({
        status: "success",
        title: t("pages.license.importSuccess"),
      })
    } catch (error) {
      showToast({ status: "error", title: (error as Error).message })
    } finally {
      setImporting(false)
    }
  }

  async function copyMachineCode() {
    try {
      await navigator.clipboard.writeText(machineCode)
      showToast({
        status: "success",
        title: t("pages.license.machineCodeCopied"),
      })
    } catch {
      showToast({
        status: "error",
        title: t("pages.license.copyFailed"),
      })
    }
  }

  const stateLabel = info
    ? t(`pages.license.states.${info.state}`)
    : t("pages.license.loading")

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <Card>
        <CardHeader>
          <CardTitle>{t("pages.license.title")}</CardTitle>
          <CardDescription>{t("pages.license.description")}</CardDescription>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => void load()}
            disabled={loading}
          >
            {t("pages.license.refresh")}
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("pages.license.loading")}
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("pages.license.status")}
                </p>
                <Badge className="mt-2" variant={info?.state === "valid" ? "default" : "secondary"}>
                  {stateLabel}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("pages.license.seats")}
                </p>
                <p className="mt-2 font-medium">{info?.max_members ?? "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("pages.license.client")}
                </p>
                <p className="mt-2 font-medium">{info?.client_name || info?.client_id || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("pages.license.licenseId")}
                </p>
                <p className="mt-2 break-all font-mono text-sm">{info?.license_id || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("pages.license.validFrom")}
                </p>
                <p className="mt-2 font-medium">
                  {formatTimestamp(info?.not_valid_before, i18n.language)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("pages.license.validUntil")}
                </p>
                <p className="mt-2 font-medium">
                  {formatTimestamp(info?.not_valid_after, i18n.language)}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("pages.license.machineTitle")}</CardTitle>
          <CardDescription>{t("pages.license.machineDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor="license-machine-code">
              {t("pages.license.machineCode")}
            </FieldLabel>
            <div className="rounded-md border bg-muted/30 px-3 py-2 font-mono text-sm break-all">
              {machineCode || "—"}
            </div>
            <FieldDescription>{t("pages.license.machineHint")}</FieldDescription>
          </Field>
          <Button type="button" variant="outline" onClick={() => void copyMachineCode()} disabled={!machineCode}>
            {t("pages.license.copy")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("pages.license.importTitle")}</CardTitle>
          <CardDescription>{t("pages.license.importDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={importLicense}>
            <Field className="min-w-0 flex-1">
              <FieldLabel>{t("pages.license.file")}</FieldLabel>
              <FileInput
                accept=".lic,application/octet-stream,text/plain"
                chooseLabel={t("pages.license.chooseFile")}
                file={file}
                onChange={setFile}
              />
            </Field>
            <Button type="submit" disabled={!file || importing}>
              {importing ? t("pages.license.importing") : t("pages.license.import")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  )
}
