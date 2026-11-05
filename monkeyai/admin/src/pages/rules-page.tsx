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
import { ResourcePackageBadge } from "@/components/resource-package-badge"
import { ResourceAuthorizationBadge } from "@/components/resource-authorization-badge"
import { SkillTagSelect } from "@/components/skill-tag-select"
import { useSkillTags } from "@/hooks/use-skill-tags"
import { ResourceCard } from "@/components/resource-card"
import { ResourceCardMenuButton } from "@/components/resource-card-menu-button"
import { ResourceEditorFooter } from "@/components/resource-editor-footer"
import type { RuleType } from "@/hooks/use-rule-page"
import { useState, type FormEvent } from "react"
import {
  Copy01Icon,
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item"
import { Switch } from "@/components/ui/switch"
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
  const authorizationGroupNames = new Map(
    subjects.flatGroups.map((group) => [group.value, group.labelKey])
  )
  const authorizationMemberNames = new Map(
    subjects.members.map((member) => [member.id, member.name || member.email])
  )
  const { tags: availableTags } = useSkillTags()
  const [tagIds, setTagIds] = useState<string[]>([])
  const [tagsOpen, setTagsOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AgentRule | null>(null)
  const [copiedRule, setCopiedRule] = useState<AgentRule | null>(null)
  const [rulePendingDeletion, setRulePendingDeletion] =
    useState<AgentRule | null>(null)
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({
    groupIds: [],
    memberIds: [],
  })
  const [forced, setForced] = useState(false)
  const importedRule = editingRule?.origin === "package"
  const ruleDraft = editingRule ?? copiedRule

  const resetRuleOptions = () => {
    setAuthorization({ groupIds: [], memberIds: [] })
    setForced(false)
    setTagIds([])
    setTagsOpen(false)
  }

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open)
    if (!open) {
      setEditingRule(null)
      setCopiedRule(null)
      resetRuleOptions()
    }
  }

  const handleEditRule = (rule: AgentRule) => {
    if (rule.type !== "system") {
      return
    }

    setCopiedRule(null)
    setTagIds([...rule.tagIds])
    setTagsOpen(false)
    setAuthorization(rule.authorization)
    setEditingRule(rule)
    setForced(rule.forced)
    setDialogOpen(true)
  }

  const handleCopyRule = (rule: AgentRule) => {
    if (rule.type !== "system" || remote.pending) return
    batch.exit()
    setEditingRule(null)
    setCopiedRule(rule)
    setTagIds([...rule.tagIds])
    setTagsOpen(false)
    setAuthorization({
      groupIds: [...rule.authorization.groupIds],
      memberIds: [...rule.authorization.memberIds],
    })
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
        const ruleGrants = grants(authorization, forced)
        if (copiedRule && forced === copiedRule.forced) {
          for (const grant of ruleGrants) {
            const original = copiedRule.grants.find((entry) =>
              entry.group_id
                ? entry.group_id === grant.group_id
                : entry.user_id === grant.user_id
            )
            if (original) grant.usage_requirement = original.usage_requirement
          }
        }
        await saveResource(
          editingRule ? `/rules/${editingRule.id}` : "/rules",
          {
            name,
            description,
            content: String(data.get("content") ?? ""),
            tag_ids: [...tagIds],
            grants: ruleGrants,
          },
          editingRule?.revision
        )
      }
      handleDialogOpenChange(false)
    }, t("resources.operationCompleted"))
  }
  const setRuleEnabled = async (rule: AgentRule, enabled: boolean) => {
    if (rule.type !== "system" || rule.enabled === enabled) return
    await remote.run(async () => {
      await api(base + `/rules/${rule.id}/enabled`, {
        method: "PATCH",
        headers: match(rule.revision),
        body: JSON.stringify({ enabled }),
      })
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
                        setCopiedRule(null)
                        resetRuleOptions()
                      }}
                    />
                  }
                >
                  <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                  {t("pages.rules.add")}
                </DialogTrigger>
                <DialogContent
                  className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl"
                  closeLabel={t("common.close")}
                  aria-describedby={
                    importedRule ? "imported-rule-readonly" : undefined
                  }
                >
                  <form
                    key={
                      editingRule
                        ? `edit-${editingRule.id}`
                        : copiedRule
                          ? `copy-${copiedRule.id}`
                          : "new-rule"
                    }
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
                        <FieldLabel htmlFor="rule-name">
                          {t("pages.rules.name")}
                        </FieldLabel>
                        <Input
                          id="rule-name"
                          name="name"
                          defaultValue={ruleDraft?.name}
                          placeholder={t("pages.rules.namePlaceholder")}
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="rule-description">
                          {t("pages.rules.ruleDescription")}
                        </FieldLabel>
                        <Input
                          id="rule-description"
                          name="description"
                          defaultValue={ruleDraft?.description}
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
                          className="max-h-40 min-h-24 resize-y overflow-y-auto"
                          id="rule-content"
                          name="content"
                          defaultValue={ruleDraft?.content}
                          disabled={importedRule}
                          placeholder={t("pages.rules.contentPlaceholder")}
                          required
                        />
                      </Field>
                      <Field>
                        <Item variant="outline">
                          <ItemContent>
                            <ItemTitle>
                              {t("pages.rules.forcedScope")}
                            </ItemTitle>
                          </ItemContent>
                          <ItemActions>
                            <Switch
                              id="rule-forced"
                              checked={forced}
                              disabled={importedRule || remote.pending}
                              onCheckedChange={setForced}
                              aria-label={t("pages.rules.forcedScope")}
                            />
                          </ItemActions>
                        </Item>
                      </Field>
                      <div className="grid min-w-0 grid-cols-2 gap-4">
                        <fieldset
                          disabled={importedRule || remote.pending}
                          className="min-w-0"
                        >
                          <Field>
                            <FieldLabel htmlFor="rule-tags">
                              {t("pages.skills.tags")}
                            </FieldLabel>
                            <SkillTagSelect
                              id="rule-tags"
                              open={tagsOpen}
                              options={availableTags}
                              placeholder={t("pages.skills.tagsPlaceholder")}
                              value={tagIds}
                              onOpenChange={setTagsOpen}
                              onValueChange={setTagIds}
                            />
                          </Field>
                        </fieldset>
                        <Field className="min-w-0">
                          <FieldLabel htmlFor="rule-available">
                            {t("pages.rules.usageScope")}
                          </FieldLabel>
                          <AuthorizationSelect
                            id="rule-available"
                            groups={subjects.groups}
                            members={subjects.members}
                            value={authorization}
                            onValueChange={setAuthorization}
                            disabled={remote.pending}
                            title={t("pages.rules.usageScope")}
                          />
                          {importedRule && editingRule?.retired && (
                            <p className="text-sm text-amber-700">
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
                              disabled={rule.enabled || remote.pending}
                              onClick={() => setRuleEnabled(rule, true)}
                            >
                              <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
                              {t("resources.enable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!rule.enabled || remote.pending}
                              onClick={() => setRuleEnabled(rule, false)}
                            >
                              <HugeiconsIcon icon={PauseIcon} strokeWidth={2} />
                              {t("resources.disable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleEditRule(rule)}
                            >
                              <HugeiconsIcon
                                icon={Edit02Icon}
                                strokeWidth={2}
                              />
                              {t("pages.rules.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={remote.pending}
                              onClick={() => handleCopyRule(rule)}
                            >
                              <HugeiconsIcon
                                icon={Copy01Icon}
                                strokeWidth={2}
                              />
                              {t("pages.models.copy")}
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
                  <ResourceTagSummary
                    tagIds={rule.tagIds}
                    leading={
                      <>
                        <ResourceAuthorizationBadge
                          grants={rule.grants}
                          groupNames={authorizationGroupNames}
                          memberNames={authorizationMemberNames}
                          fallback={
                            rule.type === "user" ? rule.creator : undefined
                          }
                        />
                        {rule.origin === "package" && (
                          <ResourcePackageBadge kind="rule" />
                        )}
                        <Badge
                          variant="outline"
                          className={
                            rule.forced
                              ? "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-200"
                              : "border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-800 dark:bg-lime-950 dark:text-lime-200"
                          }
                        >
                          {t(
                            rule.forced
                              ? "pages.rules.forcedEnabled"
                              : "pages.rules.notForcedEnabled"
                          )}
                        </Badge>
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
