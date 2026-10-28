import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import {
  Folder02Icon,
  FolderIcon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  createGroupSearchIndex,
  searchGroupTree,
} from "@/lib/group-select-search"
import {
  buildGroupSelectTree,
  flattenGroupSelectTree,
  type GroupSelectOption,
  type GroupSelectRow,
  type GroupSelectUser,
} from "@/lib/group-select-tree"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { UserAvatar } from "@/components/user-avatar"
import { useVirtualRows } from "@/hooks/use-virtual-rows"
import {
  changeGroupSelection,
  indexGroupSelection,
  inheritedGroupSelection,
  type GroupSelectionMode,
  type GroupSelectionValue,
} from "@/lib/group-selection"
import { cn } from "@/lib/utils"

export type {
  GroupSelectOption,
  GroupSelectUser,
} from "@/lib/group-select-tree"
export type {
  GroupSelectionMode,
  GroupSelectionValue,
} from "@/lib/group-selection"

const EMPTY_USERS: readonly GroupSelectUser[] = []

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
  /** Initial state for each folder. Default: true. */
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
  users = EMPTY_USERS,
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
  const { t } = useTranslation()
  const generatedID = useId()
  const selectID = id ?? generatedID
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const searching = searchable && deferredQuery.trim().length > 0
  const canCollapse = collapsible && !searching
  const [initialExpanded] = useState(defaultExpanded)
  const [expansion, setExpansion] = useState<ReadonlyMap<string, boolean>>(
    () => new Map()
  )
  const showUsers = selectionMode !== "groups"
  const selectGroups = selectionMode !== "users"
  const tree = useMemo(
    () =>
      buildGroupSelectTree(options, showUsers ? users : EMPTY_USERS, locale),
    [options, users, showUsers, locale]
  )
  const searchIndex = useMemo(
    () =>
      searchable
        ? createGroupSearchIndex(tree.groups, tree.users, locale)
        : undefined,
    [searchable, tree, locale]
  )
  const hierarchy = useMemo(
    () =>
      cascadeGroups && multiple && selectGroups
        ? indexGroupSelection({ groups: options, users })
        : undefined,
    [cascadeGroups, multiple, selectGroups, options, users]
  )
  const selectedGroups = useMemo(
    () => new Set(value.groupIds),
    [value.groupIds]
  )
  const selectedUsers = useMemo(() => new Set(value.userIds), [value.userIds])
  const inherited = useMemo(
    () =>
      hierarchy
        ? inheritedGroupSelection(
            { groupIds: value.groupIds, userIds: value.userIds },
            hierarchy
          )
        : undefined,
    [hierarchy, value.groupIds, value.userIds]
  )
  const visible = useMemo(
    () =>
      searching
        ? searchGroupTree(
            tree.groups,
            tree.users,
            deferredQuery,
            locale,
            searchIndex
          )
        : undefined,
    [searching, tree, deferredQuery, locale, searchIndex]
  )
  const rows = useMemo(
    () =>
      open
        ? flattenGroupSelectTree(tree, expansion, initialExpanded, visible)
        : [],
    [open, tree, expansion, initialExpanded, visible]
  )
  const summary = useMemo(() => {
    const groups = selectGroups
      ? [...selectedGroups].flatMap((id) => tree.byID.get(id) ?? [])
      : []
    const members = [...selectedUsers].flatMap(
      (id) => tree.usersByID.get(id) ?? []
    )
    if (groups.length + members.length > 3) {
      if (groups.length === 0)
        return t("groupSelect.selectedUsers", { count: members.length })
      if (members.length === 0)
        return t("groupSelect.selectedGroups", { count: groups.length })
      return t("groupSelect.selectedBoth", {
        groups: groups.length,
        users: members.length,
      })
    }
    return [...groups.sort(tree.compare), ...members.sort(tree.compare)]
      .map((entry) => entry.name)
      .join(", ")
  }, [selectGroups, selectedGroups, selectedUsers, tree, t])
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setQuery("")
  }
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
  const unavailable = (row: GroupSelectRow) =>
    disabled ||
    (row.kind === "user"
      ? !!row.user.disabled || !!inherited?.inheritedUserIds.has(row.user.id)
      : !selectGroups ||
        !!row.group.disabled ||
        !!inherited?.inheritedGroupIds.has(row.group.id))
  const focusable = (row: GroupSelectRow) =>
    !unavailable(row) || (!disabled && row.kind === "group" && canCollapse)
  const rowClass = "flex h-9 w-full min-w-0 items-center gap-1 rounded-md"
  const checkboxClass =
    "ms-auto shrink-0 data-disabled:!border-muted-foreground/30 data-disabled:!bg-muted data-disabled:!text-muted-foreground data-disabled:!opacity-100"
  const labelClass = (inactive: boolean) =>
    cn(
      "flex h-9 min-w-0 flex-1 items-center gap-2 pe-2 text-start font-normal rtl:pl-2 rtl:pr-0",
      inactive ? "cursor-default" : "cursor-pointer"
    )
  const renderRow = (row: GroupSelectRow) => {
    const inactive = unavailable(row)
    const style = { paddingInlineStart: `${row.level * 1.25 + 0.25}rem` }
    if (row.kind === "user") {
      const user = row.user
      const checkboxID = `${selectID}-user-${JSON.stringify([row.parentID, user.id])}`
      return (
        <div
          className={cn(rowClass, !inactive && "hover:bg-foreground/5")}
          style={style}
        >
          <span className="flex size-6 shrink-0 items-center justify-center">
            <UserAvatar
              src={user.avatarUrl}
              className="data-[size=sm]:size-5"
            />
          </span>
          <label htmlFor={checkboxID} className={labelClass(inactive)}>
            <span
              className="min-w-0 flex-1 truncate"
              title={user.email ? `${user.name} (${user.email})` : user.name}
            >
              {user.name}
            </span>
            {multiple ? (
              <Checkbox
                id={checkboxID}
                checked={
                  !!inherited?.inheritedUserIds.has(user.id) ||
                  selectedUsers.has(user.id)
                }
                disabled={inactive}
                className={checkboxClass}
                onCheckedChange={(checked) => select("user", user.id, checked)}
              />
            ) : (
              <RadioGroupItem
                id={checkboxID}
                value={`user:${user.id}`}
                disabled={inactive}
                className="ms-auto"
              />
            )}
          </label>
        </div>
      )
    }
    const group = row.group
    const selectable = selectGroups && !group.disabled
    const checkboxID = `${selectID}-group-${group.id}`
    const folderIcon = (
      <HugeiconsIcon
        icon={row.expanded ? Folder02Icon : FolderIcon}
        className="size-4 text-yellow-600 dark:text-yellow-400"
      />
    )
    return (
      <div
        className={cn(
          rowClass,
          focusable(row) ? "hover:bg-foreground/5" : "cursor-default"
        )}
        style={style}
      >
        {canCollapse ? (
          <button
            type="button"
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"
            aria-label={group.name}
            aria-expanded={row.expanded}
            disabled={disabled}
            onClick={() =>
              setExpansion((current) =>
                new Map(current).set(group.id, !row.expanded)
              )
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
          <label htmlFor={checkboxID} className={labelClass(inactive)}>
            {!canCollapse && (
              <span className="-me-1 flex size-6 shrink-0 items-center justify-center">
                {folderIcon}
              </span>
            )}
            <span
              className="min-w-0 flex-1 truncate"
              title={tree.groupPath(group)}
            >
              {group.name}
            </span>
            {multiple ? (
              <Checkbox
                id={checkboxID}
                checked={
                  !!inherited?.inheritedGroupIds.has(group.id) ||
                  selectedGroups.has(group.id)
                }
                indeterminate={
                  inherited?.partialGroupIds.has(group.id) ?? false
                }
                disabled={inactive}
                className={checkboxClass}
                onCheckedChange={(checked) =>
                  select("group", group.id, checked)
                }
              />
            ) : (
              <RadioGroupItem
                id={checkboxID}
                value={`group:${group.id}`}
                disabled={inactive}
                className="ms-auto"
              />
            )}
          </label>
        ) : (
          <span className="flex h-9 min-w-0 flex-1 cursor-default items-center pe-2 text-popover-foreground">
            <span className="truncate" title={tree.groupPath(group)}>
              {group.name}
            </span>
          </span>
        )}
      </div>
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
        className="max-h-[var(--available-height)] w-[var(--anchor-width)] gap-2 overflow-hidden py-2 pe-0 ps-2 rtl:pl-0 rtl:pr-2"
      >
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        {searchable && (
          <div className="pe-2 rtl:pl-2 rtl:pr-0">
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
        <GroupSelectList
          rows={rows}
          label={label}
          query={searching ? deferredQuery : ""}
          searchable={searchable}
          multiple={multiple}
          radioValue={radioValue}
          onRadioValueChange={handleRadioValueChange}
          renderRow={renderRow}
          focusable={focusable}
          selectable={(row) => !unavailable(row)}
          emptyText={searching ? noResultsText : emptyText}
        />
      </PopoverContent>
    </Popover>
  )
}

const ROW_CONTROLS =
  'button:not(:disabled), [role="radio"]:not([data-disabled]), [role="checkbox"]:not([data-disabled])'

function focusRow(
  viewport: HTMLElement,
  target: { key: string; last: boolean }
) {
  const row = [
    ...viewport.querySelectorAll<HTMLElement>("[data-virtual-key]"),
  ].find((el) => el.dataset.virtualKey === target.key)
  const controls = row
    ? [...row.querySelectorAll<HTMLElement>(ROW_CONTROLS)]
    : []
  const control = target.last ? controls[controls.length - 1] : controls[0]
  control?.focus()
  return !!control
}

/** Mount only visible rows; keep focused controls mounted while scrolling. */
function GroupSelectList({
  rows,
  label,
  query,
  searchable,
  multiple,
  radioValue,
  onRadioValueChange,
  renderRow,
  focusable,
  selectable,
  emptyText,
}: {
  rows: readonly GroupSelectRow[]
  label: string
  query: string
  searchable: boolean
  multiple: boolean
  radioValue: string
  onRadioValueChange: (value: string) => void
  renderRow: (row: GroupSelectRow) => ReactNode
  focusable: (row: GroupSelectRow) => boolean
  selectable: (row: GroupSelectRow) => boolean
  emptyText: string
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const pendingFocus = useRef<{ key: string; last: boolean } | null>(null)
  const lastQuery = useRef<string | undefined>(undefined)
  const keys = useMemo(() => rows.map((row) => row.key), [rows])
  const { items, totalSize, scrollToOffset, onFocusCapture, onBlurCapture } =
    useVirtualRows({ keys, scrollElement: viewport, estimateSize: 36, gap: 4 })
  useEffect(() => {
    if (!viewport || lastQuery.current === query) return
    lastQuery.current = query
    const selectedIndex =
      !multiple && !query
        ? rows.findIndex(
            (row) =>
              `${row.kind}:${row.kind === "group" ? row.group.id : row.user.id}` ===
              radioValue
          )
        : 0
    scrollToOffset(Math.max(0, selectedIndex) * 40)
  }, [viewport, query, multiple, rows, radioValue, scrollToOffset])
  useEffect(() => {
    if (
      viewport &&
      pendingFocus.current &&
      focusRow(viewport, pendingFocus.current)
    )
      pendingFocus.current = null
  }, [viewport, items])
  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (
      !["Tab", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return
    const element = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-virtual-key]"
    )
    if (!element) return
    const current = keys.indexOf(element.dataset.virtualKey ?? "")
    if (current < 0) return
    if (event.key === "Tab") {
      if (!multiple) return
      const controls = [...element.querySelectorAll<HTMLElement>(ROW_CONTROLS)]
      const boundary = event.shiftKey
        ? controls[0]
        : controls[controls.length - 1]
      if (event.target !== boundary) return
    }
    const backwards =
      event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)
    let next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : current + (backwards ? -1 : 1)
    const step = event.key === "End" || backwards ? -1 : 1
    const eligible = !multiple && event.key !== "Tab" ? selectable : focusable
    while (next >= 0 && next < rows.length && !eligible(rows[next]))
      next += step
    if (next < 0 || next >= rows.length) return
    event.preventDefault()
    event.stopPropagation()
    const row = rows[next]
    if (!multiple && event.key !== "Tab") {
      onRadioValueChange(
        `${row.kind}:${row.kind === "group" ? row.group.id : row.user.id}`
      )
      return
    }
    pendingFocus.current = {
      key: row.key,
      last: event.key === "Tab" && backwards,
    }
    scrollToOffset(Math.max(0, next * 40 - (viewport?.clientHeight ?? 0) / 2))
    if (viewport && focusRow(viewport, pendingFocus.current))
      pendingFocus.current = null
  }
  const list = (
    <ul
      className="relative pe-2"
      aria-label={label}
      style={{ height: totalSize }}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
      onKeyDownCapture={handleKeyDown}
    >
      {items.map((item) => {
        const row = rows[item.index]
        return (
          <li
            key={row.key}
            data-virtual-key={row.key}
            aria-level={row.level + 1}
            aria-posinset={item.index + 1}
            aria-setsize={rows.length}
            style={{
              position: "absolute",
              // A row transform would capture Base UI's fixed hidden inputs,
              // whose negative margin causes horizontal overflow in RTL.
              top: item.start,
              left: 0,
              width: "100%",
              paddingInlineEnd: "0.5rem",
              height: item.size,
            }}
          >
            {renderRow(row)}
          </li>
        )
      })}
    </ul>
  )
  return (
    <ScrollArea
      viewportRef={setViewport}
      className="min-h-0 w-full overflow-hidden [&_[data-slot=scroll-area-viewport]]:h-auto [&_[data-slot=scroll-area-viewport]]:max-h-[min(14rem,calc(var(--available-height,100vh)-var(--group-select-chrome)))]"
      style={
        {
          "--group-select-chrome": searchable ? "4rem" : "1rem",
        } as CSSProperties
      }
    >
      {multiple ? (
        list
      ) : (
        <RadioGroup
          value={radioValue}
          onValueChange={onRadioValueChange}
          className="gap-0"
        >
          {list}
        </RadioGroup>
      )}
      {rows.length === 0 && (
        <p className="py-6 pe-2 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      )}
    </ScrollArea>
  )
}
