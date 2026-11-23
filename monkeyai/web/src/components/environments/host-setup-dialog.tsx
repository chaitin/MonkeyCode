import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import { diskSize, GiB } from "@/lib/environments"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import { FormError, LoadState } from "./common"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
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
  driver?: string
  disk_bytes?: number
  host_id: string
  host_name: string
  grants: HostGrant[]
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
  const [name, setName] = useState(value.host_name)
  const [disk, setDisk] = useState(
    String((value.disk_bytes ?? 120 * GiB) / GiB)
  )
  const [grantsChanged, setGrantsChanged] = useState(false)
  const root = groups.find((group) => !group.parentId)?.id
  const [authorization, setAuthorization] = useState(() => ({
    groupIds: value.grants?.length
      ? value.grants.flatMap((g) =>
          g.all_users && root ? [root] : g.group_id ? [g.group_id] : []
        )
      : [],
    userIds: value.grants?.flatMap((g) => (g.user_id ? [g.user_id] : [])) ?? [],
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError("")
    const normalizedName = name.trim()
    if (new TextEncoder().encode(normalizedName).length > 128) {
      setError(t("environmentAdmin.hostNameTooLong"))
      return
    }
    let diskBytes: number | undefined
    if (value.driver === "firecracker") {
      try {
        diskBytes = diskSize(disk)
      } catch {
        setError(t("environmentAdmin.setupDiskInvalid"))
        return
      }
    }
    const body = {
      ...(diskBytes !== undefined &&
        diskBytes !== value.disk_bytes && { disk_bytes: diskBytes }),
      ...(normalizedName !== value.host_name && { name: normalizedName }),
      ...(grantsChanged && {
        grants: [
          ...authorization.groupIds.map((group_id) => ({ group_id })),
          ...authorization.userIds.map((user_id) => ({ user_id })),
        ],
      }),
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

  return (
    <form onSubmit={submit} className="flex min-h-0 min-w-0 flex-col gap-5">
      <div className="-mx-1 min-h-0 min-w-0 space-y-4 overflow-y-auto overflow-x-hidden px-1">
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <Field>
            <FieldLabel htmlFor="setup-host-name">
              {t("environmentAdmin.hostName")}
            </FieldLabel>
            <Input
              id="setup-host-name"
              value={name}
              placeholder={t("environmentAdmin.unnamedHost")}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="setup-host-access">
              {t("pages.models.authorizedScope")}
            </FieldLabel>
            <GroupSelect
              id="setup-host-access"
              options={groups}
              users={users}
              value={authorization}
              onValueChange={(next) => {
                setGrantsChanged(true)
                setAuthorization({
                  groupIds: [...next.groupIds],
                  userIds: [...next.userIds],
                })
              }}
              label={t("pages.models.authorizedScope")}
              placeholder={t("pages.models.authorizationPlaceholder")}
              emptyText={t("pages.models.noMatchingAuthorization")}
              locale={i18n.resolvedLanguage ?? i18n.language}
              disabled={busy}
              multiple
              selectionMode="both"
              cascadeGroups
              searchable
              searchPlaceholder={t("pages.models.searchAuthorization")}
              noResultsText={t("pages.models.noMatchingAuthorization")}
            />
          </Field>
          {value.driver === "firecracker" && (
            <Field>
              <FieldLabel htmlFor="setup-disk">
                {t("environmentAdmin.setupDisk")} (GiB)
              </FieldLabel>
              <Input
                id="setup-disk"
                type="number"
                required
                min="0.0625"
                max="16384"
                step="any"
                value={disk}
                onChange={(event) => setDisk(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("environmentAdmin.setupDiskHint")}
              </p>
            </Field>
          )}
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
