import { useMemo, useState, type FormEvent } from "react"
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
  id: string
  name: string
  description: string
  prompt: string
  knowledgeBaseIds: string[]
  toolIds: string[]
  ruleIds: string[]
  skillIds: string[]
  authorization: AuthorizationSelection
  enabled: boolean
  updatedAt: string
}

type ExpertForm = Omit<Expert, "id" | "updatedAt" | "enabled">
type AssociationKey = "knowledgeBaseIds" | "toolIds" | "ruleIds" | "skillIds"

type AssociationOption = {
  id: string
  name: string
  description: string
}

const ASSOCIATION_OPTIONS: Record<AssociationKey, AssociationOption[]> = {
  knowledgeBaseIds: [
    {
      id: "kb-product",
      name: "产品文档库",
      description: "产品功能、版本说明与使用指南",
    },
    {
      id: "kb-support",
      name: "客户支持知识库",
      description: "常见问题、工单与标准回复",
    },
    {
      id: "kb-contract",
      name: "合同与制度库",
      description: "合同模板、制度与合规资料",
    },
    {
      id: "kb-engineering",
      name: "研发知识库",
      description: "技术方案、API 文档与故障手册",
    },
  ],
  toolIds: [
    {
      id: "tool-search",
      name: "联网搜索",
      description: "检索公开网络信息",
    },
    {
      id: "tool-code",
      name: "代码执行器",
      description: "运行脚本并分析执行结果",
    },
    {
      id: "tool-database",
      name: "数据查询",
      description: "查询业务数据库与指标",
    },
  ],
  ruleIds: [
    {
      id: "rule-privacy",
      name: "隐私信息保护",
      description: "屏蔽和脱敏敏感信息",
    },
    {
      id: "rule-citation",
      name: "答案引用来源",
      description: "要求回答标注知识来源",
    },
    {
      id: "rule-safe-output",
      name: "安全输出规范",
      description: "限制高风险内容输出",
    },
  ],
  skillIds: [
    {
      id: "skill-report",
      name: "报告生成",
      description: "生成结构化分析报告",
    },
    {
      id: "skill-data-analysis",
      name: "数据分析",
      description: "分析数据并提炼业务洞察",
    },
    {
      id: "skill-document-review",
      name: "文档审查",
      description: "检查文档风险与完整性",
    },
    {
      id: "skill-code-review",
      name: "代码审查",
      description: "识别代码问题并提供修改建议",
    },
  ],
}

const EMPTY_FORM: ExpertForm = {
  name: "",
  description: "",
  prompt: "",
  knowledgeBaseIds: [],
  toolIds: [],
  ruleIds: [],
  skillIds: [],
  authorization: {
    groupIds: ["administrators"],
    memberIds: [],
  },
}

