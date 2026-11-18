import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { HugeiconsIcon } from "@hugeicons/react"
import { CpuIcon, UserGroupIcon } from "@hugeicons/core-free-icons"
import { api } from "@/lib/api"
import { GiB, MiB, units, type Resources } from "@/lib/environments"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import { FormError, LoadState } from "./common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  GroupSelect,
  type GroupSelectOption,
  type GroupSelectUser,
} from "@/components/group-select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

type Host = { id: string; name: string }
type HostGrant = {
  user_id?: string | null
  group_id?: string | null
  all_users?: boolean
}
type Subjects = {
  groups: { id: string; name: string; parent_id: string | null }[]
  users: {
    id: string
    name: string
    email: string
    avatar_url?: string
    group_id?: string[] | string
  }[]
}
type Setup = {
  host_id: string
  host_name: string
  grants: HostGrant[]
  max_environments: number
  user_max_environments: number
  resource: Resources | null
  image_ready: boolean
  image_reason?: string
}

export function HostSetupDialog({
  host,
  close,
  saved,
}: {
  host: Host
  close: () => void
  saved: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const subjects = useEnvironmentData<Subjects>(
    "/api/admin/v1/resources/authorization-subjects"
  )
  const result = useEnvironmentData<Setup>(
    `/api/admin/v1/environment-hosts/${host.id}/setup`
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close()
      }}
    >
      <DialogContent
        className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-xl"
        closeLabel={t("environmentAdmin.close")}
      >
        <DialogHeader>
          <DialogTitle>{t("environmentAdmin.setupTitle")}</DialogTitle>
        </DialogHeader>
        <LoadState {...result} empty={false} />
        <LoadState {...subjects} empty={false} />
        {result.data && subjects.data && (
          <SetupForm
            key={host.id}
            host={host}
            value={result.data}
            groups={subjects.data.groups.map((g) => ({
              id: g.id,
              name: g.name,
              parentId: g.parent_id,
            }))}
            users={subjects.data.users.map((u) => ({
              id: u.id,
              name: u.name,
              email: u.email,
              avatarUrl: u.avatar_url,
              groupIds: Array.isArray(u.group_id)
                ? u.group_id
                : u.group_id
                  ? [u.group_id]
                  : [],
            }))}
            close={close}
            saved={saved}
            onBusy={setBusy}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SetupForm({
  host,
  value,
  groups,
  users,
  close,
  saved,
  onBusy,
}: {
  host: Host
  value: Setup
  groups: GroupSelectOption[]
  users: GroupSelectUser[]
  close: () => void
  saved: () => void
  onBusy: (busy: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const resource = value.resource
  const [values, setValues] = useState({
    cpu: String((resource?.cpu_millis ?? 2000) / 1000),
    memory: String((resource?.memory_bytes ?? 4 * GiB) / GiB),
    temporary: String((resource?.temporary_bytes ?? 512 * MiB) / MiB),
    tasks: String(resource?.host_tasks ?? 1024),
    environments: String(value.max_environments || (resource ? 0 : 100)),
    userEnvironments: String(value.user_max_environments),
  })
  const root = groups.find((group) => !group.parentId)?.id
  const [authorization, setAuthorization] = useState(() => ({
    groupIds: value.grants?.length
      ? value.grants.flatMap((g) =>
          g.all_users && root ? [root] : g.group_id ? [g.group_id] : []
        )
      : value.resource === null && root
        ? [root]
        : [],
    userIds: value.grants?.flatMap((g) => (g.user_id ? [g.user_id] : [])) ?? [],
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError("")
    let body
    try {
      const resource = {
        cpu_millis: units(values.cpu, 1000),
        memory_bytes: units(values.memory, GiB),
        temporary_bytes: Math.min(
          units(values.temporary, MiB),
          Math.floor(units(values.memory, GiB) / 2 / 4096) * 4096
        ),
        host_tasks: units(values.tasks),
      }
      const max_environments = units(values.environments)
      const user_max_environments = units(values.userEnvironments)
      if (
        resource.temporary_bytes > resource.memory_bytes / 2 ||
        resource.temporary_bytes % 4096 !== 0 ||
        max_environments > 1000000 ||
        user_max_environments > 1000000
      )
        throw new Error()
      const grants = [
        ...authorization.groupIds.map((group_id) => ({ group_id })),
        ...authorization.userIds.map((user_id) => ({ user_id })),
      ]
      body = {
        resource,
        max_environments,
        user_max_environments,
        grants,
      }
    } catch {
      setError(t("environmentAdmin.setupInvalid"))
      return
    }
    setBusy(true)
    onBusy(true)
    try {
      await api(`/api/admin/v1/environment-hosts/${host.id}/setup`, {
        method: "PUT",
        body: JSON.stringify(body),
      })
      saved()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }

  function number(
    key: keyof typeof values,
    label: string,
    min: number,
    max: number,
    step = 1,
    unit?: string
  ) {
    const id = `setup-${key}`
    return (
      <Field>
        <FieldLabel id={`${id}-label`} htmlFor={id}>
          {t(`environmentAdmin.${label}`)}
        </FieldLabel>
        <div className="relative">
          <Input
            id={id}
            aria-labelledby={`${id}-label`}
            aria-describedby={unit ? `${id}-unit` : undefined}
            className="pe-12 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            type="number"
            required
            min={min}
            max={max}
            step={step === 1 ? 1 : "any"}
            value={values[key]}
            onChange={(event) => {
              const next = event.target.value
              setValues((old) => ({
                ...old,
                [key]: next,
              }))
            }}
          />
          {unit && (
            <span
              id={`${id}-unit`}
              className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground"
            >
              {unit}
            </span>
          )}
        </div>
      </Field>
    )
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 min-w-0 flex-col gap-5">
      <div className="-mx-1 min-h-0 min-w-0 space-y-4 overflow-y-auto overflow-x-hidden px-1">
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <section className="space-y-3" aria-labelledby="setup-access-heading">
            <h3
              id="setup-access-heading"
              className="flex items-center gap-2 text-sm font-medium"
            >
              <HugeiconsIcon
                icon={UserGroupIcon}
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              {t("environmentAdmin.hostAccessTitle")}
            </h3>
            <GroupSelect
              id="setup-host-access"
              options={groups}
              users={users}
              value={authorization}
              onValueChange={(next) =>
                setAuthorization({
                  groupIds: [...next.groupIds],
                  userIds: [...next.userIds],
                })
              }
              label={t("environmentAdmin.hostAccessTitle")}
              placeholder={t("environmentAdmin.hostAccessPlaceholder")}
              emptyText={t("pages.models.noMatchingAuthorization")}
              locale={i18n.language}
              disabled={busy}
              multiple
              selectionMode="both"
              cascadeGroups
              searchable
              searchPlaceholder={t("pages.models.searchAuthorization")}
            />
            <p className="text-xs text-muted-foreground">
              {t("environmentAdmin.hostAccessHint")}
            </p>
          </section>
          <section
            className="space-y-4 border-t pt-5"
            aria-labelledby="setup-resource-heading"
          >
            <div className="space-y-2">
              <h3
                id="setup-resource-heading"
                className="flex items-center gap-2 text-sm font-medium"
              >
                <HugeiconsIcon
                  icon={CpuIcon}
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                {t("environmentAdmin.setupResource")}
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("environmentAdmin.billing.resourceHint")}
              </p>
            </div>
            <div className="grid gap-4">
              {number(
                "cpu",
                "setupCpu",
                0.1,
                256,
                0.1,
                t("environmentAdmin.setupCoreUnit")
              )}
              {number("memory", "setupMemory", 0.25, 1024, 0.25, "GiB")}
            </div>
          </section>
          <section
            className="space-y-4 border-t pt-5"
            aria-labelledby="setup-quota-heading"
          >
            <div className="space-y-2">
              <h3
                id="setup-quota-heading"
                className="flex items-center gap-2 text-sm font-medium"
              >
                <HugeiconsIcon
                  icon={UserGroupIcon}
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                {t("environmentAdmin.countLimitsTitle")}
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("environmentAdmin.countLimitsHint")}
              </p>
            </div>
            <div className="grid gap-4">
              {number(
                "environments",
                "hostMaxEnvironments",
                0,
                1000000,
                1,
                t("environmentAdmin.setupCountUnit")
              )}
              {number(
                "userEnvironments",
                "userMaxEnvironments",
                0,
                1000000,
                1,
                t("environmentAdmin.setupCountUnit")
              )}
            </div>
          </section>
        </fieldset>
        {!value.image_ready && (
          <p role="status" className="text-xs text-destructive">
            {t("environmentAdmin.setupImagePending")}
          </p>
        )}
        <FormError error={error} />
      </div>
      <DialogFooter className="shrink-0">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={close}
        >
          {t("environmentAdmin.cancel")}
        </Button>
        <Button type="submit" disabled={busy} loading={busy}>
          {t("environmentAdmin.save")}
        </Button>
      </DialogFooter>
    </form>
  )
}
