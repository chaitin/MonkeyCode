import { useMemo, useState, type FormEvent } from "react"
import {
  AlertCircleIcon,
  BookOpenTextIcon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Edit02Icon,
  File01Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
  TextIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

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
  CardAction,
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
  DialogDescription,
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
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useSkillTags } from "@/hooks/use-skill-tags"
import {
  getAuthorizationNames,
  type AuthorizationSelection,
} from "@/lib/authorization-groups"
import { cn } from "@/lib/utils"

type KnowledgeBaseType = "system" | "user"
type KnowledgeContentType = "text" | "file"
type LearningStatus = "learned" | "learning" | "failed"

type KnowledgeContent = {
  id: string
  name: string
  type: KnowledgeContentType
  status: LearningStatus
  updatedAt: string
  size: string
  body: string
}

type KnowledgeBaseCommon = {
  id: string
  name: string
  description: string
  tagIds: string[]
  creator: string
  enabled: boolean
  contents: KnowledgeContent[]
}

type SystemKnowledgeBase = KnowledgeBaseCommon & {
  type: "system"
}

type UserKnowledgeBase = KnowledgeBaseCommon & {
  type: "user"
  readAuthorization: AuthorizationSelection
  writeAuthorization: AuthorizationSelection
}

type KnowledgeBase = SystemKnowledgeBase | UserKnowledgeBase

const ADMIN_CREATOR = "MonkeyAI Admin"

const INITIAL_KNOWLEDGE_BASES: KnowledgeBase[] = [
  {
    id: "kb-product-handbook",
    name: "产品与服务手册",
    description: "沉淀产品能力、版本说明和常见使用场景，供全员检索。",
    tagIds: ["product"],
    type: "system",
    creator: ADMIN_CREATOR,
    enabled: true,
    contents: [
      {
        id: "content-product-overview",
        name: "MonkeyAI 产品概览",
        type: "text",
        status: "learned",
        updatedAt: "2026-08-29T09:30:00+08:00",
        size: "1,286 字",
        body: "MonkeyAI 是面向团队的智能 Agent 工作台，支持模型、知识库、规则、技能和工具的统一管理。团队成员可以在权限范围内检索知识并完成日常任务。",
      },
      {
        id: "content-release-notes",
        name: "2026 Q3 版本说明.pdf",
        type: "file",
        status: "learned",
        updatedAt: "2026-08-28T16:20:00+08:00",
        size: "2.4 MB",
        body: `# 2026 Q3 版本说明

## 知识库能力

- 新增系统知识库与用户知识库分类。
- 支持从文本、Markdown、PDF 和 Word 文档中提取纯文本。
- 内容提取后由嵌入模型完成向量化，并记录学习状态。`,
      },
      {
        id: "content-pricing-faq",
        name: "计费规则常见问题.md",
        type: "file",
        status: "learning",
        updatedAt: "2026-09-02T10:12:00+08:00",
        size: "38 KB",
        body: `# 计费规则常见问题

## Token 如何计费？

模型调用按实际输入和输出 Token 数量计费，具体单价以模型配置为准。`,
      },
    ],
  },
  {
    id: "kb-customer-support",
    name: "客户支持知识库",
    description: "收录标准答复、排障流程和服务规范，帮助支持团队快速响应。",
    tagIds: ["operations", "incident-response"],
    type: "system",
    creator: ADMIN_CREATOR,
    enabled: true,
    contents: [
      {
        id: "content-support-sop",
        name: "客户问题处理 SOP.docx",
        type: "file",
        status: "learned",
        updatedAt: "2026-08-25T14:05:00+08:00",
        size: "680 KB",
        body: `# 客户问题处理 SOP

## 处理流程

1. 确认问题现象与影响范围。
2. 收集必要的日志和复现步骤。
3. 按优先级响应，必要时触发升级流程。`,
      },
      {
        id: "content-escalation",
        name: "问题升级规则",
        type: "text",
        status: "failed",
        updatedAt: "2026-09-01T18:45:00+08:00",
        size: "856 字",
        body: "当问题影响多个客户、涉及数据安全或超过约定响应时间时，应立即升级至对应负责人。",
      },
    ],
  },
  {
    id: "kb-engineering",
    name: "研发规范",
    description: "集中维护工程实践、发布流程和安全开发规范。",
    tagIds: ["code", "security"],
    type: "system",
    creator: ADMIN_CREATOR,
    enabled: false,
    contents: [
      {
        id: "content-code-review",
        name: "代码评审清单.md",
        type: "file",
        status: "learned",
        updatedAt: "2026-08-31T11:40:00+08:00",
        size: "24 KB",
        body: `# 代码评审清单

- 变更目标是否清晰且范围可控
- 是否覆盖异常路径和边界条件
- 是否包含与风险相匹配的测试
- 是否避免记录密钥和敏感信息`,
      },
    ],
  },
  {
    id: "kb-user-research",
    name: "用户研究笔记",
    description: "产品访谈与需求分析的个人资料整理。",
    tagIds: ["research", "notes"],
    type: "user",
    creator: "林玫",
    enabled: true,
    readAuthorization: {
      groupIds: [],
      memberIds: ["member-04", "member-05", "member-06"],
    },
    writeAuthorization: { groupIds: [], memberIds: ["member-04"] },
    contents: [
      {
        id: "content-interview-notes",
        name: "8 月用户访谈纪要",
        type: "text",
        status: "learned",
        updatedAt: "2026-08-30T17:10:00+08:00",
        size: "3,420 字",
        body: "本轮访谈重点关注知识检索的准确性、内容更新效率以及团队协作中的权限管理体验。",
      },
    ],
  },
  {
    id: "kb-user-sales",
    name: "售前方案素材",
    description: "售前演示、行业案例和方案说明的个人资料库。",
    tagIds: ["product", "copywriting"],
    type: "user",
    creator: "陈晨",
    enabled: true,
    readAuthorization: {
      groupIds: [],
      memberIds: ["member-01", "member-18"],
    },
    writeAuthorization: { groupIds: [], memberIds: ["member-01"] },
    contents: [
      {
        id: "content-industry-cases",
        name: "行业案例合集.pdf",
        type: "file",
        status: "learning",
        updatedAt: "2026-09-02T09:05:00+08:00",
        size: "8.7 MB",
        body: `# 行业案例合集

## 智能客服

通过知识检索与 Agent 编排，为客户提供一致、可追溯的自动化答复。

## 研发协作

集中管理工程规范和项目资料，缩短团队检索与理解上下文的时间。`,
      },
    ],
  },
]

