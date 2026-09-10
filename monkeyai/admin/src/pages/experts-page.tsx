import { api } from "@/lib/api"
import {
  base,
  grants,
  selection,
  match,
  saveResource,
  listResources,
  useResources,
  useSubjects,
  type ResourceRow,
} from "@/lib/resources"
import { ResourceNotice } from "@/components/resource-notice"
import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  AiBrain01Icon,
  Copy02Icon,
  Delete02Icon,
  Edit02Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
  Search02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { AuthorizationSelect } from "@/components/authorization-select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import {
  getAuthorizationNames,
  type AuthorizationSelection,
} from "@/lib/authorization-groups"
import { cn } from "@/lib/utils"

type Expert = {
  ownership: ResourceRow["ownership_type"]
  owner: string
  revision: number
  id: string
  name: string
  description: string
  prompt: string
  providerSettings: ResourceRow["providers"]
  defaultModelId: string
  knowledgeBaseIds: string[]
  toolIds: string[]
  ruleIds: string[]
  skillIds: string[]
  authorization: AuthorizationSelection
  enabled: boolean
  updatedAt: string
}

type ExpertForm = Omit<
  Expert,
  "id" | "updatedAt" | "enabled" | "revision" | "ownership" | "owner"
>
type AssociationKey = "knowledgeBaseIds" | "toolIds" | "ruleIds" | "skillIds"

type AssociationOption = {
  id: string
  name: string
  description: string
}

function toExpert(row: ResourceRow): Expert {
  return {
    id: row.id,
    ownership: row.ownership_type,
    owner: row.owner_name ?? row.owner_user_id,
    revision: row.revision,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    providerSettings: row.providers ?? [],
    defaultModelId: row.default_model_id ?? "",
    knowledgeBaseIds: [],
    toolIds: (row.providers ?? []).map((p) => p.provider_id),
    ruleIds: row.rule_ids ?? [],
    skillIds: row.skill_ids ?? [],
    authorization: selection(row.grants),
    enabled: row.enabled,
    updatedAt: row.updated_at,
  }
}
const EMPTY_FORM: ExpertForm = {
  name: "",
  description: "",
  prompt: "",
  providerSettings: [],
  defaultModelId: "",
  knowledgeBaseIds: [],
  toolIds: [],
  ruleIds: [],
  skillIds: [],
  authorization: {
    groupIds: [],
    memberIds: [],
  },
}

const ASSOCIATION_SECTIONS: Array<{
  key: AssociationKey
  labelKey: string
}> = [
  { key: "toolIds", labelKey: "tools" },
  { key: "ruleIds", labelKey: "rules" },
  { key: "skillIds", labelKey: "skills" },
]

