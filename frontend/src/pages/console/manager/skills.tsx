import { useEffect, useRef, useState, type ChangeEvent } from "react"
import {
  ClipboardPaste,
  FileArchive,
  FileText,
  MoreVertical,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react"
import { IconPencil, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import { Api, type DomainTeamGroup, type GithubComChaitinMonkeyCodeBackendDomainTeamSkill as DomainTeamSkill } from "@/api/Api"
import {
  findSkillMarkdownPath,
  normalizeSkillTags,
  parseSkillMarkdown,
  type ParsedSkillMarkdown,
} from "@/components/manager/skill-package"
import { formatExtensionImportResult } from "@/pages/console/manager/extension-package"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { apiRequest } from "@/utils/requestUtils"
import { useTranslation } from "react-i18next"

type SkillSourceType = "zip" | "markdown" | "text"

interface ManagedSkill {
  id: string
  name: string
  description: string
  tags: string[]
  groups: DomainTeamGroup[]
  sourceType: SkillSourceType
  sourceLabel: string
  skillMdPath?: string
  createdAt: number
  updatedAt: number
}

interface SkillSourceState {
  type: SkillSourceType
  label: string
  skillMdPath?: string
}

type Translate = (key: string, options?: Record<string, unknown>) => string

export default function TeamManagerSkills() {
  const { t } = useTranslation()
  const [skills, setSkills] = useState<ManagedSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [extensionDialogOpen, setExtensionDialogOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<ManagedSkill | null>(null)

  const fetchSkills = async () => {
    setLoading(true)
    await apiRequest("v1TeamsSkillsList", {}, [], (resp) => {
      if (resp.code === 0) {
        setSkills((resp.data?.skills || []).map(toManagedSkill))
        return
      }
      toast.error(resp.message || t("managerSkills.toast.fetchFailed"))
    })
    setLoading(false)
  }

  useEffect(() => {
    void fetchSkills()
  }, [])

  const handleCreate = (skill: ManagedSkill) => {
    setSkills((prev) => [skill, ...prev])
  }

  const handleUpdate = (skill: ManagedSkill) => {
    setSkills((prev) => prev.map((item) => (item.id === skill.id ? skill : item)))
  }

  const handleDelete = (skillID: string) => {
    void apiRequest("v1TeamsSkillsDelete", {}, [skillID], (resp) => {
      if (resp.code === 0) {
        setSkills((prev) => prev.filter((skill) => skill.id !== skillID))
        toast.success(t("managerSkills.toast.deleted"))
        return
      }
      toast.error(resp.message || t("managerSkills.toast.deleteFailed"))
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles />
            Skills
          </CardTitle>
          <CardDescription>
            {t("managerSkills.description")}
          </CardDescription>
          <CardAction>
            <div className="flex flex-wrap justify-end gap-2">
              <ExtensionPackageImportDialog
                open={extensionDialogOpen}
                onOpenChange={setExtensionDialogOpen}
                onImported={() => {
                  void fetchSkills()
                }}
              />
              <AddSkillDialog
                open={addDialogOpen}
                onOpenChange={setAddDialogOpen}
                onCreate={handleCreate}
              />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Empty className="bg-muted">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Sparkles className="size-6" />
                </EmptyMedia>
                <EmptyTitle>{t("managerSkills.empty.loading")}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : skills.length === 0 ? (
            <Empty className="bg-muted">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Sparkles className="size-6" />
                </EmptyMedia>
                <EmptyTitle>{t("managerSkills.empty.title")}</EmptyTitle>
                <EmptyDescription>{t("managerSkills.empty.description")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="flex flex-col gap-4">
              {skills.map((skill) => (
                <Item key={skill.id} variant="outline" className="hover:border-primary/30" size="sm">
                  <ItemMedia className="hidden md:flex">
                    <Avatar>
                      <AvatarFallback>
                        <SkillSourceIcon type={skill.sourceType} />
                      </AvatarFallback>
                    </Avatar>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="break-all">{skill.name}</ItemTitle>
                    <ItemDescription className="line-clamp-2">
                      {skill.description}
                    </ItemDescription>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {skill.tags.length > 0 ? (
                        skill.tags.map((tag) => (
                          <Badge variant="secondary" key={tag}>
                            {tag}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("managerSkills.empty.noTags")}</span>
                      )}
                    </div>
                  </ItemContent>
                  <ItemActions>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm">
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditingSkill(skill)}>
                          <IconPencil />
                          {t("managerSkills.actions.edit")}
                        </DropdownMenuItem>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={(event) => event.preventDefault()}
                            >
                              <IconTrash />
                              {t("managerSkills.actions.delete")}
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("managerSkills.dialogs.delete.title")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("managerSkills.dialogs.delete.description", { name: skill.name })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("managerShell.common.cancel")}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(skill.id)}>
                                {t("managerSkills.dialogs.delete.confirm")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                  <ItemFooter className="flex flex-col items-start gap-2">
                    <Separator />
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{skill.sourceLabel}</Badge>
                      {skill.skillMdPath ? (
                        <Badge variant="outline">{skill.skillMdPath}</Badge>
                      ) : null}
                      {skill.groups.length > 0 ? (
                        skill.groups.map((group) => (
                          <Badge variant="outline" key={group.id}>
                            {group.name}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">{t("managerSkills.empty.noGroups")}</span>
                      )}
                    </div>
                  </ItemFooter>
                </Item>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
      <EditSkillDialog
        skill={editingSkill}
        open={!!editingSkill}
        onOpenChange={(open) => {
          if (!open) setEditingSkill(null)
        }}
        onUpdate={handleUpdate}
      />
    </div>
  )
}

function ExtensionPackageImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setFile(null)
    setSubmitting(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  const handleSubmit = () => {
    if (!file) {
      toast.error(t("managerSkills.toast.extensionRequired"))
      return
    }

    setSubmitting(true)
    const api = new Api()
    void api.api.v1TeamsExtensionPackagesCreate({ file }).then((response) => {
      const resp = response.data
      if (resp.code === 0 && resp.data) {
        toast.success(t("managerSkills.extensionImport.success", {
          summary: formatExtensionImportResult(resp.data, (key, options) => t(key, options)),
        }))
        onImported()
        handleOpenChange(false)
        return
      }
      toast.error(resp.message || t("managerSkills.toast.extensionImportFailed"))
    }).catch((error) => {
      toast.error(error?.message || t("managerSkills.toast.extensionImportFailed"))
    }).finally(() => {
      setSubmitting(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="size-4" />
          {t("managerSkills.extensionImport.action")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("managerSkills.extensionImport.title")}</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel>{t("managerSkills.extensionImport.file")}</FieldLabel>
          <FieldContent>
            <Input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              disabled={submitting}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <FieldDescription>
              {t("managerSkills.extensionImport.description")}
            </FieldDescription>
          </FieldContent>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            {t("managerShell.common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!file || submitting}>
            {submitting ? t("managerSkills.extensionImport.importing") : t("managerSkills.extensionImport.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddSkillDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (skill: ManagedSkill) => void
}) {
  const { t } = useTranslation()
  const translate = (key: string, options?: Record<string, unknown>) => t(key, options)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState("")
  const [pastedText, setPastedText] = useState("")
  const [packageFile, setPackageFile] = useState<File | null>(null)
  const [source, setSource] = useState<SkillSourceState | null>(null)
  const [draft, setDraft] = useState<ParsedSkillMarkdown | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [tagsText, setTagsText] = useState("")
  const [groups, setGroups] = useState<DomainTeamGroup[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])

  const formEnabled = !!draft

  useEffect(() => {
    if (open) {
      fetchGroups(setGroups)
    }
  }, [open])

  const reset = () => {
    setParsing(false)
    setParseError("")
    setPastedText("")
    setPackageFile(null)
    setSource(null)
    setDraft(null)
    setName("")
    setDescription("")
    setTagsText("")
    setSelectedGroupIds([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  const applyParsedSkill = (parsed: ParsedSkillMarkdown, nextSource: SkillSourceState) => {
    setDraft(parsed)
    setSource(nextSource)
    setName(parsed.name)
    setDescription(parsed.description)
    setTagsText(parsed.tags.join(", "))
    setParseError("")
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setParsing(true)
    try {
      const parsedFile = await parseSkillFile(file, translate)
      setPackageFile(parsedFile.source.type === "zip" ? file : null)
      applyParsedSkill(parsedFile.parsed, parsedFile.source)
    } catch (error) {
      const message = error instanceof Error ? error.message : t("managerSkills.parse.fileFailed")
      setDraft(null)
      setPackageFile(null)
      setSource(null)
      setParseError(message)
      toast.error(message)
    } finally {
      setParsing(false)
    }
  }

  const handlePastedTextChange = (value: string) => {
    setPastedText(value)

    if (!value.trim()) {
      setDraft(null)
      setPackageFile(null)
      setSource(null)
      setParseError("")
      return
    }

    try {
      setPackageFile(null)
      applyParsedSkill(parseSkillMarkdown(value), {
        type: "text",
        label: t("managerSkills.source.pastedText"),
      })
    } catch (error) {
      setDraft(null)
      setSource(null)
      setParseError(error instanceof Error ? error.message : t("managerSkills.parse.textFailed"))
    }
  }

  const handleSubmit = () => {
    if (!draft || !source) {
      toast.error(t("managerSkills.toast.validSkillRequired"))
      return
    }

    if (!name.trim()) {
      toast.error(t("managerSkills.toast.nameRequired"))
      return
    }

    if (!description.trim()) {
      toast.error(t("managerSkills.toast.descriptionRequired"))
      return
    }

    const tags = normalizeSkillTags(tagsText)
    if (source.type === "zip" && packageFile) {
      const api = new Api()
      void api.api.v1TeamsSkillsPackageCreate({
        name: name.trim(),
        description: description.trim(),
        tags: JSON.stringify(tags),
        content: draft.content,
        group_ids: JSON.stringify(selectedGroupIds),
        skill_md_path: source.skillMdPath,
        file: packageFile,
      }).then((response) => {
        const resp = response.data
        if (resp.code === 0 && resp.data) {
          onCreate(toManagedSkill(resp.data))
          toast.success(t("managerSkills.toast.added"))
          handleOpenChange(false)
          return
        }
        toast.error(resp.message || t("managerSkills.toast.addFailed"))
      }).catch((error) => {
        toast.error(error?.message || t("managerSkills.toast.addFailed"))
      })
      return
    }

    void apiRequest("v1TeamsSkillsCreate", {
      name: name.trim(),
      description: description.trim(),
      tags,
      content: draft.content,
      group_ids: selectedGroupIds,
      source_type: source.type,
      source_label: source.label,
      skill_md_path: source.skillMdPath,
    }, [], (resp) => {
      if (resp.code === 0 && resp.data) {
        onCreate(toManagedSkill(resp.data))
        toast.success(t("managerSkills.toast.added"))
        handleOpenChange(false)
        return
      }
      toast.error(resp.message || t("managerSkills.toast.addFailed"))
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-4" />
          {t("managerSkills.actions.add")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("managerSkills.dialogs.add.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5">
          <Tabs defaultValue="paste">
            <TabsList>
              <TabsTrigger value="paste">
                <ClipboardPaste className="size-4" />
                {t("managerSkills.tabs.paste")}
              </TabsTrigger>
              <TabsTrigger value="upload">
                <Upload className="size-4" />
                {t("managerSkills.tabs.upload")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="paste" className="space-y-3">
              <Field>
                <FieldLabel>{t("managerSkills.fields.skillContent")}</FieldLabel>
                <FieldContent>
                  <Textarea
                    value={pastedText}
                    onChange={(event) => handlePastedTextChange(event.target.value)}
                    placeholder={t("managerSkills.fields.skillContentPlaceholder")}
                    className="min-h-40 font-mono text-sm"
                  />
                </FieldContent>
              </Field>
            </TabsContent>
            <TabsContent value="upload" className="space-y-3">
              <Field>
                <FieldLabel>{t("managerSkills.fields.skillFile")}</FieldLabel>
                <FieldContent>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip,.md,text/markdown"
                    onChange={handleFileChange}
                    disabled={parsing}
                  />
                  <FieldDescription>
                    {t("managerSkills.fields.skillFileDescription")}
                  </FieldDescription>
                </FieldContent>
              </Field>
            </TabsContent>
          </Tabs>

          <ParseState parseError={parseError} parsing={parsing} />

          <SkillMetaForm
            disabled={false}
            name={name}
            description={description}
            tagsText={tagsText}
            groups={groups}
            selectedGroupIds={selectedGroupIds}
            onNameChange={setName}
            onDescriptionChange={setDescription}
            onTagsTextChange={setTagsText}
            onSelectedGroupIdsChange={setSelectedGroupIds}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t("managerShell.common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!formEnabled || parsing}>
            {t("managerSkills.actions.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditSkillDialog({
  skill,
  open,
  onOpenChange,
  onUpdate,
}: {
  skill: ManagedSkill | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (skill: ManagedSkill) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [tagsText, setTagsText] = useState("")
  const [groups, setGroups] = useState<DomainTeamGroup[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])

  useEffect(() => {
    if (!skill) return
    setName(skill.name)
    setDescription(skill.description)
    setTagsText(skill.tags.join(", "))
    setSelectedGroupIds(skill.groups.map((group) => group.id || "").filter(Boolean))
  }, [skill])

  useEffect(() => {
    if (open) {
      fetchGroups(setGroups)
    }
  }, [open])

  const handleSubmit = () => {
    if (!skill) return
    if (!name.trim()) {
      toast.error(t("managerSkills.toast.nameRequired"))
      return
    }
    if (!description.trim()) {
      toast.error(t("managerSkills.toast.descriptionRequired"))
      return
    }

    void apiRequest("v1TeamsSkillsUpdate", {
      name: name.trim(),
      description: description.trim(),
      tags: normalizeSkillTags(tagsText),
      group_ids: selectedGroupIds,
    }, [skill.id], (resp) => {
      if (resp.code === 0 && resp.data) {
        onUpdate(toManagedSkill(resp.data))
        toast.success(t("managerSkills.toast.updated"))
        onOpenChange(false)
        return
      }
      toast.error(resp.message || t("managerSkills.toast.updateFailed"))
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("managerSkills.dialogs.edit.title")}</DialogTitle>
        </DialogHeader>
        <SkillMetaForm
          disabled={!skill}
          name={name}
          description={description}
          tagsText={tagsText}
          groups={groups}
          selectedGroupIds={selectedGroupIds}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          onTagsTextChange={setTagsText}
          onSelectedGroupIdsChange={setSelectedGroupIds}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("managerShell.common.cancel")}
          </Button>
          <Button onClick={handleSubmit}>{t("managerSkills.actions.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SkillMetaForm({
  disabled,
  name,
  description,
  tagsText,
  groups,
  selectedGroupIds,
  onNameChange,
  onDescriptionChange,
  onTagsTextChange,
  onSelectedGroupIdsChange,
}: {
  disabled: boolean
  name: string
  description: string
  tagsText: string
  groups: DomainTeamGroup[]
  selectedGroupIds: string[]
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onTagsTextChange: (value: string) => void
  onSelectedGroupIdsChange: (value: string[]) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel>{t("managerSkills.fields.name")}</FieldLabel>
        <FieldContent>
          <Input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            disabled={disabled}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel>{t("managerSkills.fields.description")}</FieldLabel>
        <FieldContent>
          <Textarea
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            disabled={disabled}
            className="min-h-24"
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel>{t("managerSkills.fields.tags")}</FieldLabel>
        <FieldContent>
          <Input
            value={tagsText}
            onChange={(event) => onTagsTextChange(event.target.value)}
            disabled={disabled}
            placeholder={t("managerSkills.fields.tagsPlaceholder")}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel>{t("managerSkills.fields.groups")}</FieldLabel>
        <FieldContent>
          <GroupMultiSelect
            disabled={disabled}
            groups={groups}
            selectedGroupIds={selectedGroupIds}
            onSelectedGroupIdsChange={onSelectedGroupIdsChange}
          />
        </FieldContent>
      </Field>
    </div>
  )
}

function GroupMultiSelect({
  disabled,
  groups,
  selectedGroupIds,
  onSelectedGroupIdsChange,
}: {
  disabled: boolean
  groups: DomainTeamGroup[]
  selectedGroupIds: string[]
  onSelectedGroupIdsChange: (value: string[]) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selectRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open])

  const toggleGroup = (groupID: string, checked: boolean) => {
    if (checked) {
      onSelectedGroupIdsChange([...selectedGroupIds, groupID])
      return
    }
    onSelectedGroupIdsChange(selectedGroupIds.filter((id) => id !== groupID))
  }

  const selectedLabel =
    selectedGroupIds.length === 0
      ? t("managerSkills.group.selectPlaceholder")
      : selectedGroupIds.length === 1
        ? groups.find((group) => group.id === selectedGroupIds[0])?.name || t("managerSkills.group.selectedOne")
        : t("managerSkills.group.selectedMany", { count: selectedGroupIds.length })

  return (
    <div className="relative" ref={selectRef}>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="w-full justify-between"
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <span className="truncate">{selectedLabel}</span>
        <span className={cn("ml-2 text-xs text-muted-foreground transition-transform", open && "rotate-180")}>
          ▼
        </span>
      </Button>
      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="max-h-[300px] overflow-auto p-1">
            {groups.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{t("managerSkills.empty.noGroups")}</div>
            ) : (
              groups.map((group) => {
                const groupID = group.id || ""
                const checked = selectedGroupIds.includes(groupID)
                return (
                  <div
                    key={groupID}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
                    onClick={() => toggleGroup(groupID, !checked)}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(nextChecked) => toggleGroup(groupID, !!nextChecked)}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <span className="truncate text-sm">{group.name}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ParseState({
  parseError,
  parsing,
}: {
  parseError: string
  parsing: boolean
}) {
  const { t } = useTranslation()

  if (parsing) {
    return (
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {t("managerSkills.parse.parsing")}
      </div>
    )
  }

  if (parseError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {parseError}
      </div>
    )
  }

  return null
}

function SkillSourceIcon({ type }: { type: SkillSourceType }) {
  if (type === "zip") {
    return <FileArchive className="size-4" />
  }
  return <FileText className="size-4" />
}

async function parseSkillFile(file: File, t: Translate): Promise<{
  parsed: ParsedSkillMarkdown
  source: SkillSourceState
}> {
  const lowerName = file.name.toLowerCase()

  if (lowerName.endsWith(".zip")) {
    const { default: JSZip } = await import("jszip")
    const zip = await JSZip.loadAsync(file)
    const skillMdPath = findSkillMarkdownPath(Object.keys(zip.files))
    if (!skillMdPath) {
      throw new Error(t("managerSkills.parse.readingZipMissing"))
    }

    const skillFile = zip.files[skillMdPath]
    if (!skillFile || skillFile.dir) {
      throw new Error(t("managerSkills.parse.readingZipFailed"))
    }

    return {
      parsed: parseSkillMarkdown(await skillFile.async("string")),
      source: {
        type: "zip",
        label: file.name,
        skillMdPath,
      },
    }
  }

  if (lowerName.endsWith(".md") || file.name === "SKILL.md" || file.type === "text/markdown") {
    return {
      parsed: parseSkillMarkdown(await file.text()),
      source: {
        type: "markdown",
        label: file.name || "SKILL.md",
      },
    }
  }

  throw new Error(t("managerSkills.parse.unsupportedFile"))
}

function fetchGroups(setGroups: (groups: DomainTeamGroup[]) => void) {
  void apiRequest("v1TeamsGroupsList", {}, [], (resp) => {
    if (resp.code === 0) {
      setGroups(resp.data?.groups || [])
    }
  })
}

function toManagedSkill(skill: DomainTeamSkill): ManagedSkill {
  return {
    id: skill.id || "",
    name: skill.name || "",
    description: skill.description || "",
    tags: skill.tags || [],
    groups: skill.groups || [],
    sourceType: toSkillSourceType(skill.source_type),
    sourceLabel: skill.source_label || "SKILL.md",
    skillMdPath: skill.skill_md_path,
    createdAt: skill.created_at || 0,
    updatedAt: skill.updated_at || 0,
  }
}

function toSkillSourceType(value: unknown): SkillSourceType {
  if (value === "zip" || value === "markdown" || value === "text") {
    return value
  }
  return "markdown"
}
