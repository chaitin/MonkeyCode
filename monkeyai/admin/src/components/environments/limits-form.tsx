import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import { GiB, units, type Capacity, type Quota } from "@/lib/environments"
import { NumberField, FormError } from "./common"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Field, FieldLabel } from "@/components/ui/field"

export function LimitsForm({
  value,
  path,
  onSaved,
  onBusy,
  close,
}: {
  value: Capacity | Quota
  path: string
  onSaved: () => void
  onBusy?: (busy: boolean) => void
  close?: () => void
}) {
  const { t } = useTranslation()
  const host = "enabled" in value
  const [enabled, setEnabled] = useState(host && value.enabled)
  const [values, setValues] = useState({
    cpu: String(value.cpu_millis / 1000),
    memoryGiB: String(value.memory_bytes / GiB),
    storageGiB: String(value.storage_bytes / GiB),
    environments: String(value.max_environments),
    running: "max_running" in value ? String(value.max_running) : "0",
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError("")
    setSuccess(false)
    let body
    try {
      body = {
        cpu_millis: units(values.cpu, 1000),
        memory_bytes: units(values.memoryGiB, GiB),
        storage_bytes: units(values.storageGiB, GiB),
        max_environments: units(values.environments),
        ...(host ? { enabled } : { max_running: units(values.running) }),
      }
      if (!host && units(values.running) > body.max_environments)
        throw new Error()
    } catch {
      setError(t("environmentAdmin.invalidLimits"))
      return
    }
    setBusy(true)
    onBusy?.(true)
    try {
      await api(path, { method: "PUT", body: JSON.stringify(body) })
      setSuccess(true)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      onBusy?.(false)
    }
  }
  const fields = [
    ["cpu", 4096, 0.001],
    ["memoryGiB", 16384, "any"],
    ["storageGiB", 1048576, "any"],
    ["environments", host ? 10000 : 1000, 1],
    ...(!host ? [["running", 1000, 1] as const] : []),
  ] as const
  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={busy} className="space-y-5">
        {host && (
          <Field orientation="horizontal">
            <FieldLabel htmlFor="capacity-enabled">
              {t("environmentAdmin.scheduling")}
            </FieldLabel>
            <Switch
              id="capacity-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(([key, max, step]) => (
            <NumberField
              key={key}
              name={key}
              label={t(`environmentAdmin.fields.${key}`)}
              value={values[key]}
              onChange={(next) => {
                setValues((old) => ({ ...old, [key]: next }))
                setSuccess(false)
              }}
              max={max}
              step={step}
            />
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {t(`environmentAdmin.${host ? "capacityHint" : "quotaHint"}`)}
        </p>
      </fieldset>
      <FormError error={error} />
      {success && (
        <p role="status" className="text-sm">
          {t("environmentAdmin.saved")}
        </p>
      )}
      <div className="flex justify-end gap-3">
        {close && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={close}
          >
            {t("environmentAdmin.cancel")}
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {t(`environmentAdmin.${busy ? "saving" : "save"}`)}
        </Button>
      </div>
    </form>
  )
}
