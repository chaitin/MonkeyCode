import {
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import {
  Folder02Icon,
  FolderIcon,
  UnfoldMoreIcon,
  User02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  createGroupSearchIndex,
  searchGroupTree,
} from "@/lib/group-select-search"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  changeGroupSelection,
  inheritedGroupSelection,
  type GroupSelectionMode,
  type GroupSelectionValue,
} from "@/lib/group-selection"
import { cn } from "@/lib/utils"

export type {
  GroupSelectionMode,
  GroupSelectionValue,
} from "@/lib/group-selection"

/** A disabled group can still be expanded to select its children. */
export type GroupSelectOption = {
  id: string
  parentId?: string | null
  name: string
  disabled?: boolean
}

/** Users may appear under multiple groups; selection is shared by user ID. */
export type GroupSelectUser = {
  id: string
  name: string
  /** Search-only metadata; not displayed in the row. */
  email?: string
  groupIds: readonly string[]
  disabled?: boolean
}

export type GroupSelectProps = {
  id?: string
  options: readonly GroupSelectOption[]
  users?: readonly GroupSelectUser[]
  value: GroupSelectionValue
  onValueChange: (value: GroupSelectionValue) => void
  label: string
  placeholder: string
  emptyText: string
  locale?: string
  disabled?: boolean
  className?: string
  /** Initial state for each folder, including leaf folders. Default: true. */
  defaultExpanded?: boolean
  /** Allows folder icons to toggle expansion. Default: true. */
  collapsible?: boolean
  /** Single selection replaces the previous selection across both kinds. Default: true. */
  multiple?: boolean
  /** User rows are shown in users/both modes. Default: groups. */
  selectionMode?: GroupSelectionMode
  /** In multi-select mode, selected groups grant access to descendants and users. */
  cascadeGroups?: boolean
  /** Search names, email, and Chinese pinyin. Default: false. */
  searchable?: boolean
  searchPlaceholder?: string
  noResultsText?: string
}

