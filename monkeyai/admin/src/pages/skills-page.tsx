import { api } from "@/lib/api"
import { useAppToast } from "@/components/animated-toast-provider"
import {
  applySkillBatch,
  type SkillBatchChange,
  type SkillBatchProgress,
} from "@/lib/skill-batch"
import {
  base,
  grants,
  selection,
  match,
  saveResource,
  savePackageGrants,
  localized,
  useSubjects,
  type ResourceRow,
} from "@/lib/resources"
import { getCreatorInitial } from "@/lib/utils"
import { ResourceNotice } from "@/components/resource-notice"
import { ResourceCard } from "@/components/resource-card"
import { ResourceCardMenuButton } from "@/components/resource-card-menu-button"
import { ResourceTagSummary } from "@/components/resource-tag-summary"
import { ResourcePackageBadge } from "@/components/resource-package-badge"
import { ResourceAuthorizationBadge } from "@/components/resource-authorization-badge"
import { useRef, useState, type ChangeEvent, type FormEvent } from "react"
import {
  Delete02Icon,
  DocumentValidationIcon,
  Edit02Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { AuthorizationSelect } from "@/components/authorization-select"
import { SkillImportWizard } from "@/components/skill-import-wizard"
import { SkillBatchActions } from "@/components/skill-batch-actions"
import { ResourceEditorFooter } from "@/components/resource-editor-footer"
import { SkillTagSelect } from "@/components/skill-tag-select"
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { ResourceList } from "@/components/resource-list"
import { useResourceList } from "@/hooks/use-resource-list"
import { Textarea } from "@/components/ui/textarea"
import { useSkillTags } from "@/hooks/use-skill-tags"
import type { AuthorizationSelection } from "@/lib/authorization-groups"
import {
  inspectSkillPackage,
  SkillPackageError,
  type SkillPackageAnalysis,
} from "@/lib/skill-package"

type SkillType = "system" | "user"

type AgentSkill = {
  origin?: ResourceRow["origin"]
  publisher?: string
  retired?: boolean
  grants: ResourceRow["grants"]
  revision: number
  id: string
  name: string
  description: string
  content: string
  tagIds: string[]
  type: SkillType
  creator: string
  authorization: AuthorizationSelection
  enabled: boolean
  packageFileName: string
  fileCount: number
}

type SkillDraft = {
  name: string
  description: string
  content: string
  tagIds: string[]
}

function toSkill(row: ResourceRow, language: string): AgentSkill {
  const text = localized(row, language)
  return {
    id: row.id,
    origin: row.origin,
    publisher: row.publisher,
    retired: row.retired,
    grants: row.grants,
    revision: row.revision,
    name: text.name,
    description: text.description,
    content: "",
    tagIds: (row.tags ?? []).map((t) => t.id),
    type: row.ownership_type,
    creator: row.user.name || row.user.email || row.user.id,
    authorization: selection(row.grants),
    enabled: row.enabled,
    packageFileName: row.package_file_name,
    fileCount: row.file_count,
  }
}
const EMPTY_SKILL_DRAFT: SkillDraft = {
  name: "",
  description: "",
  content: "",
  tagIds: [],
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function SkillsPage() {
  const { t, i18n } = useTranslation()
  const { showToast } = useAppToast()
  const { tags: availableTags } = useSkillTags()
  const remote = useResourceList("/skills")
  const skills = remote.items.map((row) => toSkill(row, i18n.language))
  const subjects = useSubjects()
  const authorizationGroupNames = new Map(
    subjects.flatGroups.map((group) => [group.value, group.labelKey])
  )
  const authorizationMemberNames = new Map(
    subjects.members.map((member) => [member.id, member.name || member.email])
  )
  const activeSkillType = remote.type
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedRows = remote.items.filter(
    (skill) =>
      skill.ownership_type === "system" && selectedIds.includes(skill.id)
  )
  const [batchProgress, setBatchProgress] = useState<SkillBatchProgress>({
    completed: 0,
    total: 0,
  })
  const selectionKey = `${remote.type}:${remote.search}:${remote.page}:${remote.pageSize}`
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<AgentSkill | null>(null)
  const [skillPendingDeletion, setSkillPendingDeletion] =
    useState<AgentSkill | null>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({
    groupIds: [],
    memberIds: [],
  })
  const [draft, setDraft] = useState<SkillDraft>(EMPTY_SKILL_DRAFT)
  const [packageAnalysis, setPackageAnalysis] =
    useState<SkillPackageAnalysis | null>(null)
  const [packageFile, setPackageFile] = useState<File | null>(null)
  const [packageError, setPackageError] = useState("")
  const [packageParsing, setPackageParsing] = useState(false)
  const [fileInputKey, setFileInputKey] = useState(0)
  const packageRequestId = useRef(0)
  const packageInputRef = useRef<HTMLInputElement>(null)
  const importedSkill = editingSkill?.origin === "package"

  const exitSelection = () => {
    setSelecting(false)
    setSelectedIds([])
  }

  const handleBatchApply = async (change: SkillBatchChange) => {
    if (remote.loading || selectedRows.length === 0) return false
    return remote.run(async () => {
      setBatchProgress({ completed: 0, total: selectedRows.length })
      const result = await applySkillBatch(
        selectedRows,
        change,
        api,
        setBatchProgress
      )
      if (
        change.action === "delete" &&
        result.succeeded.length === remote.items.length &&
        remote.page > 1
      ) {
        remote.previousPage(remote.type)
      }
      setSelectedIds(result.failed.map((failure) => failure.id))
      setSelecting(result.failed.length > 0)
      showToast({
        status: result.failed.length
          ? "error"
          : result.skipped.length
            ? "info"
            : "success",
        title: t("resources.skillBatch.result", {
          succeeded: result.succeeded.length,
          failed: result.failed.length,
          skipped: result.skipped.length,
        }),
        description: result.failed.length
          ? `${t("resources.skillBatch.retryFailed")} ${result.failed
              .slice(0, 3)
              .map((failure) => `${failure.name}: ${failure.message}`)
              .join("；")}`
          : result.skipped.length
            ? t("resources.skillBatch.packageSkipped", {
                count: result.skipped.length,
              })
            : undefined,
      })
    })
  }

  const toggleSelected = (id: string) => {
    if (remote.pending) return
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id]
    )
  }

  const resetSkillOptions = () => {
    packageRequestId.current += 1
    setTagsOpen(false)
    setAuthorization({ groupIds: [], memberIds: [] })
    setDraft(EMPTY_SKILL_DRAFT)
    setPackageAnalysis(null)
    setPackageFile(null)
    setPackageError("")
    setPackageParsing(false)
    setFileInputKey((currentKey) => currentKey + 1)
  }

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open)
    if (!open) {
      setEditingSkill(null)
      resetSkillOptions()
    }
  }

  const handleEditSkill = async (skill: AgentSkill) => {
    if (skill.type !== "system") return
    const ok = await remote.run(async () => {
      const manifest = await api<{ content: string }>(
        base + `/skills/${skill.id}/manifest`
      )
      skill = { ...skill, content: manifest.content }
    })
    if (!ok) return
    if (skill.type !== "system") {
      return
    }

    setEditingSkill(skill)
    setAuthorization(skill.authorization)
    setDraft({
      name: skill.name,
      description: skill.description,
      content: skill.content,
      tagIds: skill.tagIds,
    })
    setPackageAnalysis(null)
    setPackageFile(null)
    setPackageError("")
    setTagsOpen(false)
    setDialogOpen(true)
  }

  const handlePackageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (importedSkill) return
    const file = event.currentTarget.files?.[0]
    const requestId = packageRequestId.current + 1
    packageRequestId.current = requestId
    setPackageAnalysis(null)
    setPackageFile(null)
    setPackageError("")

    if (!file) {
      return
    }

    setDraft(EMPTY_SKILL_DRAFT)

    if (!file.name.toLowerCase().endsWith(".zip")) {
      setPackageError(t("pages.skills.packageErrors.invalidZip"))
      return
    }

    setPackageParsing(true)
    try {
      const analysis = await inspectSkillPackage(file)
      if (requestId !== packageRequestId.current) {
        return
      }
      setPackageAnalysis(analysis)
      setPackageFile(file)
      setDraft({
        name: analysis.name,
        description: analysis.description,
        content: analysis.content.replace(
          /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
          ""
        ),
        tagIds: availableTags
          .filter((tag) =>
            analysis.tags.some(
              (packageTag) =>
                packageTag.toLocaleLowerCase() === tag.name.toLocaleLowerCase()
            )
          )
          .map((tag) => tag.id),
      })
    } catch (error) {
      if (requestId !== packageRequestId.current) {
        return
      }
      const errorKey =
        error instanceof SkillPackageError ? error.code : "invalidZip"
      setPackageError(t(`pages.skills.packageErrors.${errorKey}`))
    } finally {
      if (requestId === packageRequestId.current) {
        setPackageParsing(false)
      }
    }
  }

  const setSkillEnabled = async (id: string, enabled: boolean) => {
    const item = skills.find((s) => s.id === id)
    if (!item) return
    await remote.run(async () => {
      await api(base + `/skills/${id}/enabled`, {
        method: "PATCH",
        headers: match(item.revision),
        body: JSON.stringify({ enabled }),
      })
    }, t("resources.operationCompleted"))
  }
  const handleSubmitSkill = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingSkill) return
    await remote.run(async () => {
      if (editingSkill.origin === "package") {
        const overrides: Record<string, string> = {}
        if (draft.name !== editingSkill.name) overrides.name = draft.name
        if (draft.description !== editingSkill.description) {
          overrides.description = draft.description
        }
        const resource = Object.keys(overrides).length
          ? await saveResource(
              `/skills/${editingSkill.id}`,
              overrides,
              editingSkill.revision
            )
          : editingSkill
        await savePackageGrants("skill", resource, authorization)
        handleDialogOpenChange(false)
        return
      }
      let item = editingSkill
      if (packageFile) {
        const form = new FormData()
        form.set("package", packageFile)
        const row = await api<ResourceRow>(
          base + `/skills/${item.id}/package`,
          { method: "PUT", headers: match(item.revision), body: form }
        )
        item = toSkill(row, i18n.language)
      }
      await saveResource(
        `/skills/${item.id}`,
        { ...draft, tag_ids: draft.tagIds, grants: grants(authorization) },
        item.revision
      )
      handleDialogOpenChange(false)
    }, t("resources.operationCompleted"))
  }
  const handleDeleteSkill = async () => {
    if (!skillPendingDeletion || skillPendingDeletion.origin === "package")
      return
    await remote.run(async () => {
      await api(base + `/skills/${skillPendingDeletion.id}`, {
        method: "DELETE",
        headers: match(skillPendingDeletion.revision),
      })
      if (skills.length === 1) remote.previousPage(skillPendingDeletion.type)
      setSkillPendingDeletion(null)
    }, t("resources.operationCompleted"))
  }

  return (
    <section className="flex h-[calc(100vh-4rem)] min-h-0 flex-none flex-col gap-4 p-4 pt-0 md:h-[calc(100vh-5rem)]">
      <ResourceList
        page={{
          ...remote,
          setType: (type) => {
            exitSelection()
            remote.setType(type)
          },
          handleSearch: (event) => {
            exitSelection()
            remote.handleSearch(event)
          },
          setPageSize: (size) => {
            exitSelection()
            remote.setPageSize(size)
          },
          nextPage: () => {
            exitSelection()
            remote.nextPage()
          },
          previousPage: (type = remote.type) => {
            exitSelection()
            remote.previousPage(type)
          },
        }}
        error={subjects.error}
        typeLabel={t("pages.skills.type")}
        systemLabel={t("pages.skills.systemSkill")}
        userLabel={t("pages.skills.userSkill")}
        searchPlaceholder={t("resources.searchPlaceholder", {
          resource: t("pages.skills.title"),
        })}
        searchClassName="sm:max-w-44 sm:flex-none"
        actions={
          <div className="ms-auto flex shrink-0 items-center gap-2">
            <SkillBatchActions
              key={selectionKey}
              selecting={selecting}
              selectedCount={selectedRows.length}
              pending={remote.pending}
              progress={batchProgress}
              onApply={handleBatchApply}
              disabled={
                remote.loading ||
                remote.pending ||
                (!selecting && skills.length === 0)
              }
              groups={subjects.groups}
              members={subjects.members}
              onEnter={() => {
                setSelectedIds([])
                setSelecting(true)
              }}
              onSelectAll={() =>
                setSelectedIds(
                  skills
                    .filter((skill) => skill.type === "system")
                    .map((skill) => skill.id)
                )
              }
              onClear={() => setSelectedIds([])}
              onExit={exitSelection}
            />
            {activeSkillType === "system" && (
              <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
                <DialogTrigger
                  render={
                    <Button
                      className="shrink-0"
                      disabled={remote.pending}
                      onClick={() => {
                        exitSelection()
                        setEditingSkill(null)
                        resetSkillOptions()
                      }}
                    />
                  }
                >
                  <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                  {t("pages.skills.add")}
                </DialogTrigger>
                <DialogContent
                  className="max-h-[calc(100vh-2rem)] grid-cols-1 overflow-y-auto sm:max-w-xl"
                  closeLabel={t("common.close")}
                  aria-describedby={
                    importedSkill ? "imported-skill-readonly" : undefined
                  }
                >
                  {editingSkill ? (
                    <form
                      key={editingSkill.id}
                      className="flex flex-col gap-6"
                      onSubmit={handleSubmitSkill}
                    >
                      <DialogHeader>
                        <DialogTitle>
                          {editingSkill
                            ? t("pages.skills.editDialogTitle")
                            : t("pages.skills.dialogTitle")}
                        </DialogTitle>
                      </DialogHeader>
                      <FieldGroup className="gap-4">
                        <Field>
                          <FieldLabel htmlFor="skill-name">
                            {t("pages.skills.name")}
                          </FieldLabel>
                          <Input
                            aria-readonly={!importedSkill}
                            id="skill-name"
                            placeholder={t("pages.skills.namePlaceholder")}
                            readOnly={!importedSkill}
                            required={!importedSkill}
                            value={draft.name}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                name: event.target.value,
                              }))
                            }
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="skill-description">
                            {t("pages.skills.skillDescription")}
                          </FieldLabel>
                          <Input
                            aria-readonly={!importedSkill}
                            id="skill-description"
                            placeholder={t(
                              "pages.skills.skillDescriptionPlaceholder"
                            )}
                            readOnly={!importedSkill}
                            required={!importedSkill}
                            value={draft.description}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                          />
                        </Field>
                        <fieldset disabled={importedSkill} className="contents">
                          <Field>
                            <FieldLabel htmlFor="skill-content">
                              {t("resources.skillContent")}
                            </FieldLabel>
                            <Textarea
                              id="skill-content"
                              className="max-h-32 min-h-24 resize-y overflow-y-auto font-mono"
                              value={draft.content}
                              onChange={(e) =>
                                setDraft((current) => ({
                                  ...current,
                                  content: e.target.value,
                                }))
                              }
                            />
                          </Field>
                        </fieldset>
                        <div className="grid min-w-0 grid-cols-2 gap-4">
                          <fieldset
                            disabled={importedSkill || remote.pending}
                            className="min-w-0"
                          >
                            <Field>
                              <FieldLabel htmlFor="skill-tags">
                                {t("pages.skills.tags")}
                              </FieldLabel>
                              <SkillTagSelect
                                id="skill-tags"
                                open={tagsOpen}
                                options={availableTags}
                                placeholder={t("pages.skills.tagsPlaceholder")}
                                value={draft.tagIds}
                                onOpenChange={setTagsOpen}
                                onValueChange={(tagIds) => {
                                  setDraft((currentDraft) => ({
                                    ...currentDraft,
                                    tagIds,
                                  }))
                                }}
                              />
                            </Field>
                          </fieldset>
                          <Field className="min-w-0">
                            <FieldLabel htmlFor="skill-authorized-users">
                              {t("pages.models.authorizedScope")}
                            </FieldLabel>
                            <AuthorizationSelect
                              groups={subjects.groups}
                              members={subjects.members}
                              id="skill-authorized-users"
                              disabled={remote.pending}
                              value={authorization}
                              onValueChange={setAuthorization}
                            />
                            {importedSkill && editingSkill.retired && (
                              <p className="text-sm text-amber-700 dark:text-amber-400">
                                {t("resources.retiredGrantsOnly")}
                              </p>
                            )}
                          </Field>
                        </div>
                      </FieldGroup>
                      <ResourceNotice
                        error={remote.error || subjects.error}
                        loading={false}
                        pending={remote.pending}
                      />
                      <Input
                        ref={packageInputRef}
                        accept=".zip,application/zip"
                        aria-label={t("pages.skills.uploadPackage")}
                        aria-invalid={Boolean(packageError)}
                        disabled={
                          importedSkill || packageParsing || remote.pending
                        }
                        id="skill-package"
                        key={fileInputKey}
                        name="package"
                        type="file"
                        className="hidden"
                        onChange={handlePackageChange}
                      />
                      <FieldError>{packageError}</FieldError>
                      {packageAnalysis && packageFile && (
                        <Item size="sm" variant="outline">
                          <ItemMedia variant="icon">
                            <HugeiconsIcon
                              icon={DocumentValidationIcon}
                              strokeWidth={2}
                            />
                          </ItemMedia>
                          <ItemContent className="min-w-0">
                            <ItemTitle>{packageAnalysis.name}</ItemTitle>
                            <ItemDescription title={packageAnalysis.entryPath}>
                              {packageFile.name} · {packageAnalysis.entryPath}
                            </ItemDescription>
                            <ItemDescription>
                              {t("pages.skills.packageSummary", {
                                count: packageAnalysis.fileCount,
                                size: formatBytes(packageAnalysis.unpackedSize),
                              })}
                            </ItemDescription>
                          </ItemContent>
                        </Item>
                      )}
                      <ResourceEditorFooter
                        id="imported-skill-readonly"
                        leading={
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              loading={packageParsing}
                              disabled={
                                importedSkill ||
                                remote.pending ||
                                packageParsing
                              }
                              onClick={() => packageInputRef.current?.click()}
                            >
                              {t("pages.skills.uploadPackage")}
                            </Button>
                            <Button
                              nativeButton={false}
                              variant="outline"
                              render={
                                <a
                                  href={
                                    base + `/skills/${editingSkill.id}/package`
                                  }
                                />
                              }
                            >
                              {t("resources.downloadPackage")}
                            </Button>
                          </div>
                        }
                        reason={
                          importedSkill
                            ? t("resources.importedSkillReadOnly")
                            : undefined
                        }
                      >
                        <DialogClose
                          render={<Button type="button" variant="outline" />}
                        >
                          {t("pages.skills.cancel")}
                        </DialogClose>
                        <Button
                          loading={remote.pending || packageParsing}
                          disabled={
                            remote.pending ||
                            packageParsing ||
                            Boolean(packageError) ||
                            (!editingSkill && packageAnalysis === null)
                          }
                          type="submit"
                        >
                          {editingSkill
                            ? t("pages.skills.save")
                            : t("pages.skills.create")}
                        </Button>
                      </ResourceEditorFooter>
                    </form>
                  ) : (
                    <SkillImportWizard
                      onComplete={() => handleDialogOpenChange(false)}
                      availableTags={availableTags}
                      onImport={async (values) => {
                        for (const value of values) {
                          const form = new FormData()
                          form.set("package", value.packageFile)
                          form.set(
                            "metadata",
                            JSON.stringify({
                              tag_ids: value.tagIds,
                              grants: grants(value.authorization),
                            })
                          )
                          await api(base + "/skills", {
                            method: "POST",
                            body: form,
                          })
                        }
                        await remote.reload()
                      }}
                    />
                  )}
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {skills.map((skill) => {
            const selectable = selecting && skill.type === "system"
            const selected = selectable && selectedIds.includes(skill.id)

            return (
              <ResourceCard
                key={skill.id}
                disabled={!skill.enabled}
                selectable={selectable}
                selected={selected}
                onClick={
                  selectable ? () => toggleSelected(skill.id) : undefined
                }
                onKeyDown={
                  selectable
                    ? (event) => {
                        if (event.target !== event.currentTarget) return
                        if (event.key !== "Enter" && event.key !== " ") return
                        event.preventDefault()
                        toggleSelected(skill.id)
                      }
                    : undefined
                }
                role={selectable ? "checkbox" : undefined}
                aria-checked={selectable ? selected : undefined}
                aria-disabled={selectable && remote.pending ? true : undefined}
                aria-label={
                  selectable
                    ? t("resources.skillBatch.selectSkill", {
                        skill: skill.name,
                      })
                    : undefined
                }
                tabIndex={selectable ? 0 : undefined}
              >
                <CardHeader>
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar size="lg">
                      <AvatarFallback
                        className={
                          skill.type === "user"
                            ? "text-lg font-normal"
                            : undefined
                        }
                      >
                        {skill.type === "system" ? (
                          <HugeiconsIcon
                            icon={DocumentValidationIcon}
                            strokeWidth={2}
                          />
                        ) : (
                          getCreatorInitial(skill.creator)
                        )}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="flex min-w-0 items-center gap-2">
                        <span className="truncate" title={skill.name}>
                          {skill.name}
                        </span>
                        {!skill.enabled && (
                          <Badge variant="outline">
                            {t("pages.skills.disable")}
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription
                        className="truncate"
                        title={skill.creator}
                      >
                        {skill.creator}
                      </CardDescription>
                    </div>
                    {selectable ? (
                      <Checkbox
                        checked={selected}
                        aria-hidden="true"
                        className="pointer-events-none mt-1 bg-background"
                        tabIndex={-1}
                      />
                    ) : skill.type === "system" ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <ResourceCardMenuButton
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
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              disabled={skill.enabled}
                              onClick={() => setSkillEnabled(skill.id, true)}
                            >
                              <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
                              {t("pages.skills.enable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!skill.enabled}
                              onClick={() => setSkillEnabled(skill.id, false)}
                            >
                              <HugeiconsIcon icon={PauseIcon} strokeWidth={2} />
                              {t("pages.skills.disable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleEditSkill(skill)}
                            >
                              <HugeiconsIcon
                                icon={Edit02Icon}
                                strokeWidth={2}
                              />
                              {t("pages.skills.edit")}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={skill.origin === "package"}
                              onClick={() => setSkillPendingDeletion(skill)}
                            >
                              <HugeiconsIcon
                                icon={Delete02Icon}
                                strokeWidth={2}
                              />
                              {t("pages.skills.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent>
                  <p
                    className="truncate text-muted-foreground"
                    title={skill.description}
                  >
                    {skill.description?.trim() || t("resources.noDescription")}
                  </p>
                </CardContent>
                <CardFooter className="min-w-0 border-t">
                  <ResourceTagSummary
                    tagIds={skill.tagIds}
                    leading={
                      <>
                        <ResourceAuthorizationBadge
                          grants={skill.grants}
                          groupNames={authorizationGroupNames}
                          memberNames={authorizationMemberNames}
                          fallback={
                            skill.type === "user" ? skill.creator : undefined
                          }
                        />
                        {skill.origin === "package" && (
                          <ResourcePackageBadge kind="skill" />
                        )}
                      </>
                    }
                  />
                </CardFooter>
              </ResourceCard>
            )
          })}
        </div>
      </ResourceList>

      <AlertDialog
        open={skillPendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSkillPendingDeletion(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.skills.deleteDialogTitle")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t("pages.skills.deleteDialogDescription", {
              skill: skillPendingDeletion?.name ?? "",
            })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remote.pending}>
              {t("pages.skills.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              loading={remote.pending}
              onClick={handleDeleteSkill}
            >
              {t("pages.skills.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
