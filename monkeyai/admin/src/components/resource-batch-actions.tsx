import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  CheckmarkSquare02Icon,
  Delete02Icon,
  Logout05Icon,
  PauseIcon,
  PlayIcon,
  SquareIcon,
  Tag01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { useTranslation } from "react-i18next"

import { GroupSelect, type GroupSelectOption } from "@/components/group-select"
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
import { Button } from "@/components/ui/button"
import {
  Dialog,
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
import { useSkillTags } from "@/hooks/use-skill-tags"
import type {
  AuthorizationGroupNode,
  AuthorizationMember,
  AuthorizationSelection,
} from "@/lib/authorization-groups"

import type {
  ResourceBatchChange,
  ResourceBatchProgress,
  ResourceBatchKind,
} from "@/lib/resource-batch"

type BatchAction = ResourceBatchChange["action"]

export type ResourceBatchActionsProps = {
  kind: ResourceBatchKind
  selecting: boolean
  selectedCount: number
  disabled: boolean
  pending: boolean
  progress: ResourceBatchProgress
  groups: AuthorizationGroupNode[]
  members: AuthorizationMember[]
  onEnter: () => void
  onSelectAll: () => void
  onClear: () => void
  onExit: () => void
  onApply: (change: ResourceBatchChange) => Promise<boolean>
}

function groupOptions(
  groups: AuthorizationGroupNode[],
  parentId: string | null = null
): GroupSelectOption[] {
  return groups.flatMap((group) => [
    { id: group.value, name: group.labelKey, parentId },
    ...groupOptions(group.children ?? [], group.value),
  ])
}

export function ResourceBatchActions({
  kind,
  selecting,
  selectedCount,
  disabled,
  pending,
  progress,
  groups,
  members,
  onEnter,
  onSelectAll,
  onClear,
  onExit,
  onApply,
}: ResourceBatchActionsProps) {
  const { t, i18n } = useTranslation()
  const text = (key: string, values: Record<string, unknown> = {}) =>
    t(`resources.batch.${key}`, {
      resource: t(`resources.batch.resourceNames.${kind}`),
      ...values,
    })
  const { tags } = useSkillTags()
  const [menuOpen, setMenuOpen] = useState(false)
  const [action, setAction] = useState<BatchAction | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({
    groupIds: [],
    memberIds: [],
  })
  const editing = action === "tags" || action === "authorization"
  const actions = [
    ["enable", PlayIcon],
    ["disable", PauseIcon],
    ["tags", Tag01Icon],
    ["authorization", UserGroupIcon],
    ["delete", Delete02Icon],
  ] as const

  const openAction = (next: BatchAction) => {
    if (!selectedCount || disabled) return
    setMenuOpen(false)
    setConfirmOpen(false)
    setTagsOpen(false)
    setTagIds([])
    setAuthorization({ groupIds: [], memberIds: [] })
    setAction(next)
  }

  const apply = async () => {
    if (!action || pending || !selectedCount) return
    const change: ResourceBatchChange =
      action === "tags"
        ? { action, tagIds }
        : action === "authorization"
          ? { action, authorization }
          : { action }
    if (!(await onApply(change))) return
    setAction(null)
    setConfirmOpen(false)
    setMenuOpen(false)
  }

  return (
    <>
      {selecting ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="outline" disabled={disabled}>
                {text("actions")}
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  data-icon="inline-end"
                  className="rotate-90"
                />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-40 whitespace-nowrap">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onSelectAll}>
                <HugeiconsIcon icon={CheckmarkSquare02Icon} strokeWidth={2} />
                {text("selectAll")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onClear}>
                <HugeiconsIcon icon={SquareIcon} strokeWidth={2} />
                {text("clear")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {actions.map(([next, icon]) => (
                <DropdownMenuItem
                  key={next}
                  variant={next === "delete" ? "destructive" : undefined}
                  disabled={selectedCount === 0}
                  onClick={() => openAction(next)}
                >
                  <HugeiconsIcon icon={icon} strokeWidth={2} />
                  {text(`${next}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false)
                  onExit()
                }}
              >
                <HugeiconsIcon icon={Logout05Icon} strokeWidth={2} />
                {text("exit")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            onEnter()
            setMenuOpen(true)
          }}
        >
          {text("actions")}
        </Button>
      )}
      <Dialog
        open={editing}
        onOpenChange={(open) => {
          if (!open && !pending) setAction(null)
        }}
      >
        <DialogContent className="sm:max-w-sm" showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>{action && text(`${action}`)}</DialogTitle>
          </DialogHeader>
          {action === "tags" ? (
            <SkillTagSelect
              id={`batch-${kind}-tags`}
              open={tagsOpen}
              options={tags}
              placeholder={text("tagsPlaceholder")}
              value={tagIds}
              onOpenChange={setTagsOpen}
              onValueChange={setTagIds}
            />
          ) : (
            <GroupSelect
              id={`batch-${kind}-authorization`}
              disabled={pending}
              options={groupOptions(groups)}
              users={members.map((member) => ({
                id: member.id,
                name: member.name,
                email: member.email ?? "",
                groupIds: member.groupId ? [member.groupId] : [],
              }))}
              value={{
                groupIds: authorization.groupIds,
                userIds: authorization.memberIds,
              }}
              onValueChange={(next) =>
                setAuthorization({
                  groupIds: [...next.groupIds],
                  memberIds: [...next.userIds],
                })
              }
              label={text("authorizedUsers")}
              placeholder={text("authorizationPlaceholder")}
              emptyText={t("pages.models.noMatchingAuthorization")}
              locale={i18n.resolvedLanguage ?? i18n.language}
              multiple
              selectionMode="both"
              cascadeGroups
              searchable
              searchPlaceholder={t("pages.models.searchAuthorization")}
              noResultsText={t("pages.models.noMatchingAuthorization")}
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setAction(null)}
            >
              {text("cancel")}
            </Button>
            <Button
              type="button"
              disabled={
                pending ||
                (action === "authorization" &&
                  authorization.groupIds.length +
                    authorization.memberIds.length ===
                    0)
              }
              onClick={() => setConfirmOpen(true)}
            >
              {text("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={action !== null && (!editing || confirmOpen)}
        onOpenChange={(open) => {
          if (open || pending) return
          if (editing) setConfirmOpen(false)
          else setAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action && text(`confirmTitles.${action}`)}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {action &&
              text(`confirmDescriptions.${action}`, {
                count: selectedCount,
              })}
          </AlertDialogDescription>
          {pending && (
            <p role="status" className="text-sm text-muted-foreground">
              {text("progress", progress)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {text("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={action === "delete" ? "destructive" : undefined}
              loading={pending}
              disabled={selectedCount === 0}
              onClick={apply}
            >
              {text("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
