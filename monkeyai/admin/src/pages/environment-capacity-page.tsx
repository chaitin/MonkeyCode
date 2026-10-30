import { useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  GiB,
  hostSyncFresh,
  type HostCapacity,
  type Page,
} from "@/lib/environments"
import { CONSOLE_ROUTES } from "@/lib/routes"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import {
  EnvironmentFrame,
  LoadState,
  Pagination,
  Identity,
} from "@/components/environments/common"
import { LimitsForm } from "@/components/environments/limits-form"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

export function EnvironmentCapacityPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const result = useEnvironmentData<Page<HostCapacity>>(
    `/api/admin/v1/environment-hosts?page=${page}&page_size=20`,
    true
  )
  const [selected, setSelected] = useState<HostCapacity | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <EnvironmentFrame
      title={t("environmentAdmin.capacityTitle")}
      description={t("environmentAdmin.capacityDescription")}
      action={
        <Button
          variant="outline"
          render={<Link to={CONSOLE_ROUTES.engineHosts} />}
        >
          {t("environmentAdmin.installHosts")}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {t("environmentAdmin.capacityStage")}
      </p>
      <LoadState {...result} empty={!result.data?.items.length} />
      <ul className="divide-y">
        {result.data?.items.map((host) => (
          <li key={host.host_id} className="space-y-3 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <p className="break-all font-mono text-sm">{host.host_id}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{host.architecture}</Badge>
                  <Badge variant="secondary">
                    {t(
                      `environmentAdmin.${host.enabled ? "scheduleEnabled" : "scheduleDisabled"}`
                    )}
                  </Badge>
                  <Badge variant="outline">
                    {t(
                      `environmentAdmin.${host.status === "revoked" ? "revoked" : hostSyncFresh(host) ? "syncFresh" : "syncStale"}`
                    )}
                  </Badge>
                </div>
              </div>
              <Button
                variant="outline"
                disabled={host.status !== "active"}
                onClick={() => setSelected(host)}
              >
                {t("environmentAdmin.configure")}
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Identity
                label={t("environmentAdmin.fields.cpu")}
                value={host.cpu_millis / 1000}
              />
              <Identity
                label={t("environmentAdmin.fields.memoryGiB")}
                value={host.memory_bytes / GiB}
              />
              <Identity
                label={t("environmentAdmin.fields.storageGiB")}
                value={host.storage_bytes / GiB}
              />
              <Identity
                label={t("environmentAdmin.fields.environments")}
                value={host.max_environments}
              />
            </dl>
            <p className="text-xs text-muted-foreground">
              {t("environmentAdmin.lastSync")}：
              {host.sync_at ? new Date(host.sync_at).toLocaleString() : "—"}
            </p>
          </li>
        ))}
      </ul>
      <Pagination
        page={page}
        count={result.data?.items.length ?? 0}
        disabled={result.loading || !!result.error}
        onChange={setPage}
      />
      <Dialog
        open={!!selected}
        onOpenChange={(value) => {
          if (!value && !busy) setSelected(null)
        }}
      >
        <DialogContent
          className="max-h-[85dvh] w-[calc(100vw_-_2rem)] overflow-y-auto sm:max-w-xl"
          closeLabel={t("environmentAdmin.close")}
        >
          <DialogHeader>
            <DialogTitle>{t("environmentAdmin.configureCapacity")}</DialogTitle>
            <DialogDescription className="break-all">
              {selected?.host_id}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <LimitsForm
              key={selected.host_id}
              value={selected}
              path={`/api/admin/v1/environment-hosts/${selected.host_id}`}
              onBusy={setBusy}
              close={() => setSelected(null)}
              onSaved={() => {
                setSelected(null)
                result.refresh()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </EnvironmentFrame>
  )
}
