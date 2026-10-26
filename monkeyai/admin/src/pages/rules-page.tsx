import { api } from "@/lib/api"
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
import { ResourceNotice } from "@/components/resource-notice"
import { ResourceEditorFooter } from "@/components/resource-editor-footer"
import {
  RULE_PAGE_SIZE,
  useRulePage,
  type RuleType,
} from "@/hooks/use-rule-page"
import { useState, type FormEvent } from "react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { PageSizeSelect } from "@/components/page-size-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  getAuthorizationNames,
  type AuthorizationSelection,
} from "@/lib/authorization-groups"

type AgentRule = {
  origin?: ResourceRow["origin"]
  publisher?: string
  retired?: boolean
  revision: number
  id: string
  name: string
  description: string
  content: string
  type: RuleType
  creator: string
  sharedUsers: string[]
  authorization: AuthorizationSelection
  grants: ResourceRow["grants"]
  forced: boolean
}

function toRule(row: ResourceRow, language: string): AgentRule {
  const text = localized(row, language)
  return {
    id: row.id,
    origin: row.origin,
    publisher: row.publisher,
    retired: row.retired,
    revision: row.revision,
    name: text.name,
    description: text.description,
    content: row.content,
    type: row.ownership_type,
    creator: row.user.name || row.user.email || row.user.id,
    sharedUsers: row.grants.flatMap((grant) =>
      grant.user ? [grant.user.name || grant.user.email || grant.user.id] : []
    ),
    authorization: selection(row.grants),
    grants: row.grants,
    forced: row.grants.some((grant) => grant.usage_requirement === "required"),
  }
}

function getCreatorInitials(creator: string) {
  return creator.trim().slice(0, 2).toUpperCase()
}

