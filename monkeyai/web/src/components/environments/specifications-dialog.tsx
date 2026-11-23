import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons"
import { api, ApiError } from "@/lib/api"
import {
  GiB,
  units,
  type CloudSpecification,
  type SpecificationCatalog,
} from "@/lib/environments"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import { LoadState } from "./common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

export function SpecificationsDialog({
  onSave,
  onClose,
}: {
  onSave: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const result = useEnvironmentData<SpecificationCatalog>(
    "/api/admin/v1/environment-specifications"
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-xl"
        closeLabel={t("environmentAdmin.close")}
      >
        <DialogHeader>
          <DialogTitle>
            {t("environmentAdmin.specifications.title")}
          </DialogTitle>
          <DialogDescription>
            {t("environmentAdmin.specifications.description")}
          </DialogDescription>
        </DialogHeader>
        {result.error ? (
          <Button variant="outline" onClick={result.refresh}>
            {t("environmentAdmin.retry")}
          </Button>
        ) : (
          <LoadState {...result} empty={false} />
        )}
        {result.data && (
          <SpecificationsForm
            key={result.data.revision}
            catalog={result.data}
            onSave={onSave}
            onClose={onClose}
            onBusy={setBusy}
            reload={result.refresh}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SpecificationsForm({
  catalog,
  onSave,
  onClose,
  onBusy,
  reload,
}: {
  catalog: SpecificationCatalog
  onSave: () => void
  onClose: () => void
  onBusy: (busy: boolean) => void
  reload: () => void
}) {
  const { t } = useTranslation()
  const [rows, setRows] = useState(() =>
    catalog.items.map((item) => ({
      id: item.id,
      version: item.version,
      cpu: String(item.cpu_millis / 1000),
      memory: String(item.memory_bytes / GiB),
    }))
  )
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || conflict) return
    setError("")
    let next: CloudSpecification[]
    try {
      next = rows.map((row) => ({
        id: row.id,
        version: row.version,
        cpu_millis: units(row.cpu, 1000),
        memory_bytes: units(row.memory, GiB),
      }))
    } catch {
      setError(t("environmentAdmin.specifications.invalid"))
      return
    }
    if (
      next.some(
        (item) =>
          item.cpu_millis < 100 ||
          item.cpu_millis > 256000 ||
          item.memory_bytes < 0.25 * GiB ||
          item.memory_bytes > 1024 * GiB
      )
    ) {
      setError(t("environmentAdmin.specifications.invalid"))
      return
    }
    if (
      new Set(next.map((item) => item.cpu_millis + ":" + item.memory_bytes))
        .size !== next.length
    ) {
      setError(t("environmentAdmin.specifications.duplicate"))
      return
    }
    if (next.length > 100) {
      setError(t("environmentAdmin.specifications.limit"))
      return
    }
    setBusy(true)
    onBusy(true)
    try {
      await api<SpecificationCatalog>(
        "/api/admin/v1/environment-specifications",
        {
          method: "PUT",
          body: JSON.stringify({ revision: catalog.revision, items: next }),
        }
      )
      onSave()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      if (error instanceof ApiError && error.status === 409) setConflict(true)
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
      <fieldset
        disabled={busy || conflict}
        className="flex min-h-0 flex-col gap-4"
      >
        <ScrollArea className="-me-6 min-h-0 flex-1">
          <div className="space-y-3 pe-6">
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-3 border-b bg-muted/40 px-4 py-3 text-sm font-medium">
                <span>{t("environmentAdmin.specifications.cpu")}</span>
                <span>{t("environmentAdmin.specifications.memory")}</span>
                <span className="sr-only">{t("environmentAdmin.actions")}</span>
              </div>
              {rows.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("environmentAdmin.specifications.empty")}
                </p>
              ) : (
                <ul className="divide-y">
                  {rows.map((row, index) => (
                    <li
                      key={row.id}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-3 px-4 py-3"
                    >
                      <div className="relative min-w-0">
                        <Input
                          className="pe-12 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          type="number"
                          min={0.1}
                          max={256}
                          step="any"
                          required
                          value={row.cpu}
                          aria-label={t(
                            "environmentAdmin.specifications.cpuRow",
                            { index: index + 1 }
                          )}
                          onChange={(event) => {
                            const value = event.target.value
                            setRows((current) =>
                              current.map((item) =>
                                item.id === row.id
                                  ? { ...item, cpu: value }
                                  : item
                              )
                            )
                            setError("")
                          }}
                        />
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-muted-foreground"
                        >
                          {t("environmentAdmin.setupCoreUnit")}
                        </span>
                      </div>
                      <div className="relative min-w-0">
                        <Input
                          className="pe-12 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          type="number"
                          min={0.25}
                          max={1024}
                          step="any"
                          required
                          value={row.memory}
                          aria-label={t(
                            "environmentAdmin.specifications.memoryRow",
                            { index: index + 1 }
                          )}
                          onChange={(event) => {
                            const value = event.target.value
                            setRows((current) =>
                              current.map((item) =>
                                item.id === row.id
                                  ? { ...item, memory: value }
                                  : item
                              )
                            )
                            setError("")
                          }}
                        />
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-muted-foreground"
                        >
                          GB
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={t(
                          "environmentAdmin.specifications.removeRow",
                          { index: index + 1 }
                        )}
                        onClick={() => {
                          setRows((current) =>
                            current.filter((item) => item.id !== row.id)
                          )
                          setError("")
                        }}
                      >
                        <HugeiconsIcon
                          icon={Delete02Icon}
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        </ScrollArea>
        <DialogFooter className="shrink-0 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={rows.length >= 100}
            onClick={() => {
              setRows((current) => [
                ...current,
                { id: crypto.randomUUID(), version: 0, cpu: "", memory: "" },
              ])
              setError("")
            }}
          >
            <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
            {t("environmentAdmin.specifications.add")}
          </Button>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("environmentAdmin.cancel")}
            </Button>
            <Button type="submit" loading={busy}>
              {t("environmentAdmin.save")}
            </Button>
          </div>
        </DialogFooter>
      </fieldset>
      {conflict && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("environmentAdmin.cancel")}
          </Button>
          <Button type="button" onClick={reload}>
            {t("environmentAdmin.specifications.reload")}
          </Button>
        </div>
      )}
    </form>
  )
}
