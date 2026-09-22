import { api } from "@/lib/api"
import {
  base,
  grants,
  selection,
  match,
  saveResource,
  useResources,
  useSubjects,
  type ResourceRow,
} from "@/lib/resources"
import { ResourceNotice } from "@/components/resource-notice"
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
import { Checkbox } from "@/components/ui/checkbox"
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
  revision: number
  id: string
  name: string
  content: string
  type: RuleType
  creator: string
  authorization: AuthorizationSelection
  forced: boolean
}

function toRule(row: ResourceRow): AgentRule {
  return {
    id: row.id,
    revision: row.revision,
    name: row.name,
    content: row.content,
    type: row.ownership_type,
    creator: row.user.name || row.user.email || row.user.id,
    authorization: selection(row.grants),
    forced: row.grants.some((grant) => grant.usage_requirement === "required"),
  }
}

function getCreatorInitials(creator: string) {
  return creator.trim().slice(0, 2).toUpperCase()
}

export function RulesPage() {
  const { t } = useTranslation()
  const remote = useResources("/rules", toRule)
  const rules = remote.items
  const subjects = useSubjects()
  const [activeRuleType, setActiveRuleType] = useState<RuleType>("system")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [rulePendingDeletion, setRulePendingDeletion] =
    useState<AgentRule | null>(null)
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({
    groupIds: [],
    memberIds: [],
  })
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
  const [forced, setForced] = useState(false)
  const editingRule = rules.find((rule) => rule.id === editingRuleId)

  const resetRuleOptions = () => {
    setAuthorization({ groupIds: [], memberIds: [] })
    setForced(false)
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

    setAuthorization(rule.authorization)
    setEditingRuleId(rule.id)
    setForced(rule.forced)
    setDialogOpen(true)
  }

  const handleSubmitRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    await remote.run(async () => {
      await saveResource(
        editingRule ? `/rules/${editingRule.id}` : "/rules",
        {
          name: String(data.get("name") ?? ""),
          content: String(data.get("content") ?? ""),
          grants: grants(authorization, forced),
        },
        editingRule?.revision
      )
      handleDialogOpenChange(false)
    }, t("resources.operationCompleted"))
  }
  const handleDeleteRule = async () => {
    if (!rulePendingDeletion) return
    await remote.run(async () => {
      await api(base + `/rules/${rulePendingDeletion.id}`, {
        method: "DELETE",
        headers: match(rulePendingDeletion.revision),
      })
      setRulePendingDeletion(null)
    }, t("resources.operationCompleted"))
  }

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <ResourceNotice
        error={remote.error || subjects.error}
        loading={remote.loading}
        pending={remote.pending}
      />
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
                      <FieldLabel>{t("resources.availableScope")}</FieldLabel>
                      <AuthorizationSelect
                        groups={subjects.groups}
                        members={subjects.members}
                        id="rule-available"
                        open={authorizationOpen}
                        onOpenChange={setAuthorizationOpen}
                        value={authorization}
                        onValueChange={setAuthorization}
                        title={t("resources.availableScope")}
                        placeholder={t("resources.selectScope")}
                      />
                    </Field>
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
                    <Field orientation="horizontal">
                      <Checkbox
                        id="rule-forced"
                        checked={forced}
                        onCheckedChange={setForced}
                      />
                      <div className="flex flex-col gap-1">
                        <FieldLabel htmlFor="rule-forced">
                          {t("pages.rules.forcedScope")}
                        </FieldLabel>
                        <FieldDescription>
                          {t("pages.rules.forcedScopeDescription")}
                        </FieldDescription>
                      </div>
                    </Field>
                  </FieldGroup>
                  <ResourceNotice
                    error={remote.error || subjects.error}
                    loading={false}
                    pending={remote.pending}
                  />
                  <DialogFooter>
                    <DialogClose
                      render={<Button type="button" variant="outline" />}
                    >
                      {t("pages.rules.cancel")}
                    </DialogClose>
                    <Button type="submit" disabled={remote.pending}>
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
                  const scopeNames =
                    rule.type === "system"
                      ? getAuthorizationNames(
                          rule.authorization,
                          t,
                          subjects.flatGroups,
                          subjects.members
                        )
                      : t("pages.rules.creatorOnly")

                  return (
                    <Card className="h-full" key={rule.id}>
                      <CardHeader>
                        <div className="flex min-w-0 items-start gap-3">
                          <Avatar size="lg">
                            <AvatarFallback>
                              {rule.type === "system" ? (
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
                          {
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
                                <DropdownMenuGroup
                                  hidden={rule.type !== "system"}
                                >
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
                                <DropdownMenuSeparator
                                  hidden={rule.type !== "system"}
                                />
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
                          }
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
                      <CardFooter className="min-w-0 flex-col items-stretch gap-2 border-t">
                        <div className="flex gap-4">
                          <span className="w-2/5 truncate text-muted-foreground">
                            {t("pages.rules.usageScope")}
                          </span>
                          <span
                            className="w-3/5 truncate text-end font-medium"
                            title={scopeNames}
                          >
                            {scopeNames}
                          </span>
                        </div>
                        {rule.type === "system" && (
                          <div className="flex gap-4">
                            <span className="w-2/5 truncate text-muted-foreground">
                              {t("pages.rules.forcedScope")}
                            </span>
                            <span className="w-3/5 truncate text-end font-medium">
                              {rule.forced
                                ? t("pages.rules.forcedScope")
                                : t("pages.rules.forcedScopePlaceholder")}
                            </span>
                          </div>
                        )}
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.rules.deleteDialogTitle")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t("pages.rules.deleteDialogDescription", {
              rule: rulePendingDeletion?.name ?? "",
            })}
          </AlertDialogDescription>
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
