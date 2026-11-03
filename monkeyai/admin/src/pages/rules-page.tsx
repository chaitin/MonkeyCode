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
import { getCreatorInitial } from "@/lib/utils"
import { ResourceList } from "@/components/resource-list"
import { ResourceNotice } from "@/components/resource-notice"
import { ResourceBatchActions } from "@/components/resource-batch-actions"
import { useResourceList } from "@/hooks/use-resource-list"
import { useResourceBatch } from "@/hooks/use-resource-batch"
import { ResourceTagSummary } from "@/components/resource-tag-summary"
import { ResourceCard } from "@/components/resource-card"
import { ResourceCardMenuButton } from "@/components/resource-card-menu-button"
import { ResourceEditorFooter } from "@/components/resource-editor-footer"
import type { RuleType } from "@/hooks/use-rule-page"
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
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { AuthorizationSelection } from "@/lib/authorization-groups"

type AgentRule = {
  origin?: ResourceRow["origin"]
  publisher?: string
  retired?: boolean
  revision: number
  enabled: boolean
  id: string
  name: string
  description: string
  tagIds: string[]
  content: string
  type: RuleType
  creator: string
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
    enabled: row.enabled,
    name: text.name,
    description: text.description,
    tagIds: (row.tags ?? []).map((tag) => tag.id),
    content: row.content,
    type: row.ownership_type,
    creator: row.user.name || row.user.email || row.user.id,
    authorization: selection(row.grants),
    grants: row.grants,
    forced: row.grants.some((grant) => grant.usage_requirement === "required"),
  }
}

export function RulesPage() {
  const { t, i18n } = useTranslation()
  const remote = useResourceList("/rules")
  const batch = useResourceBatch("rule", remote)
  const activeRuleType = remote.type
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
      if (rules.length === 1) remote.previousPage(rulePendingDeletion.type)
      setRulePendingDeletion(null)
    }, t("resources.operationCompleted"))
  }

  return (
    <section className="flex h-[calc(100vh-4rem)] min-h-0 flex-none flex-col gap-4 p-4 pt-0 md:h-[calc(100vh-5rem)]">
      <ResourceList
        page={batch.page}
        error={subjects.error}
        typeLabel={t("pages.rules.type")}
        systemLabel={t("pages.rules.systemRule")}
        userLabel={t("pages.rules.userRule")}
        searchPlaceholder={t("resources.searchPlaceholder", {
          resource: t("pages.rules.title"),
        })}
        searchClassName="sm:max-w-44 sm:flex-none"
        actions={
          <div className="ms-auto flex shrink-0 items-center gap-2">
            <ResourceBatchActions
              key={batch.key}
              {...batch.actions}
              groups={subjects.groups}
              members={subjects.members}
            />
            {activeRuleType === "system" && (
              <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
                <DialogTrigger
                  render={
                    <Button
                      className="shrink-0"
                      disabled={remote.pending}
                      onClick={() => {
                        batch.exit()
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
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rules.map((rule) => {
            return (
              <ResourceCard
                key={rule.id}
                origin={rule.origin}
                disabled={!rule.enabled}
                {...batch.cardProps(rule.id, rule.name, rule.type)}
              >
                <CardHeader>
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar size="lg">
                      <AvatarFallback
                        className={
                          rule.type === "user"
                            ? "text-lg font-normal"
                            : undefined
                        }
                      >
                        {rule.type === "system" ? (
                          <HugeiconsIcon
                            icon={DocumentValidationIcon}
                            strokeWidth={2}
                          />
                        ) : (
                          getCreatorInitial(rule.creator)
                        )}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="flex min-w-0 items-center gap-2">
                        <span className="truncate" title={rule.name}>
                          {rule.name}
                        </span>
                        {rule.origin === "package" && (
                          <Badge variant="amber" title={rule.publisher}>
                            资源包导入
                          </Badge>
                        )}
                        {!rule.enabled && (
                          <Badge variant="outline">
                            {t("resources.batch.disabled")}
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription
                        className="truncate"
                        title={rule.creator}
                      >
                        {rule.creator}
                      </CardDescription>
                    </div>
                    {batch.actions.selecting && rule.type === "system" ? (
                      <Checkbox
                        checked={batch.isSelected(rule.id)}
                        disabled={remote.pending}
                        aria-label={t("resources.batch.selectResource", {
                          name: rule.name,
                        })}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={() => batch.toggle(rule.id)}
                      />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <ResourceCardMenuButton
                              aria-label={t("common.more")}
                              tone={
                                rule.origin !== "package" && rule.enabled
                                  ? "blue"
                                  : "neutral"
                              }
                            />
                          }
                        >
                          <HugeiconsIcon
                            icon={MoreHorizontalIcon}
                            strokeWidth={2}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup hidden={rule.type !== "system"}>
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
                              disabled={rule.origin === "package"}
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
                <CardContent>
                  <p
                    className="truncate text-muted-foreground"
                    title={rule.description}
                  >
                    {rule.description?.trim() || t("resources.noDescription")}
                  </p>
                </CardContent>
                <CardFooter className="min-w-0 border-t">
                  <ResourceTagSummary tagIds={rule.tagIds} />
                </CardFooter>
              </ResourceCard>
            )
          })}
        </div>
      </ResourceList>

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
