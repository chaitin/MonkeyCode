import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import {
  GiB,
  MiB,
  units,
  type Preset,
  type Page,
  type Profile,
} from "@/lib/environments"
import { useEnvironmentData } from "@/hooks/use-environment-data"
import {
  EnvironmentFrame,
  LoadState,
  Pagination,
  NumberField,
  FormError,
  Identity,
} from "@/components/environments/common"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

export function EnvironmentPresetsPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const result = useEnvironmentData<Page<Preset>>(
    `/api/admin/v1/environment-presets?page=${page}&page_size=20`
  )
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  async function toggle(preset: Preset) {
    if (busy) return
    setBusy(preset.id)
    setError("")
    try {
      await api(`/api/admin/v1/environment-presets/${preset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !preset.enabled }),
      })
      result.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy("")
    }
  }
  return (
    <EnvironmentFrame
      title={t("environmentAdmin.presetsTitle")}
      description={t("environmentAdmin.presetsDescription")}
      action={
        <Button onClick={() => setOpen(true)}>
          {t("environmentAdmin.addPreset")}
        </Button>
      }
    >
      <FormError error={error} />
      <LoadState {...result} empty={!result.data?.items.length} />
      <ul className="divide-y">
        {result.data?.items.map((p) => (
          <li key={p.id} className="space-y-3 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-medium">{p.name}</span>
                  <Badge variant="secondary">
                    {t(
                      `environmentAdmin.${p.enabled ? "enabled" : "disabled"}`
                    )}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {p.configuration.architecture} ·{" "}
                  {p.configuration.resource.cpu_millis / 1000} CPU ·{" "}
                  {p.configuration.resource.memory_bytes / GiB} GiB
                </p>
              </div>
              <Button
                variant="outline"
                disabled={!!busy || result.loading}
                onClick={() => void toggle(p)}
              >
                {t(
                  `environmentAdmin.${busy === p.id ? "saving" : p.enabled ? "disable" : "enable"}`
                )}
              </Button>
            </div>
            <p className="break-all font-mono text-xs text-muted-foreground">
              {p.configuration.image}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("environmentAdmin.volumeSummary", {
                workspace: p.configuration.storage.workspace_bytes / GiB,
                home: p.configuration.storage.home_bytes / GiB,
                runtime: p.configuration.storage.runtime_bytes / GiB,
              })}
            </p>
            <Collapsible className="rounded-md border p-3 text-sm">
              <CollapsibleTrigger className="cursor-pointer rounded underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2">
                {t("environmentAdmin.presetDetails")}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Identity
                    label={t("environmentAdmin.presetID")}
                    value={p.id}
                  />
                  <Identity
                    label={t("environmentAdmin.fields.temporary")}
                    value={p.configuration.resource.temporary_bytes / MiB}
                  />
                  <Identity
                    label={t("environmentAdmin.fields.tasks")}
                    value={p.configuration.resource.host_tasks}
                  />
                  <Identity
                    label={t("environmentAdmin.fields.inodes")}
                    value={p.configuration.storage.inodes}
                  />
                  <Identity
                    label={t("environmentAdmin.network")}
                    value={t(
                      `environmentAdmin.${p.configuration.network_policy}`
                    )}
                  />
                </dl>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
      <Pagination
        page={page}
        count={result.data?.items.length ?? 0}
        disabled={result.loading || !!result.error || !!busy}
        onChange={setPage}
      />
      {open && (
        <PresetDialog
          close={() => setOpen(false)}
          saved={() => {
            setOpen(false)
            setPage(1)
            result.refresh()
          }}
        />
      )}
    </EnvironmentFrame>
  )
}
function PresetDialog({
  close,
  saved,
}: {
  close: () => void
  saved: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [image, setImage] = useState("")
  const [network, setNetwork] = useState<Profile["network_policy"]>("isolated")
  const [architecture, setArchitecture] = useState<"amd64" | "arm64">("amd64")
  const [values, setValues] = useState({
    cpu: "2",
    memory: "4096",
    tasks: "1024",
    temporary: "512",
    workspace: "20",
    home: "10",
    runtime: "2",
    inodes: "100000",
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError("")
    let profile: Profile
    try {
      if (
        new TextEncoder().encode(name.trim()).length > 128 ||
        !name.trim() ||
        /[\r\n\t]/.test(name) ||
        name.includes(String.fromCharCode(0)) ||
        !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(image.trim())
      )
        throw new Error()
      profile = {
        architecture,
        image: image.trim(),
        network_policy: network,
        resource: {
          cpu_millis: units(values.cpu, 1000),
          memory_bytes: units(values.memory, MiB),
          host_tasks: units(values.tasks),
          temporary_bytes: units(values.temporary, MiB),
        },
        storage: {
          workspace_bytes: units(values.workspace, GiB),
          home_bytes: units(values.home, GiB),
          runtime_bytes: units(values.runtime, GiB),
          inodes: units(values.inodes),
        },
      }
      if (profile.resource.temporary_bytes > profile.resource.memory_bytes / 2)
        throw new Error()
    } catch {
      setError(t("environmentAdmin.invalidPreset"))
      return
    }
    setBusy(true)
    try {
      await api("/api/admin/v1/environment-presets", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), configuration: profile }),
      })
      saved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const fields = [
    ["cpu", 0.1, 256, 0.001],
    ["memory", 256, 1048576, 1],
    ["temporary", 16, 524288, 1],
    ["tasks", 64, 65536, 1],
    ["workspace", 0.0625, 16384, 0.0625],
    ["home", 0.0625, 16384, 0.0625],
    ["runtime", 0.0625, 16384, 0.0625],
    ["inodes", 1024, 100000000, 1],
  ] as const
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !busy) close()
      }}
    >
      <DialogContent
        className="max-h-[85dvh] w-[calc(100vw_-_2rem)] overflow-y-auto sm:max-w-2xl"
        closeLabel={t("environmentAdmin.close")}
      >
        <DialogHeader>
          <DialogTitle>{t("environmentAdmin.addPreset")}</DialogTitle>
          <DialogDescription>
            {t("environmentAdmin.presetHint")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={busy} className="space-y-5">
            <Field>
              <FieldLabel htmlFor="preset-name">
                {t("environmentAdmin.name")}
              </FieldLabel>
              <Input
                id="preset-name"
                required
                maxLength={128}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="preset-image">
                {t("environmentAdmin.image")}
              </FieldLabel>
              <Input
                id="preset-image"
                required
                maxLength={512}
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="registry.example.com/dev@sha256:…"
              />
              <FieldDescription>
                {t("environmentAdmin.imageHint")}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>{t("environmentAdmin.architecture")}</FieldLabel>
              <RadioGroup
                aria-label={t("environmentAdmin.architecture")}
                value={architecture}
                onValueChange={(value) =>
                  setArchitecture(value as "amd64" | "arm64")
                }
                className="flex gap-5"
              >
                {["amd64", "arm64"].map((value) => (
                  <label key={value} className="flex items-center gap-2">
                    <RadioGroupItem value={value} />
                    {value}
                  </label>
                ))}
              </RadioGroup>
            </Field>
            <Field>
              <FieldLabel>{t("environmentAdmin.network")}</FieldLabel>
              <RadioGroup
                aria-label={t("environmentAdmin.network")}
                aria-describedby="preset-network-hint"
                value={network}
                onValueChange={(value) =>
                  setNetwork(value as Profile["network_policy"])
                }
              >
                {(["isolated", "public-only"] as const).map((value) => (
                  <label
                    key={value}
                    className="flex min-h-11 cursor-pointer items-center gap-2"
                  >
                    <RadioGroupItem value={value} />
                    {t(`environmentAdmin.${value}`)}
                  </label>
                ))}
              </RadioGroup>
              <FieldDescription id="preset-network-hint">
                {t("environmentAdmin.networkHint")}
              </FieldDescription>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map(([key, min, max, step]) => (
                <NumberField
                  key={key}
                  name={key}
                  label={t(`environmentAdmin.fields.${key}`)}
                  value={values[key]}
                  onChange={(value) =>
                    setValues((old) => ({ ...old, [key]: value }))
                  }
                  min={min}
                  max={max}
                  step={step}
                />
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              {t("environmentAdmin.resourceHint")}
            </p>
          </fieldset>
          <FormError error={error} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              {t("environmentAdmin.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t(`environmentAdmin.${busy ? "saving" : "save"}`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
