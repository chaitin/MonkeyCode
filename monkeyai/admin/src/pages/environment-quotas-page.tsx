import { useState } from "react"
import { useTranslation } from "react-i18next"
import { BillingUserSearch } from "@/components/billing/user-search"
import { EnvironmentFrame, LoadState } from "@/components/environments/common"
import { LimitsForm } from "@/components/environments/limits-form"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import type { Quota } from "@/lib/environments"

export function EnvironmentQuotasPage() {
  const { t } = useTranslation()
  const [selection, setSelection] = useState({ userID: "", query: "" })
  const [busy, setBusy] = useState(false)
  const result = useEnvironmentData<Quota>(
    selection.userID
      ? `/api/admin/v1/environment-quotas/${selection.userID}`
      : null
  )
  return (
    <EnvironmentFrame
      title={t("environmentAdmin.quotasTitle")}
      description={t("environmentAdmin.quotasDescription")}
    >
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
      {!selection.userID ? (
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
                key={selection.userID}
                value={result.data}
                path={`/api/admin/v1/environment-quotas/${selection.userID}`}
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