const INITIAL_EXPERTS: Expert[] = [
  {
    id: "expert-product",
    name: "产品顾问",
    description: "解答产品功能、使用方法和最佳实践相关问题。",
    prompt:
      "你是一名资深产品顾问。请基于产品文档提供准确、简洁、可执行的回答，并在必要时给出操作步骤。",
    knowledgeBaseIds: ["kb-product", "kb-support"],
    toolIds: ["tool-search"],
    ruleIds: ["rule-citation", "rule-safe-output"],
    skillIds: ["skill-report"],
    authorization: { groupIds: ["all-members"], memberIds: [] },
    enabled: true,
    updatedAt: "2026-09-02T08:20:00Z",
  },
  {
    id: "expert-data",
    name: "数据分析专家",
    description: "分析业务数据、解释指标变化并生成洞察报告。",
    prompt:
      "你是一名数据分析专家。分析前先确认指标口径，清晰区分事实、推断和建议，并用结构化方式呈现结论。",
    knowledgeBaseIds: ["kb-product"],
    toolIds: ["tool-code", "tool-database"],
    ruleIds: ["rule-privacy"],
    skillIds: ["skill-data-analysis", "skill-report"],
    authorization: {
      groupIds: ["product-and-engineering"],
      memberIds: [],
    },
    enabled: true,
    updatedAt: "2026-09-01T11:35:00Z",
  },
  {
    id: "expert-contract",
    name: "合同审查专家",
    description: "识别合同条款风险，并给出清晰的审查意见。",
    prompt:
      "你是一名合同审查专家。逐项识别权利义务、违约责任、终止条件和争议解决等风险，但不要替代正式法律意见。",
    knowledgeBaseIds: ["kb-contract"],
    toolIds: [],
    ruleIds: ["rule-privacy", "rule-citation", "rule-safe-output"],
    skillIds: ["skill-document-review"],
    authorization: { groupIds: ["administrators"], memberIds: [] },
    enabled: true,
    updatedAt: "2026-08-29T05:10:00Z",
  },
  {
    id: "expert-engineering",
    name: "研发支持专家",
    description: "协助研发团队排查问题、理解接口和审查代码。",
    prompt:
      "你是一名研发支持专家。先复述问题和已知条件，再给出验证步骤、可能原因和修复建议，避免未经验证的确定性结论。",
    knowledgeBaseIds: ["kb-engineering"],
    toolIds: ["tool-search", "tool-code"],
    ruleIds: ["rule-safe-output"],
    skillIds: ["skill-code-review"],
    authorization: { groupIds: ["engineering"], memberIds: [] },
    enabled: false,
    updatedAt: "2026-08-25T02:45:00Z",
  },
]

const ASSOCIATION_SECTIONS: Array<{
  key: AssociationKey
  labelKey: string
}> = [
  { key: "knowledgeBaseIds", labelKey: "knowledgeBases" },
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
  const [experts, setExperts] = useState(INITIAL_EXPERTS)
  const [query, setQuery] = useState("")
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingExpert, setEditingExpert] = useState<Expert | null>(null)
  const [form, setForm] = useState<ExpertForm>(EMPTY_FORM)
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
  const [pendingDeletion, setPendingDeletion] = useState<Expert | null>(null)

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

  const saveExpert = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const updatedAt = new Date().toISOString()

    if (editingExpert) {
      setExperts((current) =>
        current.map((expert) =>
          expert.id === editingExpert.id
            ? { ...expert, ...form, updatedAt }
            : expert
        )
      )
    } else {
      setExperts((current) => [
        {
          ...form,
          id: `expert-${Date.now()}`,
          enabled: true,
          updatedAt,
        },
        ...current,
      ])
    }

    setEditorOpen(false)
  }

  const setExpertEnabled = (id: string, enabled: boolean) => {
    setExperts((current) =>
      current.map((expert) =>
        expert.id === id
          ? { ...expert, enabled, updatedAt: new Date().toISOString() }
          : expert
      )
    )
  }

  const duplicateExpert = (expert: Expert) => {
    setExperts((current) => [
      {
        ...expert,
        id: `expert-${Date.now()}`,
        name: `${expert.name}${t("pages.experts.copySuffix")}`,
        updatedAt: new Date().toISOString(),
      },
      ...current,
    ])
  }

  const deleteExpert = () => {
    if (!pendingDeletion) return
    setExperts((current) =>
      current.filter((expert) => expert.id !== pendingDeletion.id)
    )
    setPendingDeletion(null)
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 p-4 pt-0">
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
                          <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
                          {t("pages.experts.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => duplicateExpert(expert)}
                        >
                          <HugeiconsIcon icon={Copy02Icon} strokeWidth={2} />
                          {t("pages.experts.duplicate")}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
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
                  title={getAuthorizationNames(expert.authorization, t)}
                >
                  {getAuthorizationNames(expert.authorization, t)}
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
                    options={ASSOCIATION_OPTIONS[key]}
                    value={form[key]}
                    onValueChange={(value) => updateForm(key, value)}
                  />
                </Field>
              ))}
              <Field>
                <FieldLabel htmlFor="expert-authorization">
                  {t("pages.experts.authorizedScope")}
                </FieldLabel>
                <AuthorizationSelect
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
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t("pages.experts.cancel")}
              </DialogClose>
              <Button type="submit">
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
