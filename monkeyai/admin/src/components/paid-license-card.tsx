import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import { FileInput } from "@/components/ui/file-input"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type LicenseInfo = {
  state: "missing" | "valid" | "expired" | "invalid"
  product_type?: string
  client_name?: string
  client_id?: string
  custom_product_name?: string
  machine_ids?: string[]
  max_members?: number
  not_valid_before?: number
  not_valid_after?: number
}

type MachineCodeResponse = {
  machine_code: string
}

function formatDate(value: number | undefined, locale: string) {
  if (value == null) return "—"
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(value * 1000)
  )
  return locale.startsWith("zh")
    ? date.replace(/(\d)([年月日])/g, "$1 $2").replace(/([年月])(\d)/g, "$1 $2")
    : date
}

export function PaidLicenseCard({ className }: { className?: string }) {
  const { i18n, t } = useTranslation()
  const { showToast } = useAppToast()
  const [info, setInfo] = useState<LicenseInfo | null>(null)
  const [machineCode, setMachineCode] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [importOpen, setImportOpen] = useState(false)
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
    const formElement = event.currentTarget

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
      formElement.reset()
      setImportOpen(false)
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

  const unavailable = info?.state === "invalid"
  const expired = info?.state === "expired"
  const dangerClassName = "text-red-600 dark:text-red-400"

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t("pages.license.title")}</CardTitle>
        <CardDescription>{t("pages.license.description")}</CardDescription>
        <CardAction className="flex items-center gap-2">
          <Button
            render={
              <a
                href="https://baizhi.cloud/consult"
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            variant="outline"
          >
            {t("pages.license.applyForTrial")}
          </Button>
          <Dialog
            open={importOpen}
            onOpenChange={(open) => {
              if (importing && !open) return
              setImportOpen(open)
              if (!open) setFile(null)
            }}
          >
            <DialogTrigger render={<Button type="button" />}>
              {t("pages.license.importAuthorization")}
            </DialogTrigger>
            <DialogContent closeLabel={t("common.close")}>
              <DialogHeader>
                <DialogTitle>{t("pages.license.importTitle")}</DialogTitle>
              </DialogHeader>
              <form
                className="flex min-w-0 flex-col gap-6"
                onSubmit={importLicense}
              >
                <FileInput
                  accept=".lic,application/octet-stream,text/plain"
                  chooseLabel={t("pages.license.chooseFile")}
                  file={file}
                  onChange={setFile}
                />
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={!file || importing}
                    aria-busy={importing}
                  >
                    {importing && (
                      <HugeiconsIcon
                        icon={Loading03Icon}
                        className="animate-spin motion-reduce:animate-none"
                        data-icon="inline-start"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    )}
                    {t("pages.license.import")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardAction>
      </CardHeader>
      <CardContent className="gap-6">
        {loading && (
          <p className="text-sm text-muted-foreground">
            {t("pages.license.loading")}
          </p>
        )}
        <ItemGroup>
          {info !== null && info.state !== "missing" && (
            <>
              <Item variant="outline">
                <ItemContent>
                  <ItemTitle>{t("pages.license.seats")}</ItemTitle>
                  <ItemDescription
                    className={cn(unavailable && dangerClassName)}
                  >
                    {unavailable
                      ? t("pages.license.unavailable")
                      : info.max_members == null
                        ? "—"
                        : t("pages.license.seatsAllowed", {
                            count: info.max_members,
                          })}
                  </ItemDescription>
                </ItemContent>
              </Item>
              <Item variant="outline">
                <ItemContent className="min-w-0">
                  <ItemTitle>{t("pages.license.client")}</ItemTitle>
                  <ItemDescription
                    className={cn(
                      "line-clamp-none break-all",
                      unavailable && dangerClassName
                    )}
                  >
                    {unavailable
                      ? t("pages.license.unavailable")
                      : info.client_name || info.client_id || "—"}
                  </ItemDescription>
                </ItemContent>
              </Item>
              <Item variant="outline">
                <ItemContent>
                  <ItemTitle>{t("pages.license.validityPeriod")}</ItemTitle>
                  <ItemDescription
                    className={cn(
                      "line-clamp-none",
                      (unavailable || expired) && dangerClassName
                    )}
                  >
                    {unavailable
                      ? t("pages.license.unavailable")
                      : `${formatDate(info.not_valid_before, i18n.language)} - ${formatDate(info.not_valid_after, i18n.language)}`}
                  </ItemDescription>
                </ItemContent>
              </Item>
            </>
          )}
          <Item variant="outline">
            <ItemContent className="min-w-0">
              <ItemTitle>{t("pages.license.machineTitle")}</ItemTitle>
              <ItemDescription className="line-clamp-none font-mono break-all">
                <bdi dir="ltr">{machineCode || "—"}</bdi>
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void copyMachineCode()}
                disabled={!machineCode}
              >
                {t("pages.license.copy")}
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </CardContent>
    </Card>
  )
}
