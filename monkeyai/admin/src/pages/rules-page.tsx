import { useState, type FormEvent } from "react"
import {
  Delete02Icon,
  DocumentValidationIcon,
  Edit02Icon,
  MoreHorizontalIcon,
  PlusSignIcon,
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
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  getAuthorizationNames,
  type AuthorizationSelection,
} from "@/lib/authorization-groups"

type RuleType = "system" | "user"

type AgentRule = {
  id: string
  name: string
  content: string
  type: RuleType
  creator: string
  forcedScope: AuthorizationSelection | null
}

const ADMIN_CREATOR = "MonkeyAI Admin"

const INITIAL_RULES: AgentRule[] = [
  {
    id: "rule-security-boundary",
    name: "安全边界",
    content:
      "不得协助执行违法、危险或破坏性操作。遇到此类请求时，应明确拒绝，并在合适的情况下提供安全的替代方案。",
    type: "system",
    creator: ADMIN_CREATOR,
    forcedScope: { groupIds: ["all-members"], memberIds: [] },
  },
  {
    id: "rule-code-quality",
    name: "代码质量规范",
    content:
      "生成或修改代码时，应保持实现简洁、类型安全，并优先复用项目已有组件。提交结果前必须完成与改动范围匹配的检查。",
    type: "system",
    creator: ADMIN_CREATOR,
    forcedScope: {
      groupIds: ["administrators", "engineering"],
      memberIds: [],
    },
  },
  {
    id: "rule-data-privacy",
    name: "隐私数据保护",
    content:
      "不得在回答、日志或外部请求中泄露密钥、访问令牌、个人身份信息及其他敏感数据。",
    type: "system",
    creator: ADMIN_CREATOR,
    forcedScope: {
      groupIds: ["administrators", "product", "engineering"],
      memberIds: [],
    },
  },
  {
    id: "rule-concise-response",
    name: "简洁回复",
    content:
      "回答应直接给出结论，使用清晰、自然的语言；仅在有助于理解或执行任务时补充必要细节。",
    type: "user",
    creator: "陈晨",
    forcedScope: null,
  },
  {
    id: "rule-user-product-copy",
    name: "产品文案风格",
    content:
      "撰写产品文案时使用简洁、友好的表达，避免过度承诺，并优先说明用户能够获得的实际价值。",
    type: "user",
    creator: "林玫",
    forcedScope: null,
  },
]

function getCreatorInitials(creator: string) {
  return creator.trim().slice(0, 2).toUpperCase()
}

