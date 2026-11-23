import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useCapabilities } from "@/hooks/use-capabilities"
import { EngineHostsPage } from "./engine-hosts-page"
import { EnvironmentsPage } from "./environments-page"

export function CloudHostsPage() {
  const [revision, setRevision] = useState(0)
  const { t } = useTranslation()
  const capabilities = useCapabilities()
  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col gap-4 p-4 pt-px">
      {capabilities && !capabilities.allow_cloud_computer && (
        <p
          className="rounded-lg border p-4 text-sm text-muted-foreground"
          role="status"
        >
          {t("licenseCapabilities.cloudLocked")}
        </p>
      )}
      <EngineHostsPage onHostSaved={() => setRevision((v) => v + 1)} />
      <EnvironmentsPage hostRevision={revision} />
    </div>
  )
}
