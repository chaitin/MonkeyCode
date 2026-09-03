import type { ReactNode } from "react"
import {
  Folder02Icon,
  FolderIcon,
  UnfoldMoreIcon,
  User02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  AUTHORIZATION_GROUP_TREE,
  AUTHORIZATION_MEMBERS,
  getAuthorizationNames,
  type AuthorizationGroup,
  type AuthorizationGroupNode,
  type AuthorizationSelection,
} from "@/lib/authorization-groups"
import { cn } from "@/lib/utils"

function getGroupAndDescendantIds(
  group: AuthorizationGroupNode
): AuthorizationGroup[] {
  return [
    group.value,
    ...(group.children?.flatMap(getGroupAndDescendantIds) ?? []),
  ]
}

function getMemberIdsInGroupTree(group: AuthorizationGroupNode) {
  const groupIds = new Set(getGroupAndDescendantIds(group))

  return AUTHORIZATION_MEMBERS.filter((member) =>
    groupIds.has(member.groupId)
  ).map((member) => member.id)
}

export function AuthorizationSelect({
  id,
  open,
  placeholder,
  title,
  value,
  onOpenChange,
  onValueChange,
}: {
  id: string
  open: boolean
  placeholder: string
  title: string
  value: AuthorizationSelection
  onOpenChange: (open: boolean) => void
  onValueChange: (value: AuthorizationSelection) => void
}) {
  const { t } = useTranslation()
  const summary = getAuthorizationNames(value, t)

  const setGroupChecked = (group: AuthorizationGroupNode, checked: boolean) => {
    if (!checked) {
      onValueChange({
        ...value,
        groupIds: value.groupIds.filter((groupId) => groupId !== group.value),
      })
      return
    }

    const descendantGroupIds = new Set(getGroupAndDescendantIds(group))
    const inheritedMemberIds = new Set(getMemberIdsInGroupTree(group))

    onValueChange({
      groupIds: [
        ...value.groupIds.filter((groupId) => !descendantGroupIds.has(groupId)),
        group.value,
      ],
      memberIds: value.memberIds.filter(
        (memberId) => !inheritedMemberIds.has(memberId)
      ),
    })
  }

  const setMemberChecked = (memberId: string, checked: boolean) => {
    onValueChange({
      ...value,
      memberIds: checked
        ? [...value.memberIds, memberId]
        : value.memberIds.filter((id) => id !== memberId),
    })
  }

  const renderGroup = (
    group: AuthorizationGroupNode,
    level = 0,
    inherited = false
  ): ReactNode => {
    const selected = value.groupIds.includes(group.value)
    const effectivelySelected = inherited || selected
    const subtreeGroupIds = new Set(getGroupAndDescendantIds(group))
    const subtreeMemberIds = new Set(getMemberIdsInGroupTree(group))
    const partiallySelected =
      !effectivelySelected &&
      (value.groupIds.some(
        (groupId) => groupId !== group.value && subtreeGroupIds.has(groupId)
      ) ||
        value.memberIds.some((memberId) => subtreeMemberIds.has(memberId)))
    const directMembers = AUTHORIZATION_MEMBERS.filter(
      (member) => member.groupId === group.value
    )
    const groupCheckboxId = `${id}-group-${group.value}`

    return (
      <div className="flex flex-col" key={group.value} role="treeitem">
        <label
          className={cn(
            "flex min-w-0 cursor-pointer items-center gap-2 rounded-md py-1.5 pe-2 hover:bg-muted",
            inherited && "cursor-not-allowed opacity-60"
          )}
          htmlFor={groupCheckboxId}
          style={{ paddingInlineStart: `${level * 1.25 + 0.5}rem` }}
        >
          <Checkbox
            checked={effectivelySelected}
            disabled={inherited}
            id={groupCheckboxId}
            indeterminate={partiallySelected}
            onCheckedChange={(checked) => {
              setGroupChecked(group, checked)
            }}
          />
          <HugeiconsIcon
            className="size-4 shrink-0 text-muted-foreground"
            icon={group.children ? Folder02Icon : FolderIcon}
            strokeWidth={2}
          />
          <span className="truncate">{t(group.labelKey)}</span>
        </label>

        {group.children?.map((child) =>
          renderGroup(child, level + 1, effectivelySelected)
        )}

        {directMembers.map((member) => {
          const memberCheckboxId = `${id}-member-${member.id}`
          const explicitlySelected = value.memberIds.includes(member.id)

          return (
            <label
              className={cn(
                "flex min-w-0 cursor-pointer items-center gap-2 rounded-md py-1.5 pe-2 hover:bg-muted",
                effectivelySelected && "cursor-not-allowed opacity-60"
              )}
              htmlFor={memberCheckboxId}
              key={member.id}
              style={{ paddingInlineStart: `${(level + 1) * 1.25 + 0.5}rem` }}
            >
              <Checkbox
                checked={effectivelySelected || explicitlySelected}
                disabled={effectivelySelected}
                id={memberCheckboxId}
                onCheckedChange={(checked) => {
                  setMemberChecked(member.id, checked)
                }}
              />
              <HugeiconsIcon
                className="size-4 shrink-0 text-muted-foreground"
                icon={User02Icon}
                strokeWidth={2}
              />
              <span className="min-w-0 flex-1 truncate">{member.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {member.email}
              </span>
            </label>
          )
        })}
      </div>
    )
  }

  return (
    <Popover modal={false} open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            className="w-full min-w-0 justify-between font-normal"
            id={id}
            type="button"
            variant="outline"
          />
        }
      >
        <span
          className={cn("truncate", !summary && "text-muted-foreground")}
          title={summary || placeholder}
        >
          {summary || placeholder}
        </span>
        <HugeiconsIcon icon={UnfoldMoreIcon} data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-80 w-(--anchor-width) gap-0 overflow-y-auto p-1"
      >
        <PopoverHeader className="sr-only">
          <PopoverTitle>{title}</PopoverTitle>
        </PopoverHeader>
        <div role="tree">
          {AUTHORIZATION_GROUP_TREE.map((group) => renderGroup(group))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
