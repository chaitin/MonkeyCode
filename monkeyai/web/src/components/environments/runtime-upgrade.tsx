import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { FormError, Identity, LoadState } from "./common"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import { api, ApiError } from "@/lib/api"
import type { Environment, Operation } from "@/lib/environments"

type RuntimeInfo = {
  current_version: string
  latest_version: string
  can_update: boolean
  update_available: boolean
  reason?: string
  operation?: Operation
}

export function RuntimeUpgrade({
  environment,
  refreshOperations,
}: {
  environment: Environment
  refreshOperations: () => void
}) {
  const { t } = useTranslation()
  const path = `/api/admin/v1/environments/${environment.id}/runtime`
  const runtime = useEnvironmentData<RuntimeInfo>(path, true)
  const info = runtime.data
  const [request, setRequest] = useState<{
    version: string
    generation: number
    request_key: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const available =
    info?.can_update &&
    (info.update_available || !info.current_version) &&
    !!info.latest_version
  const canConfirm =
    available &&
    request?.version === info.latest_version &&
    request?.generation === environment.generation
  async function submit() {
    if (!request || busy || !canConfirm) return
    setBusy(true)
    setError("")
    try {
      await api(path + "/upgrade", {
        method: "POST",
        body: JSON.stringify(request),
      })
      setRequest(null)
      refreshOperations()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      if (err instanceof ApiError && (err.status === 409 || err.status === 404))
        setRequest(null)
    } finally {
      setBusy(false)
      runtime.refresh()
    }
  }
  return (
    <div className="space-y-2 text-sm">
      <dl className="grid gap-2 sm:grid-cols-2">
        <Identity
          label={t("environmentAdmin.runtimeVersion")}
          value={
            (info ? info.current_version : environment.runtime_version) ||
            t("environmentAdmin.runtimeUnknown")
          }
        />
        {info?.latest_version && (
          <Identity
            label={t("environmentAdmin.serverRuntime")}
            value={info.latest_version}
          />
        )}
      </dl>
      <LoadState {...runtime} empty={false} />
      {info?.operation && (
        <p role="status">
          {t("environmentAdmin.upgradeRuntime")} ·{" "}
          {info.operation.target_version} ·{" "}
          {t(`environmentAdmin.operationStates.${info.operation.status}`)}
        </p>
      )}
      {info && !available && (
        <p className="text-muted-foreground">
          {info.reason || t("environmentAdmin.noRuntimeUpdate")}
        </p>
      )}
      {request ? (
        <div className="space-y-2">
          <p>
            {t("environmentAdmin.confirmRuntime", { version: request.version })}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setRequest(null)}
            >
              {t("environmentAdmin.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={busy || !canConfirm}
              onClick={() => void submit()}
            >
              {t(
                busy
                  ? "environmentAdmin.submitting"
                  : "environmentAdmin.confirm"
              )}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={!available}
          onClick={() => {
            if (!available) return
            setError("")
            setRequest({
              version: info.latest_version,
              generation: environment.generation,
              request_key: crypto.randomUUID(),
            })
          }}
        >
          {t("environmentAdmin.upgradeRuntime")}
        </Button>
      )}
      <FormError error={error} />
    </div>
  )
}