function ExpertAssociationSelect({
  id,
  label,
  options,
  value,
  onValueChange,
}: {
  id: string
  label: string
  options: AssociationOption[]
  value: string[]
  onValueChange: (value: string[]) => void
}) {
  const { i18n, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const normalizedQuery = query.trim().toLocaleLowerCase(i18n.language)
  const filteredOptions = options.filter((option) =>
    [option.name, option.description].some((text) =>
      text.toLocaleLowerCase(i18n.language).includes(normalizedQuery)
    )
  )
  const selectedNames = options
    .filter((option) => value.includes(option.id))
    .map((option) => option.name)
    .join(", ")

  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setQuery("")
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            className="w-full min-w-0 justify-between font-normal"
          />
        }
      >
        <span
          className={cn(
            "truncate",
            value.length === 0 && "text-muted-foreground"
          )}
          title={
            selectedNames ||
            t("pages.experts.selectAssociation", { resource: label })
          }
        >
          {value.length > 0
            ? t("pages.experts.selectedCount", { count: value.length })
            : t("pages.experts.selectAssociation", { resource: label })}
        </span>
        <HugeiconsIcon icon={UnfoldMoreIcon} data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) gap-1 p-1">
        <PopoverHeader className="sr-only">
          <PopoverTitle>{label}</PopoverTitle>
        </PopoverHeader>
        <div className="p-1">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("pages.experts.searchAssociation", {
              resource: label,
            })}
            aria-label={t("pages.experts.searchAssociation", {
              resource: label,
            })}
          />
        </div>
        <div className="max-h-64 overflow-y-auto" role="listbox">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => {
              const optionId = `${id}-${option.id}`
              const checked = value.includes(option.id)

              return (
                <label
                  key={option.id}
                  htmlFor={optionId}
                  className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 hover:bg-muted"
                >
                  <Checkbox
                    id={optionId}
                    checked={checked}
                    onCheckedChange={(nextChecked) =>
                      onValueChange(
                        nextChecked
                          ? [...value, option.id]
                          : value.filter((item) => item !== option.id)
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {option.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </label>
              )
            })
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t("pages.experts.noAssociationResults")}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ExpertsPage() {
  const { i18n, t } = useTranslation()
  const remote = useResources("/experts", toExpert)
  const experts = remote.items
  const subjects = useSubjects()
  const [options, setOptions] = useState<
    Record<AssociationKey, AssociationOption[]>
  >({ knowledgeBaseIds: [], toolIds: [], ruleIds: [], skillIds: [] })
  const [models, setModels] = useState<{ id: string; display_name: string }[]>(
    []
  )
  const [optionError, setOptionError] = useState("")

  const [query, setQuery] = useState("")
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingExpert, setEditingExpert] = useState<Expert | null>(null)
  const [form, setForm] = useState<ExpertForm>(EMPTY_FORM)
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
  const [pendingDeletion, setPendingDeletion] = useState<Expert | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      listResources(base + "/rules?ownership_type=system"),
      listResources(base + "/skills?ownership_type=system"),
      listResources(base + "/connector-providers?ownership_type=system"),
      api<{ models: { id: string; display_name: string }[] }>(
        base + "/models?ownership_type=system"
      ),
    ])
      .then(([rules, skills, providers, models]) => {
        if (cancelled) return
        const map = (rows: ResourceRow[]) =>
          rows
            .filter((r) => r.enabled !== false)
            .map((r) => ({
              id: r.id,
              name: r.name,
              description: r.description ?? r.content ?? "",
            }))
        setOptions({
          knowledgeBaseIds: [],
          ruleIds: map(rules.items),
          skillIds: map(skills.items),
          toolIds: map(providers.items),
        })
        setModels(models.models)
        setOptionError("")
      })
      .catch((e) => {
        if (!cancelled) setOptionError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [editorOpen])
  const filteredExperts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(i18n.language)
    if (!normalizedQuery) return experts

    return experts.filter((expert) =>
      [expert.name, expert.description, expert.prompt].some((value) =>
        value.toLocaleLowerCase(i18n.language).includes(normalizedQuery)
      )
    )
  }, [experts, i18n.language, query])

  const openCreateDialog = () => {
    setEditingExpert(null)
    setForm(EMPTY_FORM)
    setAuthorizationOpen(false)
    setEditorOpen(true)
  }

  const openEditDialog = (expert: Expert) => {
    setEditingExpert(expert)
    setForm({
      name: expert.name,
      description: expert.description,
      prompt: expert.prompt,
      defaultModelId: expert.defaultModelId,
      providerSettings: expert.providerSettings,
      knowledgeBaseIds: expert.knowledgeBaseIds,
      toolIds: expert.toolIds,
      ruleIds: expert.ruleIds,
      skillIds: expert.skillIds,
      authorization: expert.authorization,
    })
    setEditorOpen(true)
  }

  const updateForm = <Key extends keyof ExpertForm>(
    key: Key,
    value: ExpertForm[Key]
  ) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateProvider = (
    id: string,
    patch: Partial<ResourceRow["providers"][number]>
  ) => {
    const current = form.providerSettings.find((p) => p.provider_id === id) ?? {
      provider_id: id,
      required: true,
      tool_allowlist: [],
      tool_denylist: [],
    }
    updateForm("providerSettings", [
      ...form.providerSettings.filter((p) => p.provider_id !== id),
      { ...current, ...patch },
    ])
  }
  const saveExpert = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await remote.run(async () => {
      await saveResource(
        editingExpert ? `/experts/${editingExpert.id}` : "/experts",
        {
          name: form.name,
          description: form.description,
          prompt: form.prompt,
          default_model_id: form.defaultModelId || null,
          rule_ids: form.ruleIds,
          skill_ids: form.skillIds,
          providers: form.toolIds.map(
            (provider_id) =>
              form.providerSettings.find(
                (p) => p.provider_id === provider_id
              ) ?? {
                provider_id,
                required: true,
                tool_allowlist: [],
                tool_denylist: [],
              }
          ),
          grants: grants(form.authorization),
        },
        editingExpert?.revision
      )
      setEditorOpen(false)
    })
  }
  const setExpertEnabled = async (id: string, enabled: boolean) => {
    const item = experts.find((e) => e.id === id)
    if (!item) return
    await remote.run(async () => {
      await api(base + `/experts/${id}/enabled`, {
        method: "PATCH",
        headers: match(item.revision),
        body: JSON.stringify({ enabled }),
      })
    })
  }
  const duplicateExpert = async (expert: Expert) => {
    await remote.run(async () => {
      await api(base + `/experts/${expert.id}/copy`, {
        method: "POST",
        body: JSON.stringify({
          name: expert.name + t("pages.experts.copySuffix"),
        }),
      })
    })
  }
  const deleteExpert = async () => {
    if (!pendingDeletion) return
    await remote.run(async () => {
      await api(base + `/experts/${pendingDeletion.id}`, {
        method: "DELETE",
        headers: match(pendingDeletion.revision),
      })
      setPendingDeletion(null)
    })
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 p-4 pt-0">
      <ResourceNotice
        error={remote.error || subjects.error || optionError}
        loading={remote.loading}
        pending={remote.pending}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-64">
          <HugeiconsIcon
            icon={Search02Icon}
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="ps-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("pages.experts.searchPlaceholder")}
            aria-label={t("pages.experts.searchPlaceholder")}
          />
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
          {t("pages.experts.createExpert")}
        </Button>
      </div>

      {filteredExperts.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredExperts.map((expert) => (
            <Card key={expert.id} className={cn(!expert.enabled && "bg-muted")}>
              <CardHeader>
                <div className="flex min-w-0 items-start gap-3">
                  <Avatar size="lg">
                    <AvatarFallback>
                      <HugeiconsIcon icon={AiBrain01Icon} strokeWidth={2} />
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex min-w-0 items-center gap-2">
                      <span className="truncate" title={expert.name}>
                        {expert.name}
                      </span>
                      {expert.ownership === "user" && (
                        <Badge variant="outline">
                          {t("pages.experts.personalExpert")}
                        </Badge>
                      )}
                      {!expert.enabled && (
                        <Badge variant="outline">
                          {t("pages.experts.disabled")}
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription
                      className="truncate"
                      title={expert.description}
                    >
                      {expert.description}
                    </CardDescription>
                    {expert.ownership === "user" && (
                      <CardDescription
                        className="truncate"
                        title={expert.owner}
                      >
                        {expert.owner}
                      </CardDescription>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("common.more")}
                        />
                      }
                    >
                      <HugeiconsIcon
                        icon={MoreHorizontalIcon}
                        strokeWidth={2}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {expert.ownership === "system" && (
                        <>
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              disabled={expert.enabled}
                              onClick={() => setExpertEnabled(expert.id, true)}
                            >
                              <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
                              {t("pages.experts.enable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!expert.enabled}
                              onClick={() => setExpertEnabled(expert.id, false)}
                            >
                              <HugeiconsIcon icon={PauseIcon} strokeWidth={2} />
                              {t("pages.experts.disable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openEditDialog(expert)}
                            >
                              <HugeiconsIcon
                                icon={Edit02Icon}
                                strokeWidth={2}
                              />
                              {t("pages.experts.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => duplicateExpert(expert)}
                            >
                              <HugeiconsIcon
                                icon={Copy02Icon}
                                strokeWidth={2}
                              />
                              {t("pages.experts.duplicate")}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setPendingDeletion(expert)}
                        >
                          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                          {t("pages.experts.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p
                  className="line-clamp-2 text-sm text-muted-foreground"
                  title={expert.prompt}
                >
                  {expert.prompt}
                </p>
              </CardContent>
              <CardFooter className="min-w-0 gap-4 border-t">
                <span
                  className="w-2/5 truncate text-muted-foreground"
                  title={t("pages.experts.authorizedScope")}
                >
                  {t("pages.experts.authorizedScope")}
                </span>
                <span
                  className="w-3/5 truncate text-end font-medium"
                  title={getAuthorizationNames(
                    expert.authorization,
                    t,
                    subjects.flatGroups,
                    subjects.members
                  )}
                >
                  {getAuthorizationNames(
                    expert.authorization,
                    t,
                    subjects.flatGroups,
                    subjects.members
                  )}
                </span>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t("pages.experts.empty")}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) {
            setEditingExpert(null)
            setAuthorizationOpen(false)
          }
        }}
      >
        <DialogContent
          className="max-h-[calc(100vh-2rem)] sm:max-w-3xl"
          closeLabel={t("common.close")}
        >
          <DialogHeader>
            <DialogTitle>
              {editingExpert
                ? t("pages.experts.editTitle")
                : t("pages.experts.createTitle")}
            </DialogTitle>
          </DialogHeader>
          <form
            id="expert-editor-form"
            className="flex min-h-0 flex-col gap-6"
            onSubmit={saveExpert}
          >
            <FieldGroup className="max-h-[calc(100vh-12rem)] gap-6 overflow-y-auto pe-1">
              <Field>
                <FieldLabel htmlFor="expert-model">
                  {t("resources.defaultModel")}
                </FieldLabel>
                <select
                  id="expert-model"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.defaultModelId}
                  onChange={(e) => updateForm("defaultModelId", e.target.value)}
                >
                  <option value="">{t("resources.noDefaultModel")}</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <FieldLabel htmlFor="expert-name">
                  {t("pages.experts.name")}
                </FieldLabel>
                <Input
                  id="expert-name"
                  value={form.name}
                  onChange={(event) => updateForm("name", event.target.value)}
                  placeholder={t("pages.experts.namePlaceholder")}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="expert-description">
                  {t("pages.experts.expertDescription")}
                </FieldLabel>
                <Textarea
                  id="expert-description"
                  value={form.description}
                  onChange={(event) =>
                    updateForm("description", event.target.value)
                  }
                  placeholder={t("pages.experts.descriptionPlaceholder")}
                  rows={3}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="expert-prompt">
                  {t("pages.experts.prompt")}
                </FieldLabel>
                <Textarea
                  id="expert-prompt"
                  className="min-h-48 resize-none"
                  value={form.prompt}
                  onChange={(event) => updateForm("prompt", event.target.value)}
                  placeholder={t("pages.experts.promptPlaceholder")}
                  required
                />
              </Field>
              {ASSOCIATION_SECTIONS.map(({ key, labelKey }) => (
                <Field key={key}>
                  <FieldLabel htmlFor={`expert-${key}`}>
                    {t(`pages.experts.${labelKey}`)}
                  </FieldLabel>
                  <ExpertAssociationSelect
                    id={`expert-${key}`}
                    label={t(`pages.experts.${labelKey}`)}
                    options={options[key]}
                    value={form[key]}
                    onValueChange={(value) => updateForm(key, value)}
                  />
                </Field>
              ))}
              {form.toolIds.map((id) => {
                const settings = form.providerSettings.find(
                  (p) => p.provider_id === id
                )
                return (
                  <Field key={id}>
                    <FieldLabel>
                      {options.toolIds.find((p) => p.id === id)?.name}
                    </FieldLabel>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={settings?.required ?? true}
                        onChange={(e) =>
                          updateProvider(id, { required: e.target.checked })
                        }
                      />
                      {t("resources.requiredProvider")}
                    </label>
                    <Input
                      aria-label={t("resources.allowTools")}
                      placeholder={t("resources.allowTools")}
                      value={(settings?.tool_allowlist ?? []).join(",")}
                      onChange={(e) =>
                        updateProvider(id, {
                          tool_allowlist: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                    <Input
                      aria-label={t("resources.denyTools")}
                      placeholder={t("resources.denyTools")}
                      value={(settings?.tool_denylist ?? []).join(",")}
                      onChange={(e) =>
                        updateProvider(id, {
                          tool_denylist: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </Field>
                )
              })}
              <Field>
                <FieldLabel htmlFor="expert-authorization">
                  {t("pages.experts.authorizedScope")}
                </FieldLabel>
                <AuthorizationSelect
                  groups={subjects.groups}
                  members={subjects.members}
                  id="expert-authorization"
                  open={authorizationOpen}
                  placeholder={t("pages.experts.authorizationPlaceholder")}
                  title={t("pages.experts.authorizedScope")}
                  value={form.authorization}
                  onOpenChange={setAuthorizationOpen}
                  onValueChange={(value) => updateForm("authorization", value)}
                />
              </Field>
            </FieldGroup>
            <ResourceNotice
              error={remote.error || subjects.error || optionError}
              loading={false}
              pending={remote.pending}
            />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t("pages.experts.cancel")}
              </DialogClose>
              <Button type="submit" disabled={remote.pending}>
                {editingExpert
                  ? t("pages.experts.save")
                  : t("pages.experts.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeletion(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.experts.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.experts.deleteDescription", {
                expert: pendingDeletion?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("pages.experts.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteExpert}>
              {t("pages.experts.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
