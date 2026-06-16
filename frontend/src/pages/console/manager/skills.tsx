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

import { Api, type DomainTeamGroup, type DomainTeamSkill } from "@/api/Api"
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

export default function TeamManagerSkills() {
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
      toast.error(resp.message || "获取 Skill 列表失败")
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
        toast.success("Skill 已删除")
        return
      }
      toast.error(resp.message || "删除 Skill 失败")
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
            管理团队可用 Skills、标签、说明和可使用分组。
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
                <EmptyTitle>正在加载 Skills</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : skills.length === 0 ? (
            <Empty className="bg-muted">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Sparkles className="size-6" />
                </EmptyMedia>
                <EmptyTitle>暂无 Skills</EmptyTitle>
                <EmptyDescription>添加 Skill 后会显示在这里。</EmptyDescription>
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
                        <span className="text-xs text-muted-foreground">暂无标签</span>
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
                          修改
                        </DropdownMenuItem>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={(event) => event.preventDefault()}
                            >
                              <IconTrash />
                              删除
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确认删除</AlertDialogTitle>
                              <AlertDialogDescription>
                                确定要删除 Skill "{skill.name}" 吗？此操作不可撤销。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(skill.id)}>
                                确认删除
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
                        <span className="text-sm text-muted-foreground">暂无分组</span>
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
      toast.error("请选择扩展包")
      return
    }

    setSubmitting(true)
    const api = new Api()
    void api.api.v1TeamsExtensionPackagesCreate({ file }).then((response) => {
      const resp = response.data
      if (resp.code === 0 && resp.data) {
        toast.success(`${formatExtensionImportResult(resp.data)}，镜像列表已更新`)
        onImported()
        handleOpenChange(false)
        return
      }
      toast.error(resp.message || "导入扩展包失败")
    }).catch((error) => {
      toast.error(error?.message || "导入扩展包失败")
    }).finally(() => {
      setSubmitting(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="size-4" />
          导入扩展包
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导入扩展包</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel>扩展包文件</FieldLabel>
          <FieldContent>
            <Input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              disabled={submitting}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <FieldDescription>
              支持包含 Skills 和镜像归档的 zip 扩展包。
            </FieldDescription>
          </FieldContent>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!file || submitting}>
            {submitting ? "导入中..." : "导入"}
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
      const parsedFile = await parseSkillFile(file)
      setPackageFile(parsedFile.source.type === "zip" ? file : null)
      applyParsedSkill(parsedFile.parsed, parsedFile.source)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Skill 文件解析失败"
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
        label: "粘贴文本",
      })
    } catch (error) {
      setDraft(null)
      setSource(null)
      setParseError(error instanceof Error ? error.message : "Skill 文本解析失败")
    }
  }

  const handleSubmit = () => {
    if (!draft || !source) {
      toast.error("请先上传或粘贴有效的 Skill")
      return
    }

    if (!name.trim()) {
      toast.error("请输入 Skill 名称")
      return
    }

    if (!description.trim()) {
      toast.error("请输入 Skill 描述")
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
        source_type: source.type,
        source_label: source.label,
        skill_md_path: source.skillMdPath,
        file: packageFile,
      }).then((response) => {
        const resp = response.data
        if (resp.code === 0 && resp.data) {
          onCreate(toManagedSkill(resp.data))
          toast.success("Skill 已添加")
          handleOpenChange(false)
          return
        }
        toast.error(resp.message || "添加 Skill 失败")
      }).catch((error) => {
        toast.error(error?.message || "添加 Skill 失败")
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
        toast.success("Skill 已添加")
        handleOpenChange(false)
        return
      }
      toast.error(resp.message || "添加 Skill 失败")
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-4" />
          添加 Skill
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>添加 Skill</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5">
          <Tabs defaultValue="upload">
            <TabsList>
              <TabsTrigger value="upload">
                <Upload className="size-4" />
                上传文件
              </TabsTrigger>
              <TabsTrigger value="paste">
                <ClipboardPaste className="size-4" />
                粘贴文本
              </TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-3">
              <Field>
                <FieldLabel>Skill 文件</FieldLabel>
                <FieldContent>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip,.md,text/markdown"
                    onChange={handleFileChange}
                    disabled={parsing}
                  />
                  <FieldDescription>
                    支持 zip 包或单个 SKILL.md 文件。
                  </FieldDescription>
                </FieldContent>
              </Field>
            </TabsContent>
            <TabsContent value="paste" className="space-y-3">
              <Field>
                <FieldLabel>SKILL.md 内容</FieldLabel>
                <FieldContent>
                  <Textarea
                    value={pastedText}
                    onChange={(event) => handlePastedTextChange(event.target.value)}
                    placeholder="粘贴完整 SKILL.md 内容"
                    className="min-h-40 font-mono text-sm"
                  />
                </FieldContent>
              </Field>
            </TabsContent>
          </Tabs>

          <ParseState source={source} parseError={parseError} parsing={parsing} />

          <SkillMetaForm
            disabled={!formEnabled}
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
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!formEnabled || parsing}>
            提交
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
      toast.error("请输入 Skill 名称")
      return
    }
    if (!description.trim()) {
      toast.error("请输入 Skill 描述")
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
        toast.success("Skill 已修改")
        onOpenChange(false)
        return
      }
      toast.error(resp.message || "修改 Skill 失败")
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>修改 Skill</DialogTitle>
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
            取消
          </Button>
          <Button onClick={handleSubmit}>保存</Button>
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
  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel>名称</FieldLabel>
        <FieldContent>
          <Input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            disabled={disabled}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel>描述</FieldLabel>
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
        <FieldLabel>标签</FieldLabel>
        <FieldContent>
          <Input
            value={tagsText}
            onChange={(event) => onTagsTextChange(event.target.value)}
            disabled={disabled}
            placeholder="前端, 设计"
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel>可使用该 Skill 的分组</FieldLabel>
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
      ? "请选择分组"
      : selectedGroupIds.length === 1
        ? groups.find((group) => group.id === selectedGroupIds[0])?.name || "已选择 1 个分组"
        : `已选择 ${selectedGroupIds.length} 个分组`

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
              <div className="py-6 text-center text-sm text-muted-foreground">暂无分组</div>
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
  source,
  parseError,
  parsing,
}: {
  source: SkillSourceState | null
  parseError: string
  parsing: boolean
}) {
  if (parsing) {
    return (
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        正在解析 Skill...
      </div>
    )
  }

  if (source) {
    return (
      <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
        已解析：{source.label}
        {source.skillMdPath ? ` · ${source.skillMdPath}` : ""}
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

  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      请选择文件或粘贴完整 SKILL.md 内容。
    </div>
  )
}

function SkillSourceIcon({ type }: { type: SkillSourceType }) {
  if (type === "zip") {
    return <FileArchive className="size-4" />
  }
  return <FileText className="size-4" />
}

async function parseSkillFile(file: File): Promise<{
  parsed: ParsedSkillMarkdown
  source: SkillSourceState
}> {
  const lowerName = file.name.toLowerCase()

  if (lowerName.endsWith(".zip")) {
    const { default: JSZip } = await import("jszip")
    const zip = await JSZip.loadAsync(file)
    const skillMdPath = findSkillMarkdownPath(Object.keys(zip.files))
    if (!skillMdPath) {
      throw new Error("zip 包中未找到 SKILL.md")
    }

    const skillFile = zip.files[skillMdPath]
    if (!skillFile || skillFile.dir) {
      throw new Error("zip 包中的 SKILL.md 无法读取")
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

  throw new Error("仅支持 zip 包或 SKILL.md 文件")
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