export function RulesPage() {
  const { t, i18n } = useTranslation()
  const [activeRuleType, setActiveRuleType] = useState<RuleType>("system")
  const [searchDraft, setSearchDraft] = useState("")
  const [search, setSearch] = useState("")
  const [cursors, setCursors] = useState<Record<RuleType, string[]>>({
    system: [""],
    user: [""],
  })
  const [pageSize, setPageSize] = useState(RULE_PAGE_SIZE)
  const pageCursors = cursors[activeRuleType]
  const remote = useRulePage(
    activeRuleType,
    pageCursors.at(-1) ?? "",
    search,
    pageSize
  )
  const rules = remote.items.map((row) => toRule(row, i18n.language))
  const subjects = useSubjects()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AgentRule | null>(null)
  const [rulePendingDeletion, setRulePendingDeletion] =
    useState<AgentRule | null>(null)
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({
    groupIds: [],
    memberIds: [],
  })
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
  const [forced, setForced] = useState(false)
  const importedRule = editingRule?.origin === "package"

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (remote.pending) return
    setSearch(searchDraft.trim())
    setCursors({ system: [""], user: [""] })
    remote.reload()
  }

  const previousPage = (type: RuleType = activeRuleType) => {
    setCursors((current) => ({
      ...current,
      [type]:
        current[type].length > 1 ? current[type].slice(0, -1) : current[type],
    }))
  }

  const resetRuleOptions = () => {
    setAuthorization({ groupIds: [], memberIds: [] })
    setForced(false)
  }

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open)
    if (!open) {
      setEditingRule(null)
      resetRuleOptions()
    }
  }

  const handleEditRule = (rule: AgentRule) => {
    if (rule.type !== "system") {
      return
    }

    setAuthorization(rule.authorization)
    setEditingRule(rule)
    setForced(rule.forced)
    setDialogOpen(true)
  }

  const handleSubmitRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const name = String(data.get("name") ?? "")
    const description = String(data.get("description") ?? "")
    await remote.run(async () => {
      if (editingRule?.origin === "package") {
        const overrides: Record<string, string> = {}
        if (name !== editingRule.name) overrides.name = name
        if (description !== editingRule.description) {
          overrides.description = description
        }
        const resource = Object.keys(overrides).length
          ? await saveResource(
              `/rules/${editingRule.id}`,
              overrides,
              editingRule.revision
            )
          : editingRule
        await savePackageGrants(
          "rule",
          resource,
          authorization,
          editingRule.forced
        )
      } else {
        await saveResource(
          editingRule ? `/rules/${editingRule.id}` : "/rules",
          {
            name,
            description,
            content: String(data.get("content") ?? ""),
            grants: grants(authorization, forced),
          },
          editingRule?.revision
        )
      }
      handleDialogOpenChange(false)
    }, t("resources.operationCompleted"))
  }
  const handleDeleteRule = async () => {
    if (!rulePendingDeletion || rulePendingDeletion.origin === "package") return
    await remote.run(async () => {
      await api(base + `/rules/${rulePendingDeletion.id}`, {
        method: "DELETE",
        headers: match(rulePendingDeletion.revision),
      })
      if (rules.length === 1) previousPage(rulePendingDeletion.type)
      setRulePendingDeletion(null)
    }, t("resources.operationCompleted"))
  }

  return (
    <section className="flex h-[calc(100vh-4rem)] min-h-0 flex-none flex-col gap-4 p-4 pt-0 md:h-[calc(100vh-5rem)]">
      <Tabs
        className="-m-1 min-h-0 flex-1 gap-4 overflow-hidden p-1"
        value={activeRuleType}
        onValueChange={(value) => {
          setActiveRuleType(value as RuleType)
        }}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <TabsList className="shrink-0" aria-label={t("pages.rules.type")}>
            <TabsTrigger value="system" disabled={remote.pending}>
              {t("pages.rules.systemRule")}
            </TabsTrigger>
            <TabsTrigger value="user" disabled={remote.pending}>
              {t("pages.rules.userRule")}
            </TabsTrigger>
          </TabsList>
          <form
            className="order-2 flex basis-full items-center gap-2 sm:order-none sm:max-w-72 sm:min-w-40 sm:flex-1 sm:basis-0"
            onSubmit={handleSearch}
          >
            <Input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("resources.ruleSearchPlaceholder")}
              aria-label={t("resources.ruleSearchPlaceholder")}
            />
          </form>
          {activeRuleType === "system" && (
            <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
              <DialogTrigger
                render={
                  <Button
                    className="ms-auto shrink-0"
                    onClick={() => {
                      setEditingRule(null)
                      resetRuleOptions()
                    }}
                  />
                }
              >
                <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                {t("pages.rules.add")}
              </DialogTrigger>
              <DialogContent
                className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl"
                closeLabel={t("common.close")}
                aria-describedby={
                  importedRule ? "imported-rule-readonly" : undefined
                }
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
                  <FieldGroup className="gap-4">
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
                      {importedRule && editingRule?.retired && (
                        <p className="text-sm text-amber-700">
                          {t("resources.retiredGrantsOnly")}
                        </p>
                      )}
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
                      <FieldLabel htmlFor="rule-description">
                        {t("pages.rules.ruleDescription")}
                      </FieldLabel>
                      <Textarea
                        className="max-h-32 min-h-20 resize-none overflow-y-auto"
                        id="rule-description"
                        name="description"
                        defaultValue={editingRule?.description}
                        placeholder={t(
                          "pages.rules.ruleDescriptionPlaceholder"
                        )}
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
                        disabled={importedRule}
                        placeholder={t("pages.rules.contentPlaceholder")}
                        required
                      />
                    </Field>
                    <Field orientation="horizontal">
                      <Checkbox
                        id="rule-forced"
                        checked={forced}
                        disabled={importedRule}
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
                  <ResourceEditorFooter
                    id="imported-rule-readonly"
                    reason={
                      importedRule
                        ? t("resources.importedRuleReadOnly")
                        : undefined
                    }
                  >
                    <DialogClose
                      render={<Button type="button" variant="outline" />}
                    >
                      {t("pages.rules.cancel")}
                    </DialogClose>
                    <Button
                      type="submit"
                      loading={remote.pending}
                      disabled={remote.pending}
                    >
                      {editingRule
                        ? t("pages.rules.save")
                        : t("pages.rules.create")}
                    </Button>
                  </ResourceEditorFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <TabsContent
          key={activeRuleType}
          value={activeRuleType}
          className="min-h-0 overflow-hidden"
        >
          <ScrollArea
            key={`${search}:${pageCursors.length}:${pageSize}`}
            className="h-full"
          >
            <div className="flex flex-col gap-4 p-px">
              <ResourceNotice
                error={remote.error || subjects.error}
                loading={remote.loading}
                pending={remote.pending}
              />
              {remote.error && (
                <Button
                  className="self-start"
                  type="button"
                  variant="outline"
                  onClick={remote.reload}
                >
                  {t("statistics.retry")}
                </Button>
              )}
              {!remote.loading && !remote.error && rules.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {t("statistics.empty")}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {rules.map((rule) => {
                  const scopeNames =
                    rule.type === "system"
                      ? getAuthorizationNames(
                          rule.authorization,
                          t,
                          subjects.flatGroups,
                          subjects.members
                        )
                      : rule.sharedUsers.length
                        ? [rule.creator, ...rule.sharedUsers].join(", ")
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
                              {rule.name}{" "}
                              {rule.origin === "package" && (
                                <span title={rule.publisher}>· 资源包导入</span>
                              )}
                            </CardTitle>
                            <CardDescription
                              className="truncate"
                              title={rule.creator}
                            >
                              {rule.creator}
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
                                hidden={
                                  rule.type !== "system" ||
                                  rule.origin === "package"
                                }
                              />
                              <DropdownMenuGroup
                                hidden={rule.origin === "package"}
                              >
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
                        </div>
                      </CardHeader>
                      <CardContent className="min-h-10 flex-1">
                        <p
                          className="line-clamp-2 whitespace-pre-wrap text-muted-foreground"
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
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <PageSizeSelect
          value={pageSize}
          onValueChange={(size) => {
            setPageSize(size)
            setCursors({ system: [""], user: [""] })
          }}
          disabled={remote.pending}
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {t("pages.sessionReporting.clients.cursorPage", {
              page: pageCursors.length,
            })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={
              remote.loading || remote.pending || pageCursors.length === 1
            }
            onClick={() => previousPage()}
            aria-label={t("pages.operationLogs.pagination.previous")}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="[[dir=rtl]_&]:rotate-180" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={remote.loading || remote.pending || !remote.nextCursor}
            onClick={() => {
              if (!remote.nextCursor) return
              setCursors((current) => ({
                ...current,
                [activeRuleType]: [
                  ...current[activeRuleType],
                  remote.nextCursor,
                ],
              }))
            }}
            aria-label={t("pages.operationLogs.pagination.next")}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} className="[[dir=rtl]_&]:rotate-180" />
          </Button>
        </div>
      </div>

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
            <AlertDialogCancel disabled={remote.pending}>
              {t("pages.rules.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              loading={remote.pending}
              variant="destructive"
              onClick={handleDeleteRule}
            >
              {t("pages.rules.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