export function GroupSelect({
  id,
  options,
  users = [],
  value,
  onValueChange,
  label,
  placeholder,
  emptyText,
  locale,
  disabled = false,
  className,
  defaultExpanded = true,
  collapsible = true,
  multiple = true,
  selectionMode = "groups",
  cascadeGroups = false,
  searchable = false,
  searchPlaceholder = label,
  noResultsText = emptyText,
}: GroupSelectProps) {
  const generatedID = useId()
  const selectID = id ?? generatedID
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const searching = searchable && query.trim().length > 0
  const canCollapse = collapsible && !searching
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setQuery("")
  }
  const [initialExpanded] = useState(defaultExpanded)
  const [expansion, setExpansion] = useState<Record<string, boolean>>({})
  const showUsers = selectionMode !== "groups"
  const searchIndex = useMemo(
    () =>
      searchable
        ? createGroupSearchIndex(options, showUsers ? users : [], locale)
        : undefined,
    [searchable, options, users, showUsers, locale]
  )
  const selectGroups = selectionMode !== "users"
  const hierarchy =
    cascadeGroups && multiple && selectGroups
      ? { groups: options, users }
      : undefined
  const inherited = hierarchy
    ? inheritedGroupSelection(value, hierarchy)
    : undefined
  const byID = new Map(options.map((group) => [group.id, group]))
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  })
  const compare = (
    a: { id: string; name: string },
    b: { id: string; name: string }
  ) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id)
  const sorted = [...options].sort(compare)
  const sortedUsers = showUsers ? [...users].sort(compare) : []
  const visible = searchGroupTree(
    sorted,
    sortedUsers,
    searchable ? query : "",
    locale,
    searchIndex
  )
  const children = new Map<string | null, GroupSelectOption[]>()
  for (const group of sorted) {
    const parentID =
      group.parentId && byID.has(group.parentId) ? group.parentId : null
    const siblings = children.get(parentID) ?? []
    siblings.push(group)
    children.set(parentID, siblings)
  }
  const members = new Map<string | null, GroupSelectUser[]>()
  for (const user of sortedUsers) {
    const groupIDs = [...new Set(user.groupIds)].filter((groupID) =>
      byID.has(groupID)
    )
    for (const groupID of groupIDs.length ? groupIDs : [null]) {
      const siblings = members.get(groupID) ?? []
      siblings.push(user)
      members.set(groupID, siblings)
    }
  }
  const groupPath = (group: GroupSelectOption) => {
    const names = [group.name]
    const seen = new Set([group.id])
    let parentID = group.parentId
    while (parentID && !seen.has(parentID)) {
      seen.add(parentID)
      const parent = byID.get(parentID)
      if (!parent) break
      names.unshift(parent.name)
      parentID = parent.parentId
    }
    return names.join(" / ")
  }
  const summary = [
    ...(selectGroups
      ? sorted.filter((group) => value.groupIds.includes(group.id))
      : []),
    ...sortedUsers.filter((user) => value.userIds.includes(user.id)),
  ]
    .map((entry) => entry.name)
    .join(", ")
  const select = (
    kind: "group" | "user",
    entryID: string,
    checked: boolean
  ) => {
    onValueChange(
      changeGroupSelection(
        value,
        kind,
        entryID,
        checked,
        multiple,
        selectionMode,
        hierarchy
      )
    )
    if (checked && !multiple) handleOpenChange(false)
  }
  const radioValue =
    !multiple && value.groupIds.length > 0
      ? `group:${value.groupIds[0]}`
      : !multiple && value.userIds.length > 0
        ? `user:${value.userIds[0]}`
        : ""
  const handleRadioValueChange = (nextValue: string) => {
    const separator = nextValue.indexOf(":")
    if (separator < 0) return
    select(
      nextValue.slice(0, separator) as "group" | "user",
      nextValue.slice(separator + 1),
      true
    )
  }
  const rowClass = "flex w-full min-w-0 items-center gap-1 rounded-md"
  const checkboxClass =
    "ms-auto shrink-0 data-disabled:border-muted-foreground/30! data-disabled:bg-muted! data-disabled:text-muted-foreground! data-disabled:opacity-100!"
  const labelClass = (unavailable: boolean) =>
    cn(
      "flex h-9 min-w-0 flex-1 items-center gap-2 pe-2 text-start font-normal",
      unavailable ? "cursor-default" : "cursor-pointer"
    )
  const renderUser = (
    user: GroupSelectUser,
    parentID: string | null,
    level: number
  ) => {
    if (!visible.userIds.has(user.id)) return null
    const checkboxID = `${selectID}-user-${JSON.stringify([parentID, user.id])}`
    const inheritedSelection = inherited?.inheritedUserIds.has(user.id) ?? false
    const unavailable = disabled || !!user.disabled || inheritedSelection
    return (
      <li key={`user:${user.id}`}>
        <div
          className={cn(rowClass, !unavailable && "hover:bg-foreground/5")}
          style={{ paddingInlineStart: `${level * 1.25 + 0.25}rem` }}
        >
          <span className="flex size-6 shrink-0 items-center justify-center">
            <HugeiconsIcon
              icon={User02Icon}
              className="size-4 text-blue-600 dark:text-blue-400"
            />
          </span>
          <label htmlFor={checkboxID} className={labelClass(unavailable)}>
            <span className="min-w-0 flex-1 truncate" title={user.name}>
              {user.name}
            </span>
            {multiple ? (
              <Checkbox
                id={checkboxID}
                checked={inheritedSelection || value.userIds.includes(user.id)}
                disabled={unavailable}
                className={checkboxClass}
                onCheckedChange={(checked) => select("user", user.id, checked)}
              />
            ) : (
              <RadioGroupItem
                id={checkboxID}
                value={`user:${user.id}`}
                disabled={unavailable}
                className="ms-auto"
              />
            )}
          </label>
        </div>
      </li>
    )
  }
  const renderGroup = (
    group: GroupSelectOption,
    ancestors: Set<string>,
    level = 0
  ): ReactNode => {
    if (ancestors.has(group.id) || !visible.groupIds.has(group.id)) return null
    const descendants = children.get(group.id) ?? []
    const groupUsers = members.get(group.id) ?? []
    const expanded = searching || (expansion[group.id] ?? initialExpanded)
    const selectable = selectGroups && !group.disabled
    const inheritedSelection =
      inherited?.inheritedGroupIds.has(group.id) ?? false
    const nextAncestors = new Set([...ancestors, group.id])
    const checkboxID = `${selectID}-group-${group.id}`
    const folderIcon = (
      <HugeiconsIcon
        icon={expanded ? Folder02Icon : FolderIcon}
        className="size-4 text-yellow-600 dark:text-yellow-400"
      />
    )
    return (
      <li key={`group:${group.id}`}>
        <div
          className={cn(
            rowClass,
            !disabled && (canCollapse || (selectable && !inheritedSelection))
              ? "hover:bg-foreground/5"
              : "cursor-default"
          )}
          style={{ paddingInlineStart: `${level * 1.25 + 0.25}rem` }}
        >
          {canCollapse ? (
            <button
              type="button"
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"
              aria-label={group.name}
              aria-expanded={expanded}
              aria-controls={
                descendants.length || groupUsers.length
                  ? `${checkboxID}-children`
                  : undefined
              }
              disabled={disabled}
              onClick={() =>
                setExpansion((current) => ({
                  ...current,
                  [group.id]: !expanded,
                }))
              }
            >
              {folderIcon}
            </button>
          ) : !selectable ? (
            <span className="flex size-6 shrink-0 items-center justify-center">
              {folderIcon}
            </span>
          ) : null}
          {selectable ? (
            <label
              htmlFor={checkboxID}
              className={labelClass(disabled || inheritedSelection)}
            >
              {!canCollapse && (
                <span className="-me-1 flex size-6 shrink-0 items-center justify-center">
                  {folderIcon}
                </span>
              )}
              <span
                className="min-w-0 flex-1 truncate"
                title={groupPath(group)}
              >
                {group.name}
              </span>
              {multiple ? (
                <Checkbox
                  id={checkboxID}
                  checked={
                    inheritedSelection || value.groupIds.includes(group.id)
                  }
                  indeterminate={
                    inherited?.partialGroupIds.has(group.id) ?? false
                  }
                  disabled={disabled || group.disabled || inheritedSelection}
                  className={checkboxClass}
                  onCheckedChange={(checked) =>
                    select("group", group.id, checked)
                  }
                />
              ) : (
                <RadioGroupItem
                  id={checkboxID}
                  value={`group:${group.id}`}
                  disabled={disabled || group.disabled}
                  className="ms-auto"
                />
              )}
            </label>
          ) : (
            <span className="flex h-9 min-w-0 flex-1 cursor-default items-center pe-2 text-popover-foreground">
              <span className="truncate" title={groupPath(group)}>
                {group.name}
              </span>
            </span>
          )}
        </div>
        {(descendants.length > 0 || groupUsers.length > 0) && (
          <ul
            id={`${checkboxID}-children`}
            hidden={!expanded}
            className="space-y-1"
          >
            {descendants.map((child) =>
              renderGroup(child, nextAncestors, level + 1)
            )}
            {groupUsers.map((user) => renderUser(user, group.id, level + 1))}
          </ul>
        )}
      </li>
    )
  }
  return (
    <Popover open={open && !disabled} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            id={selectID}
            type="button"
            variant="outline"
            aria-label={label}
            disabled={disabled}
            className={cn(
              "w-full min-w-0 justify-between font-normal",
              className
            )}
          />
        }
      >
        <span
          className={cn("truncate", !summary && "text-muted-foreground")}
          title={summary}
        >
          {summary || placeholder}
        </span>
        <HugeiconsIcon icon={UnfoldMoreIcon} data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-(--available-height) w-(--anchor-width) gap-2 overflow-hidden py-2 ps-2 pe-0"
      >
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        {searchable && (
          <div className="pe-2">
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              disabled={disabled}
            />
          </div>
        )}
        <ScrollArea
          className="min-h-0 w-full overflow-hidden [&_[data-slot=scroll-area-viewport]]:h-auto [&_[data-slot=scroll-area-viewport]]:max-h-[min(14rem,calc(var(--available-height,100dvh)-var(--group-select-chrome)))]"
          style={
            {
              "--group-select-chrome": searchable ? "4rem" : "1rem",
            } as CSSProperties
          }
        >
          {multiple ? (
            <ul className="space-y-1 pe-2" aria-label={label}>
              {(children.get(null) ?? []).map((group) =>
                renderGroup(group, new Set())
              )}
              {(members.get(null) ?? []).map((user) =>
                renderUser(user, null, 0)
              )}
            </ul>
          ) : (
            <RadioGroup
              value={radioValue}
              onValueChange={handleRadioValueChange}
              className="gap-0"
            >
              <ul className="space-y-1 pe-2" aria-label={label}>
                {(children.get(null) ?? []).map((group) =>
                  renderGroup(group, new Set())
                )}
                {(members.get(null) ?? []).map((user) =>
                  renderUser(user, null, 0)
                )}
              </ul>
            </RadioGroup>
          )}
          {visible.groupIds.size === 0 && visible.userIds.size === 0 && (
            <p className="py-6 pe-2 text-center text-sm text-muted-foreground">
              {searching ? noResultsText : emptyText}
            </p>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
