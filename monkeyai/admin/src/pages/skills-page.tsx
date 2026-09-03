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
import {
  Card,
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
  DialogFooter,
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
  FieldDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useSkillTags } from "@/hooks/use-skill-tags"
import {
  getAuthorizationNames,
  type AuthorizationSelection,
} from "@/lib/authorization-groups"
import {
  inspectSkillPackage,
  SkillPackageError,
  type SkillPackageAnalysis,
} from "@/lib/skill-package"
import { cn } from "@/lib/utils"

type SkillType = "system" | "user"

type AgentSkill = {
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

const ADMIN_CREATOR = "MonkeyAI Admin"
const EMPTY_SKILL_DRAFT: SkillDraft = {
  name: "",
  description: "",
  content: "",
  tagIds: [],
}

const INITIAL_SKILLS: AgentSkill[] = [
  {
    id: "skill-code-review",
    name: "code-review",
    description: "系统化检查代码质量、潜在缺陷、安全风险和可维护性问题。",
    content:
      "# Code Review\n\n审查代码时优先识别正确性、安全性和兼容性问题，并给出可执行的修改建议。",
    tagIds: ["code", "review", "security"],
    type: "system",
    creator: ADMIN_CREATOR,
    authorization: {
      groupIds: ["engineering"],
      memberIds: [],
    },
    enabled: true,
    packageFileName: "code-review.zip",
    fileCount: 4,
  },
  {
    id: "skill-data-analysis",
    name: "data-analysis",
    description: "分析结构化数据，发现趋势、异常和可以支持业务决策的关键结论。",
    content:
      "# Data Analysis\n\n先确认数据口径，再进行清洗、分析和验证，最终给出带依据的结论。",
    tagIds: ["data", "analysis"],
    type: "system",
    creator: ADMIN_CREATOR,
    authorization: {
      groupIds: ["product", "engineering", "operations"],
      memberIds: [],
    },
    enabled: true,
    packageFileName: "data-analysis.zip",
    fileCount: 6,
  },
  {
    id: "skill-product-copy",
    name: "product-copywriting",
    description: "根据产品定位和目标受众撰写清晰、准确且一致的产品文案。",
    content:
      "# Product Copywriting\n\n围绕用户价值组织内容，保持表达简洁，并避免无法验证的承诺。",
    tagIds: ["product", "copywriting"],
    type: "system",
    creator: ADMIN_CREATOR,
    authorization: {
      groupIds: ["product"],
      memberIds: [],
    },
    enabled: true,
    packageFileName: "product-copywriting.zip",
    fileCount: 3,
  },
  {
    id: "skill-incident-response",
    name: "incident-response",
    description: "协助定位线上故障、整理影响范围并生成可执行的应急处置步骤。",
    content:
      "# Incident Response\n\n先控制影响范围，再收集证据和定位根因，所有高风险操作必须明确说明。",
    tagIds: ["operations", "incident-response"],
    type: "system",
    creator: ADMIN_CREATOR,
    authorization: {
      groupIds: ["engineering", "operations"],
      memberIds: [],
    },
    enabled: false,
    packageFileName: "incident-response.zip",
    fileCount: 5,
  },
  {
    id: "skill-user-weekly-report",
    name: "weekly-report",
    description: "将本周工作记录整理成重点清晰、便于同步的周报。",
    content: "# Weekly Report\n\n按完成事项、进展、风险和下周计划组织周报。",
    tagIds: ["weekly-report", "writing"],
    type: "user",
    creator: "陈晨",
    authorization: {
      groupIds: [],
      memberIds: ["member-01"],
    },
    enabled: true,
    packageFileName: "weekly-report.zip",
    fileCount: 2,
  },
  {
    id: "skill-user-research-notes",
    name: "research-notes",
    description: "把零散的访谈和调研材料归纳为主题、证据与待验证假设。",
    content:
      "# Research Notes\n\n区分事实、观察和推断，并为每项结论保留信息来源。",
    tagIds: ["research", "notes"],
    type: "user",
    creator: "林玫",
    authorization: {
      groupIds: [],
      memberIds: ["member-04"],
    },
    enabled: true,
    packageFileName: "research-notes.zip",
    fileCount: 3,
  },
]

function getCreatorInitials(creator: string) {
  return creator.trim().slice(0, 2).toUpperCase()
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
  const { t } = useTranslation()
  const { tags: availableTags } = useSkillTags()
  const [skills, setSkills] = useState(INITIAL_SKILLS)
  const [activeSkillType, setActiveSkillType] = useState<SkillType>("system")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null)
  const [skillPendingDeletion, setSkillPendingDeletion] =
    useState<AgentSkill | null>(null)
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({
    groupIds: ["all-members"],
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
  const editingSkill = skills.find((skill) => skill.id === editingSkillId)

  const resetSkillOptions = () => {
    packageRequestId.current += 1
    setAuthorizationOpen(false)
    setTagsOpen(false)
    setAuthorization({ groupIds: ["all-members"], memberIds: [] })
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
      setEditingSkillId(null)
      resetSkillOptions()
    }
  }

  const handleEditSkill = (skill: AgentSkill) => {
    if (skill.type !== "system") {
      return
    }

    setEditingSkillId(skill.id)
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
    setAuthorizationOpen(false)
    setTagsOpen(false)
    setDialogOpen(true)
  }

  const handlePackageChange = async (event: ChangeEvent<HTMLInputElement>) => {
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
        content: analysis.content,
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

  const setSkillEnabled = (skillId: string, enabled: boolean) => {
    setSkills((currentSkills) =>
      currentSkills.map((skill) =>
        skill.id === skillId && skill.type === "system"
          ? { ...skill, enabled }
          : skill
      )
    )
  }

  const handleSubmitSkill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const name = draft.name.trim()
    const description = draft.description.trim()
    const content = draft.content.trim()
    const tagIds = draft.tagIds.filter((tagId) =>
      availableTags.some((tag) => tag.id === tagId)
    )

    if (
      !name ||
      !description ||
      !content ||
      Boolean(packageError) ||
      (!editingSkill && (!packageFile || !packageAnalysis)) ||
      authorization.groupIds.length + authorization.memberIds.length === 0 ||
      editingSkill?.type === "user"
    ) {
      return
    }

    if (editingSkill) {
      setSkills((currentSkills) =>
        currentSkills.map((skill) =>
          skill.id === editingSkill.id
            ? {
                ...skill,
                name,
                description,
                content,
                tagIds,
                authorization,
                packageFileName: packageFile?.name ?? skill.packageFileName,
                fileCount: packageAnalysis?.fileCount ?? skill.fileCount,
              }
            : skill
        )
      )
    } else {
      if (!packageFile || !packageAnalysis) {
        return
      }

      setSkills((currentSkills) => [
        ...currentSkills,
        {
          id: `skill-${Date.now()}`,
          name,
          description,
          content,
          tagIds,
          type: "system",
          creator: ADMIN_CREATOR,
          authorization,
          enabled: true,
          packageFileName: packageFile.name,
          fileCount: packageAnalysis.fileCount,
        },
      ])
    }

    handleDialogOpenChange(false)
  }

  const handleDeleteSkill = () => {
    if (!skillPendingDeletion || skillPendingDeletion.type !== "system") {
      return
    }

    setSkills((currentSkills) =>
      currentSkills.filter((skill) => skill.id !== skillPendingDeletion.id)
    )
    setSkillPendingDeletion(null)
  }

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <Tabs
        className="gap-4"
        value={activeSkillType}
        onValueChange={(value) => {
          setActiveSkillType(value as SkillType)
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label={t("pages.skills.type")}>
            <TabsTrigger value="system">
              {t("pages.skills.systemSkill")}
            </TabsTrigger>
            <TabsTrigger value="user">
              {t("pages.skills.userSkill")}
            </TabsTrigger>
          </TabsList>

          {activeSkillType === "system" && (
            <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
              <DialogTrigger
                render={
                  <Button
                    onClick={() => {
                      setEditingSkillId(null)
                      resetSkillOptions()
                    }}
                  />
                }
              >
                <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                {t("pages.skills.add")}
              </DialogTrigger>
              <DialogContent
                className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
                closeLabel={t("common.close")}
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
                    <FieldGroup className="gap-5">
                      <Field data-invalid={Boolean(packageError)}>
                        <FieldLabel htmlFor="skill-package">
                          {t("pages.skills.skillPackage")}
                        </FieldLabel>
                        <Input
                          accept=".zip,application/zip"
                          aria-invalid={Boolean(packageError)}
                          disabled={packageParsing}
                          id="skill-package"
                          key={fileInputKey}
                          name="package"
                          type="file"
                          onChange={handlePackageChange}
                        />
                        <FieldDescription>
                          {packageParsing
                            ? t("pages.skills.packageParsing")
                            : editingSkill
                              ? t("pages.skills.packageOptionalHint")
                              : t("pages.skills.packageHint")}
                        </FieldDescription>
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
                              <ItemDescription
                                title={packageAnalysis.entryPath}
                              >
                                {packageFile.name} · {packageAnalysis.entryPath}
                              </ItemDescription>
                              <ItemDescription>
                                {t("pages.skills.packageSummary", {
                                  count: packageAnalysis.fileCount,
                                  size: formatBytes(
                                    packageAnalysis.unpackedSize
                                  ),
                                })}
                              </ItemDescription>
                            </ItemContent>
                          </Item>
                        )}
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="skill-name">
                          {t("pages.skills.name")}
                        </FieldLabel>
                        <Input
                          aria-readonly="true"
                          id="skill-name"
                          placeholder={t("pages.skills.namePlaceholder")}
                          readOnly
                          required
                          value={draft.name}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="skill-description">
                          {t("pages.skills.skillDescription")}
                        </FieldLabel>
                        <Textarea
                          aria-readonly="true"
                          className="max-h-32 min-h-20 resize-none overflow-y-auto"
                          id="skill-description"
                          placeholder={t(
                            "pages.skills.skillDescriptionPlaceholder"
                          )}
                          readOnly
                          required
                          value={draft.description}
                        />
                      </Field>
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
                      <Field>
                        <FieldLabel htmlFor="skill-authorized-users">
                          {t("pages.skills.authorizedUsers")}
                        </FieldLabel>
                        <AuthorizationSelect
                          id="skill-authorized-users"
                          open={authorizationOpen}
                          placeholder={t(
                            "pages.skills.authorizationPlaceholder"
                          )}
                          title={t("pages.skills.authorizedUsers")}
                          value={authorization}
                          onOpenChange={setAuthorizationOpen}
                          onValueChange={setAuthorization}
                        />
                      </Field>
                    </FieldGroup>
                    <DialogFooter>
                      <DialogClose
                        render={<Button type="button" variant="outline" />}
                      >
                        {t("pages.skills.cancel")}
                      </DialogClose>
                      <Button
                        disabled={
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
                    </DialogFooter>
                  </form>
                ) : (
                  <SkillImportWizard
                    availableTags={availableTags}
                    onImport={(imports) => {
                      const importedAt = Date.now()
                      setSkills((currentSkills) => [
                        ...currentSkills,
                        ...imports.map((value, index) => ({
                          id: `skill-${importedAt}-${index}`,
                          name: value.analysis.name,
                          description: value.analysis.description,
                          content: value.analysis.content,
                          tagIds: value.tagIds,
                          type: "system" as const,
                          creator: ADMIN_CREATOR,
                          authorization: value.authorization,
                          enabled: true,
                          packageFileName: value.sourceName,
                          fileCount: value.analysis.fileCount,
                        })),
                      ])
                      handleDialogOpenChange(false)
                    }}
                  />
                )}
              </DialogContent>
            </Dialog>
          )}
        </div>

        {(["system", "user"] as const).map((tabType) => (
          <TabsContent key={tabType} value={tabType}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {skills
                .filter((skill) => skill.type === tabType)
                .map((skill) => {
                  const authorizationNames = getAuthorizationNames(
                    skill.authorization,
                    t
                  )
                  const tagNames = availableTags
                    .filter((tag) => skill.tagIds.includes(tag.id))
                    .map((tag) => tag.name)
                    .join(", ")

                  return (
                    <Card
                      className={cn(!skill.enabled && "bg-muted")}
                      key={skill.id}
                    >
                      <CardHeader>
                        <div className="flex min-w-0 items-start gap-3">
                          <Avatar size="lg">
                            <AvatarFallback>
                              {skill.creator === ADMIN_CREATOR ? (
                                <HugeiconsIcon
                                  icon={DocumentValidationIcon}
                                  strokeWidth={2}
                                />
                              ) : (
                                getCreatorInitials(skill.creator)
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
                          {skill.type === "system" && (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    aria-label={t("common.more")}
                                    size="icon-sm"
                                    type="button"
                                    variant="ghost"
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
                                    onClick={() =>
                                      setSkillEnabled(skill.id, true)
                                    }
                                  >
                                    <HugeiconsIcon
                                      icon={PlayIcon}
                                      strokeWidth={2}
                                    />
                                    {t("pages.skills.enable")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={!skill.enabled}
                                    onClick={() =>
                                      setSkillEnabled(skill.id, false)
                                    }
                                  >
                                    <HugeiconsIcon
                                      icon={PauseIcon}
                                      strokeWidth={2}
                                    />
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
                                    onClick={() =>
                                      setSkillPendingDeletion(skill)
                                    }
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
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3">
                        <p
                          className="truncate text-muted-foreground"
                          title={skill.description}
                        >
                          {skill.description}
                        </p>
                        <div className="flex min-w-0 items-center gap-4">
                          <span className="w-2/5 truncate text-muted-foreground">
                            {t("pages.skills.tags")}
                          </span>
                          <span
                            className="w-3/5 truncate text-end font-medium"
                            title={tagNames || t("pages.skills.noTags")}
                          >
                            {tagNames || t("pages.skills.noTags")}
                          </span>
                        </div>
                      </CardContent>
                      <CardFooter className="min-w-0 gap-4 border-t">
                        <span
                          className="w-2/5 truncate text-muted-foreground"
                          title={t("pages.skills.authorizedUsers")}
                        >
                          {t("pages.skills.authorizedUsers")}
                        </span>
                        <span
                          className="w-3/5 truncate text-end font-medium"
                          title={authorizationNames}
                        >
                          {authorizationNames}
                        </span>
                      </CardFooter>
                    </Card>
                  )
                })}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      <AlertDialog
        open={skillPendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSkillPendingDeletion(null)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.skills.deleteDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.skills.deleteDialogDescription", {
                skill: skillPendingDeletion?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("pages.skills.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
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
