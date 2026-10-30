import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { api, ApiError } from "@/lib/api"
import {
  GiB,
  MiB,
  environmentState,
  canStop,
  canDelete,
  type Environment,
  type Operation,
  type Page,
} from "@/lib/environments"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import {
  EnvironmentFrame,
  LoadState,
  Pagination,
  Identity,
  FormError,
} from "@/components/environments/common"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

type Action = {
  environment: Environment
  desired: "stopped" | "deleted"
  key: string
}
export function EnvironmentsPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const page = Math.max(
    1,
    Math.min(100000, Number.parseInt(params.get("page") || "1", 10) || 1)
  )
  const selected = params.get("environment")
  const result = useEnvironmentData<Page<Environment>>(
    `/api/admin/v1/environments?page=${page}&page_size=20`,
    true
  )
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState("")
  function request(environment: Environment, desired: Action["desired"]) {
    setError("")
    setConflict(false)
    setNotice("")
    setAction({ environment, desired, key: crypto.randomUUID() })
  }
  async function submit() {
    if (!action || busy || conflict) return
    setBusy(true)
    setError("")
    try {
      await api(
        `/api/admin/v1/environments/${action.environment.id}${action.desired === "stopped" ? "/stop" : ""}`,
        {
          method: action.desired === "stopped" ? "POST" : "DELETE",
          body: JSON.stringify({
            generation: action.environment.generation,
            request_key: action.key,
          }),
        }
      )
      setAction(null)
      setNotice(t("environmentAdmin.accepted"))
      result.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
        setConflict(true)
        result.refresh()
      }
    } finally {
      setBusy(false)
    }
  }
  function select(id: string | null) {
    setParams((old) => {
      const next = new URLSearchParams(old)
      if (id) next.set("environment", id)
      else next.delete("environment")
      return next
    })
  }
  return (
    <EnvironmentFrame
      title={t("environmentAdmin.environmentsTitle")}
      description={t("environmentAdmin.environmentsDescription")}
      action={
        <Button
          variant="outline"
          disabled={result.loading}
          onClick={result.refresh}
        >
          {t("environmentAdmin.refresh")}
        </Button>
      }
    >
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <LoadState {...result} empty={!result.data?.items.length} />
      <ul className="divide-y">
        {result.data?.items.map((env) => (
          <li key={env.id} className="space-y-3 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-medium">{env.name}</span>
                  <Badge
                    variant={
                      env.phase === "failed" &&
                      env.generation === env.observed_generation
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {t(`environmentAdmin.states.${environmentState(env)}`)}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {env.spec.resource.cpu_millis / 1000} CPU ·{" "}
                  {env.spec.resource.memory_bytes / GiB} GiB ·{" "}
                  {t("environmentAdmin.retained")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => select(env.id)}>
                  {t("environmentAdmin.details")}
                </Button>
                <Button
                  variant="outline"
                  disabled={!canStop(env) || busy}
                  onClick={() => request(env, "stopped")}
                >
                  {t("environmentAdmin.stop")}
                </Button>
                <Button
                  variant="outline"
                  disabled={!canDelete(env) || busy}
                  onClick={() => request(env, "deleted")}
                >
                  {t(
                    `environmentAdmin.${env.desired === "deleted" ? "retryDelete" : "delete"}`
                  )}
                </Button>
              </div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Identity
                label={t("environmentAdmin.user")}
                value={env.user_id}
              />
              <Identity
                label={t("environmentAdmin.host")}
                value={env.host_id}
              />
            </dl>
            <p className="text-xs text-muted-foreground">
              {t("environmentAdmin.observed")}：
              {env.observed_at
                ? new Date(env.observed_at).toLocaleString()
                : t("environmentAdmin.notObserved")}
            </p>
            {env.reason && env.generation === env.observed_generation && (
              <p className="text-sm text-destructive">
                {t(`environmentAdmin.reasons.${env.reason}`, {
                  defaultValue: env.reason,
                })}
              </p>
            )}
          </li>
        ))}
      </ul>
      <Pagination
        page={page}
        count={result.data?.items.length ?? 0}
        disabled={result.loading || !!result.error || busy}
        onChange={(value) =>
          setParams((old) => {
            const next = new URLSearchParams(old)
            next.set("page", String(value))
            return next
          })
        }
      />
      {selected && (
        <EnvironmentDetail
          key={selected}
          id={selected}
          close={() => select(null)}
        />
      )}
      <Dialog
        open={!!action}
        onOpenChange={(value) => {
          if (!value && !busy) setAction(null)
        }}
      >
        <DialogContent
          className="w-[calc(100vw_-_2rem)]"
          closeLabel={t("environmentAdmin.close")}
        >
          <DialogHeader>
            <DialogTitle>
              {t(
                `environmentAdmin.${action?.desired === "stopped" ? "stop" : "delete"}`
              )}
              ：{action?.environment.name}
            </DialogTitle>
            <DialogDescription>
              {t(
                `environmentAdmin.${action?.desired === "stopped" ? "stopHint" : "deleteHint"}`
              )}
            </DialogDescription>
          </DialogHeader>
          <FormError error={error} />
          {conflict && (
            <p className="text-sm text-muted-foreground">
              {t("environmentAdmin.conflictHint")}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setAction(null)}
            >
              {t(`environmentAdmin.${conflict ? "close" : "cancel"}`)}
            </Button>
            <Button
              variant={
                action?.desired === "deleted" ? "destructive" : "default"
              }
              disabled={busy || conflict}
              onClick={() => void submit()}
            >
              {t(`environmentAdmin.${busy ? "submitting" : "confirm"}`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </EnvironmentFrame>
  )
}
function EnvironmentDetail({ id, close }: { id: string; close: () => void }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const path = `/api/admin/v1/environments/${encodeURIComponent(id)}`
  const result = useEnvironmentData<Environment>(path, true)
  const operations = useEnvironmentData<Page<Operation>>(
    `${path}/operations?page=${page}&page_size=20`,
    true
  )
  const env = result.data
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) close()
      }}
    >
      <DialogContent
        className="max-h-[85dvh] w-[calc(100vw_-_2rem)] overflow-y-auto sm:max-w-3xl"
        closeLabel={t("environmentAdmin.close")}
      >
        <DialogHeader>
          <DialogTitle>
            {env?.name || t("environmentAdmin.details")}
          </DialogTitle>
          <DialogDescription>
            {t("environmentAdmin.detailHint")}
          </DialogDescription>
        </DialogHeader>
        <LoadState {...result} empty={false} />
        {env && (
          <div className="space-y-5">
            <Badge variant="secondary">
              {t(`environmentAdmin.states.${environmentState(env)}`)}
            </Badge>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Identity
                label={t("environmentAdmin.environmentID")}
                value={env.id}
              />
              <Identity
                label={t("environmentAdmin.instanceID")}
                value={env.instance_id}
              />
              <Identity
                label={t("environmentAdmin.user")}
                value={env.user_id}
              />
              <Identity
                label={t("environmentAdmin.host")}
                value={env.host_id}
              />
              <Identity
                label={t("environmentAdmin.generation")}
                value={`${env.observed_generation} / ${env.generation}`}
              />
              <Identity
                label={t("environmentAdmin.computeReserved")}
                value={t(
                  `environmentAdmin.${env.compute_reserved ? "yes" : "no"}`
                )}
              />
              <Identity
                label={t("environmentAdmin.fields.cpu")}
                value={env.spec.resource.cpu_millis / 1000}
              />
              <Identity
                label={t("environmentAdmin.fields.memoryGiB")}
                value={env.spec.resource.memory_bytes / GiB}
              />
              <Identity
                label={t("environmentAdmin.fields.tasks")}
                value={env.spec.resource.host_tasks}
              />
              <Identity
                label={t("environmentAdmin.fields.temporary")}
                value={env.spec.resource.temporary_bytes / MiB}
              />
              <Identity
                label={t("environmentAdmin.image")}
                value={env.spec.image}
              />
              <Identity
                label={t("environmentAdmin.network")}
                value={t(`environmentAdmin.${env.spec.network_policy}`)}
              />
            </dl>
            <div className="rounded-md border p-3">
              <h3 className="mb-3 font-medium">
                {t("environmentAdmin.volumes")}
              </h3>
              <ul className="space-y-2">
                {env.spec.volumes.map((volume) => (
                  <li key={volume.id} className="text-sm">
                    <p>
                      {t(`environmentAdmin.volumeNames.${volume.purpose}`)} ·{" "}
                      {volume.bytes / GiB} GiB · {volume.inodes} inodes
                    </p>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      {volume.id}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <section className="space-y-3">
          <h3 className="font-medium">{t("environmentAdmin.operations")}</h3>
          <LoadState {...operations} empty={!operations.data?.items.length} />
          <ol className="divide-y">
            {operations.data?.items.map((op) => (
              <li key={op.id} className="space-y-1 py-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <span>
                    #{op.generation} ·{" "}
                    {t(`environmentAdmin.targets.${op.desired}`)}
                  </span>
                  <Badge variant="outline">
                    {t(`environmentAdmin.operationStates.${op.status}`)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(op.created_at).toLocaleString()}
                </p>
                {op.reason && (
                  <p className="text-destructive">
                    {t(`environmentAdmin.reasons.${op.reason}`, {
                      defaultValue: op.reason,
                    })}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <Pagination
            page={page}
            count={operations.data?.items.length ?? 0}
            disabled={operations.loading || !!operations.error}
            onChange={setPage}
          />
        </section>
      </DialogContent>
    </Dialog>
  )
}