function getCreatorInitials(creator: string) {
  return creator.trim().slice(0, 2).toUpperCase()
}

export function KnowledgeBasesPage() {
  const { i18n, t } = useTranslation()
  const { tags: availableTags } = useSkillTags()
  const [knowledgeBases, setKnowledgeBases] = useState(INITIAL_KNOWLEDGE_BASES)
  const [activeType, setActiveType] = useState<KnowledgeBaseType>("system")
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState<
    string | null
  >(null)
  const [knowledgeBaseDialogOpen, setKnowledgeBaseDialogOpen] = useState(false)
  const [editingKnowledgeBaseId, setEditingKnowledgeBaseId] = useState<
    string | null
  >(null)
  const [knowledgeBasePendingDeletion, setKnowledgeBasePendingDeletion] =
    useState<KnowledgeBase | null>(null)
  const [contentDialogOpen, setContentDialogOpen] = useState(false)
  const [contentMode, setContentMode] = useState<KnowledgeContentType>("text")
  const [editingContentId, setEditingContentId] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState<KnowledgeContent | null>(
    null
  )
  const [contentPendingDeletion, setContentPendingDeletion] =
    useState<KnowledgeContent | null>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])

  const selectedKnowledgeBase = knowledgeBases.find(
    (knowledgeBase) => knowledgeBase.id === selectedKnowledgeBaseId
  )
  const editingKnowledgeBase = knowledgeBases.find(
    (knowledgeBase) => knowledgeBase.id === editingKnowledgeBaseId
  )
  const editingContent = selectedKnowledgeBase?.contents.find(
    (content) => content.id === editingContentId
  )
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    [i18n.language]
  )

  const resetKnowledgeBaseOptions = () => {
    setTagsOpen(false)
    setSelectedTagIds([])
  }

  const handleKnowledgeBaseDialogOpenChange = (open: boolean) => {
    setKnowledgeBaseDialogOpen(open)
    if (!open) {
      setEditingKnowledgeBaseId(null)
      resetKnowledgeBaseOptions()
    }
  }

  const handleEditKnowledgeBase = (knowledgeBase: KnowledgeBase) => {
    if (knowledgeBase.type !== "system") return

    setEditingKnowledgeBaseId(knowledgeBase.id)
    setSelectedTagIds(knowledgeBase.tagIds)
    setTagsOpen(false)
    setKnowledgeBaseDialogOpen(true)
  }

  const handleSubmitKnowledgeBase = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const form = event.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get("name") ?? "").trim()
    const description = String(formData.get("description") ?? "").trim()
    const tagIds = selectedTagIds.filter((tagId) =>
      availableTags.some((tag) => tag.id === tagId)
    )

    if (!name || !description || editingKnowledgeBase?.type === "user") {
      return
    }

    if (editingKnowledgeBase) {
      setKnowledgeBases((current) =>
        current.map((knowledgeBase) =>
          knowledgeBase.id === editingKnowledgeBase.id
            ? { ...knowledgeBase, name, description, tagIds }
            : knowledgeBase
        )
      )
    } else {
      setKnowledgeBases((current) => [
        ...current,
        {
          id: `knowledge-base-${Date.now()}`,
          name,
          description,
          tagIds,
          type: "system",
          creator: ADMIN_CREATOR,
          enabled: true,
          contents: [],
        },
      ])
    }

    form.reset()
    handleKnowledgeBaseDialogOpenChange(false)
  }

  const handleDeleteKnowledgeBase = () => {
    if (!knowledgeBasePendingDeletion) return

    setKnowledgeBases((current) =>
      current.filter(
        (knowledgeBase) => knowledgeBase.id !== knowledgeBasePendingDeletion.id
      )
    )
    if (selectedKnowledgeBaseId === knowledgeBasePendingDeletion.id) {
      setSelectedKnowledgeBaseId(null)
    }
    setKnowledgeBasePendingDeletion(null)
  }

  const setKnowledgeBaseEnabled = (
    knowledgeBaseId: string,
    enabled: boolean
  ) => {
    setKnowledgeBases((current) =>
      current.map((knowledgeBase) =>
        knowledgeBase.id === knowledgeBaseId && knowledgeBase.type === "system"
          ? { ...knowledgeBase, enabled }
          : knowledgeBase
      )
    )
  }

  const handleContentDialogOpenChange = (open: boolean) => {
    setContentDialogOpen(open)
    if (!open) {
      setContentMode("text")
      setEditingContentId(null)
    }
  }

  const finishLearning = (knowledgeBaseId: string, contentId: string) => {
    window.setTimeout(() => {
      setKnowledgeBases((current) =>
        current.map((knowledgeBase) =>
          knowledgeBase.id === knowledgeBaseId
            ? {
                ...knowledgeBase,
                contents: knowledgeBase.contents.map((content) =>
                  content.id === contentId
                    ? {
                        ...content,
                        status: "learned" as LearningStatus,
                        updatedAt: new Date().toISOString(),
                      }
                    : content
                ),
              }
            : knowledgeBase
        )
      )
    }, 1800)
  }

  const handleEditContent = (content: KnowledgeContent) => {
    if (
      !selectedKnowledgeBase ||
      selectedKnowledgeBase.type !== "system" ||
      content.type !== "text"
    ) {
      return
    }

    setEditingContentId(content.id)
    setContentMode("text")
    setContentDialogOpen(true)
  }

  const handleSubmitContent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedKnowledgeBase || selectedKnowledgeBase.type !== "system") {
      return
    }

    const form = event.currentTarget
    const formData = new FormData(form)
    const textTitle = String(formData.get("title") ?? "").trim()
    const body = String(formData.get("body") ?? "").trim()
    const selectedFiles = formData
      .getAll("file")
      .filter((value): value is File => value instanceof File && value.size > 0)

    if (editingContent) {
      if (editingContent.type !== "text" || !textTitle || !body) return

      const contentId = editingContent.id
      const knowledgeBaseId = selectedKnowledgeBase.id

      setKnowledgeBases((current) =>
        current.map((knowledgeBase) =>
          knowledgeBase.id === knowledgeBaseId
            ? {
                ...knowledgeBase,
                contents: knowledgeBase.contents.map((content) =>
                  content.id === contentId
                    ? {
                        ...content,
                        name: textTitle,
                        body,
                        size: t("pages.knowledgeBases.characterCount", {
                          count: body.length,
                        }),
                        status: "learning" as LearningStatus,
                        updatedAt: new Date().toISOString(),
                      }
                    : content
                ),
              }
            : knowledgeBase
        )
      )

      finishLearning(knowledgeBaseId, contentId)
      form.reset()
      handleContentDialogOpenChange(false)
      return
    }

    if (
      (contentMode === "text" && (!textTitle || !body)) ||
      (contentMode === "file" && selectedFiles.length === 0)
    ) {
      return
    }

    const createdAt = Date.now()
    const newContents: KnowledgeContent[] =
      contentMode === "text"
        ? [
            {
              id: `knowledge-content-${createdAt}`,
              name: textTitle,
              type: "text",
              status: "learning",
              updatedAt: new Date().toISOString(),
              size: t("pages.knowledgeBases.characterCount", {
                count: body.length,
              }),
              body,
            },
          ]
        : await Promise.all(
            selectedFiles.map(async (selectedFile, index) => ({
              id: `knowledge-content-${createdAt}-${index}`,
              name: selectedFile.name,
              type: "file" as const,
              status: "learning" as const,
              updatedAt: new Date().toISOString(),
              size: formatFileSize(selectedFile.size),
              body: await extractFileAsMarkdown(
                selectedFile,
                t("pages.knowledgeBases.fileExtractionPlaceholder", {
                  fileName: selectedFile.name,
                })
              ),
            }))
          )

    setKnowledgeBases((current) =>
      current.map((knowledgeBase) =>
        knowledgeBase.id === selectedKnowledgeBase.id
          ? {
              ...knowledgeBase,
              contents: [...newContents, ...knowledgeBase.contents],
            }
          : knowledgeBase
      )
    )

    newContents.forEach((content) =>
      finishLearning(selectedKnowledgeBase.id, content.id)
    )

    form.reset()
    handleContentDialogOpenChange(false)
  }

  const handleDeleteContent = () => {
    if (!selectedKnowledgeBase || !contentPendingDeletion) return

    setKnowledgeBases((current) =>
      current.map((knowledgeBase) =>
        knowledgeBase.id === selectedKnowledgeBase.id
          ? {
              ...knowledgeBase,
              contents: knowledgeBase.contents.filter(
                (content) => content.id !== contentPendingDeletion.id
              ),
            }
          : knowledgeBase
      )
    )
    setContentPendingDeletion(null)
  }

  const handleRetryLearning = (contentId: string) => {
    if (!selectedKnowledgeBase || selectedKnowledgeBase.type !== "system") {
      return
    }

    setKnowledgeBases((current) =>
      current.map((knowledgeBase) =>
        knowledgeBase.id === selectedKnowledgeBase.id
          ? {
              ...knowledgeBase,
              contents: knowledgeBase.contents.map((content) =>
                content.id === contentId
                  ? { ...content, status: "learning" }
                  : content
              ),
            }
          : knowledgeBase
      )
    )

    finishLearning(selectedKnowledgeBase.id, contentId)
  }

  if (selectedKnowledgeBase) {
    const isSystemKnowledgeBase = selectedKnowledgeBase.type === "system"

    return (
      <>
        {renderKnowledgeBaseList()}
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setSelectedKnowledgeBaseId(null)
              setContentDialogOpen(false)
              setPreviewContent(null)
              setContentPendingDeletion(null)
            }
          }}
        >
          <DialogContent
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl"
            closeLabel={t("common.close")}
          >
            <div className="flex min-w-0 items-start gap-3 pe-8">
              <Avatar size="lg">
                <AvatarFallback>
                  <HugeiconsIcon icon={BookOpenTextIcon} strokeWidth={2} />
                </AvatarFallback>
              </Avatar>
              <DialogHeader className="min-w-0 gap-1 text-start">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="truncate text-lg">
                    {selectedKnowledgeBase.name}
                  </DialogTitle>
                  {!isSystemKnowledgeBase && (
                    <Badge variant="outline">
                      {t("pages.knowledgeBases.readOnly")}
                    </Badge>
                  )}
                  {!selectedKnowledgeBase.enabled && (
                    <Badge variant="outline">
                      {t("pages.knowledgeBases.disable")}
                    </Badge>
                  )}
                </div>
                <DialogDescription>
                  {selectedKnowledgeBase.description}
                </DialogDescription>
              </DialogHeader>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t("pages.knowledgeBases.contents")}</CardTitle>
                {isSystemKnowledgeBase && (
                  <CardAction>
                    <Button
                      type="button"
                      onClick={() => {
                        setEditingContentId(null)
                        setContentMode("text")
                        setContentDialogOpen(true)
                      }}
                    >
                      <HugeiconsIcon
                        icon={PlusSignIcon}
                        data-icon="inline-start"
                      />
                      {t("pages.knowledgeBases.addContent")}
                    </Button>
                  </CardAction>
                )}
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="ps-6">
                        {t("pages.knowledgeBases.columns.name")}
                      </TableHead>
                      <TableHead>
                        {t("pages.knowledgeBases.columns.type")}
                      </TableHead>
                      <TableHead>
                        {t("pages.knowledgeBases.columns.status")}
                      </TableHead>
                      <TableHead>
                        {t("pages.knowledgeBases.columns.updatedAt")}
                      </TableHead>
                      <TableHead className="pe-6 text-end">
                        {t("pages.knowledgeBases.columns.actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedKnowledgeBase.contents.length === 0 ? (
                      <TableRow>
                        <TableCell
                          className="h-28 px-6 text-center text-muted-foreground"
                          colSpan={5}
                        >
                          {t("pages.knowledgeBases.emptyContents")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      selectedKnowledgeBase.contents.map((content) => (
                        <TableRow key={content.id}>
                          <TableCell className="max-w-80 ps-6">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                <HugeiconsIcon
                                  icon={
                                    content.type === "text"
                                      ? TextIcon
                                      : File01Icon
                                  }
                                  strokeWidth={2}
                                />
                              </div>
                              <div className="min-w-0">
                                <p
                                  className="truncate font-medium"
                                  title={content.name}
                                >
                                  {content.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {content.size}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {t(
                              `pages.knowledgeBases.contentTypes.${content.type}`
                            )}
                          </TableCell>
                          <TableCell>
                            <LearningStatusBadge status={content.status} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {dateFormatter.format(new Date(content.updatedAt))}
                          </TableCell>
                          <TableCell className="pe-6 text-end">
                            <div className="flex justify-end gap-1">
                              <Button
                                aria-label={t("pages.knowledgeBases.preview")}
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                                onClick={() => setPreviewContent(content)}
                              >
                                <HugeiconsIcon
                                  icon={ViewIcon}
                                  strokeWidth={2}
                                />
                              </Button>
                              {isSystemKnowledgeBase && (
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
                                    {(content.type === "text" ||
                                      content.status === "failed") && (
                                      <>
                                        <DropdownMenuGroup>
                                          {content.type === "text" && (
                                            <DropdownMenuItem
                                              onClick={() =>
                                                handleEditContent(content)
                                              }
                                            >
                                              <HugeiconsIcon
                                                icon={Edit02Icon}
                                                strokeWidth={2}
                                              />
                                              {t(
                                                "pages.knowledgeBases.editContent"
                                              )}
                                            </DropdownMenuItem>
                                          )}
                                          {content.status === "failed" && (
                                            <DropdownMenuItem
                                              onClick={() =>
                                                handleRetryLearning(content.id)
                                              }
                                            >
                                              <HugeiconsIcon
                                                icon={Loading03Icon}
                                                strokeWidth={2}
                                              />
                                              {t(
                                                "pages.knowledgeBases.retryLearning"
                                              )}
                                            </DropdownMenuItem>
                                          )}
                                        </DropdownMenuGroup>
                                        <DropdownMenuSeparator />
                                      </>
                                    )}
                                    <DropdownMenuGroup>
                                      <DropdownMenuItem
                                        variant="destructive"
                                        onClick={() =>
                                          setContentPendingDeletion(content)
                                        }
                                      >
                                        <HugeiconsIcon
                                          icon={Delete02Icon}
                                          strokeWidth={2}
                                        />
                                        {t(
                                          "pages.knowledgeBases.deleteContent"
                                        )}
                                      </DropdownMenuItem>
                                    </DropdownMenuGroup>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
              <CardFooter className="justify-between border-t text-sm text-muted-foreground">
                <span>
                  {t("pages.knowledgeBases.learnedSummary", {
                    learned: selectedKnowledgeBase.contents.filter(
                      (content) => content.status === "learned"
                    ).length,
                    total: selectedKnowledgeBase.contents.length,
                  })}
                </span>
                {!isSystemKnowledgeBase && (
                  <span>{t("pages.knowledgeBases.userReadOnlyHint")}</span>
                )}
              </CardFooter>
            </Card>
          </DialogContent>
        </Dialog>

        {isSystemKnowledgeBase && (
          <Dialog
            open={contentDialogOpen}
            onOpenChange={handleContentDialogOpenChange}
          >
            <DialogContent
              className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
              closeLabel={t("common.close")}
            >
              <form
                key={editingContent?.id ?? "new-content"}
                className="flex flex-col gap-6"
                onSubmit={handleSubmitContent}
              >
                <DialogHeader>
                  <DialogTitle>
                    {editingContent
                      ? t("pages.knowledgeBases.editContentTitle")
                      : t("pages.knowledgeBases.addContentTitle")}
                  </DialogTitle>
                  <DialogDescription>
                    {editingContent
                      ? t("pages.knowledgeBases.editContentDescription")
                      : t("pages.knowledgeBases.addContentDescription")}
                  </DialogDescription>
                </DialogHeader>

                <Tabs
                  className="gap-5"
                  value={contentMode}
                  onValueChange={(value) =>
                    setContentMode(value as KnowledgeContentType)
                  }
                >
                  {!editingContent && (
                    <FieldGroup>
                      <Field>
                        <FieldLabel>
                          {t("pages.knowledgeBases.contentSource")}
                        </FieldLabel>
                        <TabsList
                          aria-label={t("pages.knowledgeBases.contentSource")}
                          className="w-full"
                        >
                          <TabsTrigger value="text">
                            <HugeiconsIcon
                              icon={TextIcon}
                              data-icon="inline-start"
                            />
                            {t("pages.knowledgeBases.textContent")}
                          </TabsTrigger>
                          <TabsTrigger value="file">
                            <HugeiconsIcon
                              icon={File01Icon}
                              data-icon="inline-start"
                            />
                            {t("pages.knowledgeBases.fileContent")}
                          </TabsTrigger>
                        </TabsList>
                      </Field>
                    </FieldGroup>
                  )}

                  <TabsContent value="text">
                    <FieldGroup className="gap-5">
                      <Field>
                        <FieldLabel htmlFor="knowledge-content-title">
                          {t("pages.knowledgeBases.contentTitle")}
                        </FieldLabel>
                        <Input
                          id="knowledge-content-title"
                          name="title"
                          defaultValue={editingContent?.name}
                          placeholder={t(
                            "pages.knowledgeBases.contentTitlePlaceholder"
                          )}
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="knowledge-content-body">
                          {t("pages.knowledgeBases.textContent")}
                        </FieldLabel>
                        <Textarea
                          className="max-h-72 min-h-48 resize-y overflow-y-auto"
                          id="knowledge-content-body"
                          name="body"
                          defaultValue={editingContent?.body}
                          placeholder={t(
                            "pages.knowledgeBases.textPlaceholder"
                          )}
                          required
                        />
                      </Field>
                    </FieldGroup>
                  </TabsContent>

                  <TabsContent value="file">
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="knowledge-content-file">
                          {t("pages.knowledgeBases.selectFile")}
                        </FieldLabel>
                        <Input
                          accept=".txt,.md,.markdown,.pdf,.doc,.docx"
                          id="knowledge-content-file"
                          multiple
                          name="file"
                          type="file"
                          required
                        />
                        <FieldDescription>
                          {t("pages.knowledgeBases.fileDescription")}
                        </FieldDescription>
                      </Field>
                    </FieldGroup>
                  </TabsContent>
                </Tabs>

                <DialogFooter>
                  <DialogClose
                    render={<Button type="button" variant="outline" />}
                  >
                    {t("pages.knowledgeBases.cancel")}
                  </DialogClose>
                  <Button type="submit">
                    {editingContent
                      ? t("pages.knowledgeBases.saveAndRelearn")
                      : t("pages.knowledgeBases.addAndLearn")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}

        <Dialog
          open={previewContent !== null}
          onOpenChange={(open) => {
            if (!open) setPreviewContent(null)
          }}
        >
          <DialogContent closeLabel={t("common.close")}>
            <DialogHeader className="min-w-0 pe-6">
              <DialogTitle className="truncate" title={previewContent?.name}>
                {previewContent?.name}
              </DialogTitle>
            </DialogHeader>
            <pre className="max-h-[60dvh] overflow-auto rounded-lg border bg-muted/30 p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap">
              {previewContent?.body}
            </pre>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={contentPendingDeletion !== null}
          onOpenChange={(open) => {
            if (!open) setContentPendingDeletion(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("pages.knowledgeBases.deleteContentTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("pages.knowledgeBases.deleteContentDescription", {
                  content: contentPendingDeletion?.name ?? "",
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("pages.knowledgeBases.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={handleDeleteContent}
              >
                {t("pages.knowledgeBases.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }

  function renderKnowledgeBaseList() {
    return (
      <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <Tabs
          className="gap-4"
          value={activeType}
          onValueChange={(value) => setActiveType(value as KnowledgeBaseType)}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList aria-label={t("pages.knowledgeBases.type")}>
              <TabsTrigger value="system">
                {t("pages.knowledgeBases.systemKnowledgeBase")}
              </TabsTrigger>
              <TabsTrigger value="user">
                {t("pages.knowledgeBases.userKnowledgeBase")}
              </TabsTrigger>
            </TabsList>

            {activeType === "system" && (
              <Dialog
                open={knowledgeBaseDialogOpen}
                onOpenChange={handleKnowledgeBaseDialogOpenChange}
              >
                <DialogTrigger
                  render={
                    <Button
                      onClick={() => {
                        setEditingKnowledgeBaseId(null)
                        resetKnowledgeBaseOptions()
                      }}
                    />
                  }
                >
                  <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                  {t("pages.knowledgeBases.add")}
                </DialogTrigger>
                <DialogContent
                  className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
                  closeLabel={t("common.close")}
                >
                  <form
                    key={editingKnowledgeBase?.id ?? "new-knowledge-base"}
                    className="flex flex-col gap-6"
                    onSubmit={handleSubmitKnowledgeBase}
                  >
                    <DialogHeader>
                      <DialogTitle>
                        {editingKnowledgeBase
                          ? t("pages.knowledgeBases.editDialogTitle")
                          : t("pages.knowledgeBases.dialogTitle")}
                      </DialogTitle>
                      <DialogDescription>
                        {t("pages.knowledgeBases.dialogDescription")}
                      </DialogDescription>
                    </DialogHeader>
                    <FieldGroup className="gap-5">
                      <Field>
                        <FieldLabel htmlFor="knowledge-base-name">
                          {t("pages.knowledgeBases.name")}
                        </FieldLabel>
                        <Input
                          id="knowledge-base-name"
                          name="name"
                          defaultValue={editingKnowledgeBase?.name}
                          placeholder={t(
                            "pages.knowledgeBases.namePlaceholder"
                          )}
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="knowledge-base-description">
                          {t("pages.knowledgeBases.knowledgeDescription")}
                        </FieldLabel>
                        <Textarea
                          className="max-h-48 min-h-28 resize-y overflow-y-auto"
                          id="knowledge-base-description"
                          name="description"
                          defaultValue={editingKnowledgeBase?.description}
                          placeholder={t(
                            "pages.knowledgeBases.descriptionPlaceholder"
                          )}
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="knowledge-base-tags">
                          {t("pages.knowledgeBases.tags")}
                        </FieldLabel>
                        <SkillTagSelect
                          id="knowledge-base-tags"
                          open={tagsOpen}
                          options={availableTags}
                          placeholder={t(
                            "pages.knowledgeBases.tagsPlaceholder"
                          )}
                          value={selectedTagIds}
                          onOpenChange={setTagsOpen}
                          onValueChange={setSelectedTagIds}
                        />
                      </Field>
                    </FieldGroup>
                    <DialogFooter>
                      <DialogClose
                        render={<Button type="button" variant="outline" />}
                      >
                        {t("pages.knowledgeBases.cancel")}
                      </DialogClose>
                      <Button type="submit">
                        {editingKnowledgeBase
                          ? t("pages.knowledgeBases.save")
                          : t("pages.knowledgeBases.create")}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {(["system", "user"] as const).map((tabType) => (
            <TabsContent key={tabType} value={tabType}>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {knowledgeBases
                  .filter((knowledgeBase) => knowledgeBase.type === tabType)
                  .map((knowledgeBase) => {
                    const readAuthorizationNames =
                      knowledgeBase.type === "user"
                        ? getAuthorizationNames(
                            knowledgeBase.readAuthorization,
                            t
                          )
                        : ""
                    const writeAuthorizationNames =
                      knowledgeBase.type === "user"
                        ? getAuthorizationNames(
                            knowledgeBase.writeAuthorization,
                            t
                          )
                        : ""
                    const learnedCount = knowledgeBase.contents.filter(
                      (content) => content.status === "learned"
                    ).length
                    const tagNames = availableTags
                      .filter((tag) => knowledgeBase.tagIds.includes(tag.id))
                      .map((tag) => tag.name)
                      .join(", ")

                    return (
                      <Card
                        className={cn(
                          "h-full",
                          !knowledgeBase.enabled && "bg-muted"
                        )}
                        key={knowledgeBase.id}
                      >
                        <CardHeader>
                          <div className="flex min-w-0 items-start gap-3">
                            <Avatar size="lg">
                              <AvatarFallback>
                                {knowledgeBase.creator === ADMIN_CREATOR ? (
                                  <HugeiconsIcon
                                    icon={BookOpenTextIcon}
                                    strokeWidth={2}
                                  />
                                ) : (
                                  getCreatorInitials(knowledgeBase.creator)
                                )}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <CardTitle className="flex min-w-0 items-center gap-2">
                                <span
                                  className="truncate"
                                  title={knowledgeBase.name}
                                >
                                  {knowledgeBase.name}
                                </span>
                                {!knowledgeBase.enabled && (
                                  <Badge variant="outline">
                                    {t("pages.knowledgeBases.disable")}
                                  </Badge>
                                )}
                              </CardTitle>
                              <CardDescription
                                className="truncate"
                                title={knowledgeBase.creator}
                              >
                                {knowledgeBase.creator}
                              </CardDescription>
                            </div>
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
                                    onClick={() =>
                                      setSelectedKnowledgeBaseId(
                                        knowledgeBase.id
                                      )
                                    }
                                  >
                                    <HugeiconsIcon
                                      icon={ViewIcon}
                                      strokeWidth={2}
                                    />
                                    {knowledgeBase.type === "system"
                                      ? t("pages.knowledgeBases.manageContents")
                                      : t("pages.knowledgeBases.viewContents")}
                                  </DropdownMenuItem>
                                  {knowledgeBase.type === "system" && (
                                    <>
                                      <DropdownMenuItem
                                        disabled={knowledgeBase.enabled}
                                        onClick={() =>
                                          setKnowledgeBaseEnabled(
                                            knowledgeBase.id,
                                            true
                                          )
                                        }
                                      >
                                        <HugeiconsIcon
                                          icon={PlayIcon}
                                          strokeWidth={2}
                                        />
                                        {t("pages.knowledgeBases.enable")}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        disabled={!knowledgeBase.enabled}
                                        onClick={() =>
                                          setKnowledgeBaseEnabled(
                                            knowledgeBase.id,
                                            false
                                          )
                                        }
                                      >
                                        <HugeiconsIcon
                                          icon={PauseIcon}
                                          strokeWidth={2}
                                        />
                                        {t("pages.knowledgeBases.disable")}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() =>
                                          handleEditKnowledgeBase(knowledgeBase)
                                        }
                                      >
                                        <HugeiconsIcon
                                          icon={Edit02Icon}
                                          strokeWidth={2}
                                        />
                                        {t("pages.knowledgeBases.editInfo")}
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuGroup>
                                {knowledgeBase.type === "system" && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuGroup>
                                      <DropdownMenuItem
                                        variant="destructive"
                                        onClick={() =>
                                          setKnowledgeBasePendingDeletion(
                                            knowledgeBase
                                          )
                                        }
                                      >
                                        <HugeiconsIcon
                                          icon={Delete02Icon}
                                          strokeWidth={2}
                                        />
                                        {t("pages.knowledgeBases.delete")}
                                      </DropdownMenuItem>
                                    </DropdownMenuGroup>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardHeader>
                        <CardContent className="flex-1">
                          <p
                            className="truncate text-muted-foreground"
                            title={knowledgeBase.description}
                          >
                            {knowledgeBase.description}
                          </p>
                          <div className="mt-4 flex min-w-0 items-center gap-4">
                            <span className="w-2/5 truncate text-muted-foreground">
                              {t("pages.knowledgeBases.tags")}
                            </span>
                            <span
                              className="w-3/5 truncate text-end font-medium"
                              title={
                                tagNames || t("pages.knowledgeBases.noTags")
                              }
                            >
                              {tagNames || t("pages.knowledgeBases.noTags")}
                            </span>
                          </div>
                          <div className="mt-3 flex min-w-0 items-center justify-between gap-3 text-sm">
                            <span className="truncate text-muted-foreground">
                              {t("pages.knowledgeBases.contentCount", {
                                count: knowledgeBase.contents.length,
                              })}
                            </span>
                            <LearningSummaryBadge
                              learned={learnedCount}
                              total={knowledgeBase.contents.length}
                            />
                          </div>
                        </CardContent>
                        {knowledgeBase.type === "user" && (
                          <CardFooter className="flex-col items-stretch gap-3 border-t">
                            <div className="flex min-w-0 items-center gap-4">
                              <span className="w-2/5 truncate text-muted-foreground">
                                {t("pages.knowledgeBases.readableUsers")}
                              </span>
                              <span
                                className="w-3/5 truncate text-end font-medium"
                                title={readAuthorizationNames}
                              >
                                {readAuthorizationNames}
                              </span>
                            </div>
                            <div className="flex min-w-0 items-center gap-4">
                              <span className="w-2/5 truncate text-muted-foreground">
                                {t("pages.knowledgeBases.writableUsers")}
                              </span>
                              <span
                                className="w-3/5 truncate text-end font-medium"
                                title={writeAuthorizationNames}
                              >
                                {writeAuthorizationNames}
                              </span>
                            </div>
                          </CardFooter>
                        )}
                      </Card>
                    )
                  })}
              </div>
            </TabsContent>
          ))}
        </Tabs>

        <AlertDialog
          open={knowledgeBasePendingDeletion !== null}
          onOpenChange={(open) => {
            if (!open) setKnowledgeBasePendingDeletion(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("pages.knowledgeBases.deleteDialogTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("pages.knowledgeBases.deleteDialogDescription", {
                  knowledgeBase: knowledgeBasePendingDeletion?.name ?? "",
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("pages.knowledgeBases.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={handleDeleteKnowledgeBase}
              >
                {t("pages.knowledgeBases.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    )
  }

  return renderKnowledgeBaseList()
}

function LearningStatusBadge({ status }: { status: LearningStatus }) {
  const { t } = useTranslation()
  const icon =
    status === "learned"
      ? CheckmarkCircle02Icon
      : status === "learning"
        ? Loading03Icon
        : AlertCircleIcon

  return (
    <Badge
      variant={
        status === "learned"
          ? "default"
          : status === "learning"
            ? "secondary"
            : "destructive"
      }
    >
      <HugeiconsIcon
        className={status === "learning" ? "animate-spin" : undefined}
        icon={icon}
        data-icon="inline-start"
      />
      {t(`pages.knowledgeBases.statuses.${status}`)}
    </Badge>
  )
}

function LearningSummaryBadge({
  learned,
  total,
}: {
  learned: number
  total: number
}) {
  const { t } = useTranslation()
  const allLearned = total > 0 && learned === total
  const variant =
    learned === 0
      ? "destructiveOutline"
      : allLearned
        ? "successOutline"
        : "warningOutline"

  return (
    <Badge variant={variant}>
      {total === 0
        ? t("pages.knowledgeBases.noContent")
        : t("pages.knowledgeBases.learnedCount", { learned, total })}
    </Badge>
  )
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function extractFileAsMarkdown(file: File, fallback: string) {
  const extension = file.name.split(".").pop()?.toLowerCase()

  if (extension === "txt" || extension === "md" || extension === "markdown") {
    const text = (await file.text()).trim()
    return text || fallback
  }

  return fallback
}
