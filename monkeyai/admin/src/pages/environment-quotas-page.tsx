import { useState } from "react"
import { useTranslation } from "react-i18next"
import { BillingUserSearch } from "@/components/billing/user-search"
import { EnvironmentFrame, LoadState } from "@/components/environments/common"
import { LimitsForm } from "@/components/environments/limits-form"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import type { Quota } from "@/lib/environments"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"

export function EnvironmentQuotasPage() {
  const { t } = useTranslation()
  const [hostID, setHostID] = useState("")
  const hosts = useEnvironmentData<{ items: { id: string; name: string }[] }>(
    "/api/admin/v1/engine-hosts?page=1&page_size=100"
  )
  const [selection, setSelection] = useState({ userID: "", query: "" })
  const [busy, setBusy] = useState(false)
  const result = useEnvironmentData<Quota>(
    selection.userID && hostID
      ? `/api/admin/v1/environment-quotas/${selection.userID}?host_id=${hostID}`
      : null
  )
  return (
    <EnvironmentFrame
      title={t("environmentAdmin.quotasTitle")}
      description={t("environmentAdmin.quotasDescription")}
    >
      <div className="space-y-2">
        <label htmlFor="quota-host" className="text-sm font-medium">
          {t("environmentAdmin.host")}
        </label>
        <LoadState {...hosts} empty={false} />
        <Select
          value={hostID || null}
          onValueChange={(value) => {
            if (!busy) setHostID(value ?? "")
          }}
          items={
            hosts.data?.items.map((h) => ({ value: h.id, label: h.name })) ?? []
          }
        >
          <SelectTrigger id="quota-host" disabled={busy}>
            <SelectValue placeholder={t("environmentAdmin.selectHost")} />
          </SelectTrigger>
          <SelectContent>
            {hosts.data?.items.map((h) => (
              <SelectItem key={h.id} value={h.id}>
                {h.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label htmlFor="billing-user" className="text-sm font-medium">
          {t("environmentAdmin.user")}
        </label>
        <fieldset disabled={busy}>
          <BillingUserSearch
            {...selection}
            onChange={(value) => {
              if (!busy) setSelection(value)
            }}
          />
        </fieldset>
      </div>
      {!selection.userID || !hostID ? (
        <p className="py-8 text-sm text-muted-foreground">
          {t("environmentAdmin.selectUser")}
        </p>
      ) : (
        <>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {selection.userID}
          </p>
          <LoadState {...result} empty={false} />
          {result.data && (
            <div className="max-w-2xl">
              <LimitsForm
                key={`${hostID}:${selection.userID}`}
                value={result.data}
                path={`/api/admin/v1/environment-quotas/${selection.userID}?host_id=${hostID}`}
                onBusy={setBusy}
                onSaved={() => {}}
              />
            </div>
          )}
        </>
      )}
    </EnvironmentFrame>
  )
}
