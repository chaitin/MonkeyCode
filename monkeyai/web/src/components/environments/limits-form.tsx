import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import { type Capacity } from "@/lib/environments"
import { FormError } from "./common"
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
  value: Capacity
  path: string
  onSaved: () => void
  onBusy?: (busy: boolean) => void
  close?: () => void
}) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(value.enabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError("")
    setSuccess(false)
    const body = { enabled }
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
