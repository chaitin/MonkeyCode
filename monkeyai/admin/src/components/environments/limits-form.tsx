import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import { units, type Capacity, type Quota } from "@/lib/environments"
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
  const [count, setCount] = useState(String(value.max_environments))
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
      const max_environments = units(count)
      if (max_environments > 1000000) throw new Error()
      body = { max_environments, ...(host ? { enabled } : {}) }
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
        <NumberField
          name="environments"
          label={t("environmentAdmin.fields.environments")}
          value={count}
          onChange={(next) => {
            setCount(next)
            setSuccess(false)
          }}
          max={1000000}
          step={1}
        />
        <p className="text-xs text-muted-foreground">
          {t("environmentAdmin.countLimitsHint")}
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
        <Button type="submit" disabled={busy} loading={busy}>
          {t("environmentAdmin.save")}
        </Button>
      </div>
    </form>
  )
}