export function RulesPage() {
  const { t } = useTranslation()
  const [rules, setRules] = useState(INITIAL_RULES)
  const [activeRuleType, setActiveRuleType] = useState<RuleType>("system")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [rulePendingDeletion, setRulePendingDeletion] =
    useState<AgentRule | null>(null)
  const [forcedScopeOpen, setForcedScopeOpen] = useState(false)
  const [forcedScope, setForcedScope] = useState<AuthorizationSelection>({
    groupIds: ["all-members"],
    memberIds: [],
  })
  const editingRule = rules.find((rule) => rule.id === editingRuleId)

  const resetRuleOptions = () => {
    setForcedScopeOpen(false)
    setForcedScope({ groupIds: ["all-members"], memberIds: [] })
  }

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open)
    if (!open) {
      setEditingRuleId(null)
      resetRuleOptions()
    }
  }

  const handleEditRule = (rule: AgentRule) => {
    if (rule.type !== "system") {
      return
    }

    setEditingRuleId(rule.id)
    setForcedScope(
      rule.forcedScope ?? { groupIds: ["all-members"], memberIds: [] }
    )
    setForcedScopeOpen(false)
    setDialogOpen(true)
  }

  const handleSubmitRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const form = event.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get("name") ?? "").trim()
    const content = String(formData.get("content") ?? "").trim()

    if (
      !name ||
      !content ||
      forcedScope.groupIds.length + forcedScope.memberIds.length === 0 ||
      editingRule?.type === "user"
    ) {
      return
    }

    if (editingRule) {
      setRules((currentRules) =>
        currentRules.map((rule) =>
          rule.id === editingRule.id
            ? { ...rule, name, content, forcedScope }
            : rule
        )
      )
    } else {
      setRules((currentRules) => [
        ...currentRules,
        {
          id: `rule-${Date.now()}`,
          name,
          content,
          type: "system",
          creator: ADMIN_CREATOR,
          forcedScope,
        },
      ])
    }

    form.reset()
    handleDialogOpenChange(false)
  }

  const handleDeleteRule = () => {
    if (!rulePendingDeletion) {
      return
    }

    setRules((currentRules) =>
      currentRules.filter((rule) => rule.id !== rulePendingDeletion.id)
    )
    setRulePendingDeletion(null)
  }

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <Tabs
        className="gap-4"
        value={activeRuleType}
        onValueChange={(value) => {
          setActiveRuleType(value as RuleType)
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label={t("pages.rules.type")}>
            <TabsTrigger value="system">
              {t("pages.rules.systemRule")}
            </TabsTrigger>
            <TabsTrigger value="user">{t("pages.rules.userRule")}</TabsTrigger>
          </TabsList>
          {activeRuleType === "system" && (
            <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
              <DialogTrigger
                render={
                  <Button
                    onClick={() => {
                      setEditingRuleId(null)
                      resetRuleOptions()
                    }}
                  />
                }
              >
                <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                {t("pages.rules.add")}
              </DialogTrigger>
              <DialogContent
                className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
                closeLabel={t("common.close")}
              >
                <form
                  key={editingRule?.id ?? "new-rule"}
                  className="flex flex-col gap-6"
                  onSubmit={handleSubmitRule}
                >
                  <DialogHeader>
                    <DialogTitle>
                      {editingRule
                        ? t("pages.rules.editDialogTitle")
                        : t("pages.rules.dialogTitle")}
                    </DialogTitle>
                  </DialogHeader>
                  <FieldGroup className="gap-5">
                    <Field>
                      <FieldLabel htmlFor="rule-name">
                        {t("pages.rules.name")}
                      </FieldLabel>
                      <Input
                        id="rule-name"
                        name="name"
                        defaultValue={editingRule?.name}
                        placeholder={t("pages.rules.namePlaceholder")}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="rule-content">
                        {t("pages.rules.content")}
                      </FieldLabel>
                      <Textarea
                        className="max-h-64 min-h-40 resize-y overflow-y-auto"
                        id="rule-content"
                        name="content"
                        defaultValue={editingRule?.content}
                        placeholder={t("pages.rules.contentPlaceholder")}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="rule-forced-scope">
                        {t("pages.rules.forcedScope")}
                      </FieldLabel>
                      <AuthorizationSelect
                        id="rule-forced-scope"
                        open={forcedScopeOpen}
                        placeholder={t("pages.rules.forcedScopePlaceholder")}
                        title={t("pages.rules.forcedScope")}
                        value={forcedScope}
                        onOpenChange={setForcedScopeOpen}
                        onValueChange={setForcedScope}
                      />
                      <FieldDescription>
                        {t("pages.rules.forcedScopeDescription")}
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                  <DialogFooter>
                    <DialogClose
                      render={<Button type="button" variant="outline" />}
                    >
                      {t("pages.rules.cancel")}
                    </DialogClose>
                    <Button type="submit">
                      {editingRule
                        ? t("pages.rules.save")
                        : t("pages.rules.create")}
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
              {rules
                .filter((rule) => rule.type === tabType)
                .map((rule) => {
                  const forcedScopeNames =
                    rule.type === "system" && rule.forcedScope
                      ? getAuthorizationNames(rule.forcedScope, t)
                      : null

                  return (
                    <Card className="h-full" key={rule.id}>
                      <CardHeader>
                        <div className="flex min-w-0 items-start gap-3">
                          <Avatar size="lg">
                            <AvatarFallback>
                              {rule.creator === ADMIN_CREATOR ? (
                                <HugeiconsIcon
                                  icon={DocumentValidationIcon}
                                  strokeWidth={2}
                                />
                              ) : (
                                getCreatorInitials(rule.creator)
                              )}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <CardTitle className="truncate" title={rule.name}>
                              {rule.name}
                            </CardTitle>
                            <CardDescription
                              className="truncate"
                              title={rule.creator}
                            >
                              {rule.creator}
                            </CardDescription>
                          </div>
                          {rule.type === "system" && (
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
                                    onClick={() => handleEditRule(rule)}
                                  >
                                    <HugeiconsIcon
                                      icon={Edit02Icon}
                                      strokeWidth={2}
                                    />
                                    {t("pages.rules.edit")}
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => setRulePendingDeletion(rule)}
                                  >
                                    <HugeiconsIcon
                                      icon={Delete02Icon}
                                      strokeWidth={2}
                                    />
                                    {t("pages.rules.delete")}
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="flex-1">
                        <p
                          className="line-clamp-3 min-h-16 whitespace-pre-wrap text-muted-foreground"
                          title={rule.content}
                        >
                          {rule.content}
                        </p>
                      </CardContent>
                      <CardFooter className="min-w-0 gap-4 border-t">
                        <span
                          className="w-2/5 truncate text-muted-foreground"
                          title={t(
                            rule.type === "system"
                              ? "pages.rules.forcedScope"
                              : "pages.rules.usageScope"
                          )}
                        >
                          {t(
                            rule.type === "system"
                              ? "pages.rules.forcedScope"
                              : "pages.rules.usageScope"
                          )}
                        </span>
                        <span
                          className="w-3/5 truncate text-end font-medium"
                          title={
                            forcedScopeNames ?? t("pages.rules.creatorOnly")
                          }
                        >
                          {forcedScopeNames ?? t("pages.rules.creatorOnly")}
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
        open={rulePendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRulePendingDeletion(null)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.rules.deleteDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.rules.deleteDialogDescription", {
                rule: rulePendingDeletion?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("pages.rules.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDeleteRule}>
              {t("pages.rules.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
