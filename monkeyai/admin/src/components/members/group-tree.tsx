import { useMemo, useState, type DragEvent, type HTMLAttributes } from "react"
import {
  Add01Icon,
  Delete02Icon,
  Edit02Icon,
  Folder02Icon,
  FolderIcon,
  MoreHorizontalIcon,
  MoveIcon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { type MoveMember } from "@/lib/group-move"
import {
  MemberActions,
  type MemberActionUser,
} from "@/components/members/member-actions"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  type GroupAction,
  groupActionKeys,
  type ActiveGroupAction,
  type MemberGroup,
} from "@/lib/member-groups"
import { UserAvatar } from "@/components/user-avatar"
import { cn } from "@/lib/utils"
import { buildMemberTree, flattenMemberTree } from "@/lib/member-tree"
import { useVirtualRows } from "@/hooks/use-virtual-rows"

const allGroupActions: GroupAction[] = [
  "add-subgroup",
  "rename",
  "adjust-members",
  "move",
  "delete",
]

const dragPreviewClasses = ["outline", "outline-1", "outline-border"]

const actionIcons = {
  "add-subgroup": Add01Icon,
  rename: Edit02Icon,
  "adjust-members": UserMultiple02Icon,
  move: MoveIcon,
  delete: Delete02Icon,
}

type Props = {
  groups: MemberGroup[]
  users: MemberActionUser[]
  nameCollator: Intl.Collator
  savingID: string
  currentUserID?: string
  onAction: (action: ActiveGroupAction) => void
  onViewDetails: (userID: string) => void
  onToggleStatus: (user: MemberActionUser) => void
  onToggleRole: (user: MemberActionUser) => void
  onResetPassword: (user: MemberActionUser) => void
  multiSelect: boolean
  selectionDisabled: boolean
  selectedMemberKeys: ReadonlySet<string>
  onMemberSelect: (member: MoveMember, checked: boolean) => void
  onGroupDragStart: (group: MemberGroup, event: DragEvent) => void
  onMemberDragStart: (member: MoveMember, event: DragEvent) => void
  onDragEnd: () => void
  canDropOn: (group: MemberGroup) => boolean
  onDropOn: (group: MemberGroup, event: DragEvent) => void
}

export function MemberGroupTree({
  groups,
  users,
  nameCollator,
  scrollElement,
  ...props
}: Props & { scrollElement: HTMLDivElement | null }) {
  const { t } = useTranslation()
  const [expansion, setExpansion] = useState<ReadonlyMap<string, boolean>>(
    () => new Map()
  )
  const tree = useMemo(
    () => buildMemberTree(groups, users, nameCollator),
    [groups, users, nameCollator]
  )
  const rows = useMemo(
    () => flattenMemberTree(tree, expansion),
    [tree, expansion]
  )
  const keys = useMemo(() => rows.map((row) => row.key), [rows])
  const { items, totalSize, pin, onFocusCapture, onBlurCapture } =
    useVirtualRows({ keys, scrollElement, estimateSize: 32, gap: 4 })
  return (
    <ul
      className="relative"
      aria-label={t("pages.membersAndGroups.groupsTitle")}
      style={{ height: totalSize }}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
    >
      {items.map((item) => {
        const row = rows[item.index]
        const virtualProps: HTMLAttributes<HTMLLIElement> & {
          "data-virtual-key": string
        } = {
          "data-virtual-key": row.key,
          "aria-level": row.level + 1,
          "aria-posinset": item.index + 1,
          "aria-setsize": rows.length,
          style: {
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: item.size,
            transform: `translateY(${item.start}px)`,
          },
        }
        const onMenuPin = (active: boolean) => pin("menu", row.key, active)
        const onDragPin = (active: boolean) => pin("drag", row.key, active)
        return row.kind === "group" ? (
          <GroupTreeItem
            key={row.key}
            {...props}
            group={row.group}
            count={row.count}
            level={row.level}
            expanded={row.expanded}
            virtualProps={virtualProps}
            onMenuPin={onMenuPin}
            onDragPin={onDragPin}
            onToggle={() =>
              setExpansion((current) =>
                new Map(current).set(row.group.id, !row.expanded)
              )
            }
          />
        ) : (
          <GroupTreeMemberRow
            key={row.key}
            {...props}
            member={row.member}
            level={row.level}
            virtualProps={virtualProps}
            onMenuPin={onMenuPin}
            onDragPin={onDragPin}
            selected={
              props.multiSelect &&
              props.selectedMemberKeys.has(`${row.groupID}:${row.member.id}`)
            }
            onSelect={(checked) =>
              props.onMemberSelect(
                { id: row.member.id, source_group_id: row.groupID },
                checked
              )
            }
            onDragStart={(event) =>
              props.onMemberDragStart(
                { id: row.member.id, source_group_id: row.groupID },
                event
              )
            }
          />
        )
      })}
    </ul>
  )
}

function GroupTreeItem({
  group,
  count,
  expanded,
  level,
  onToggle,
  virtualProps,
  onMenuPin,
  onDragPin,
  onAction,
  multiSelect,
  onGroupDragStart,
  onDragEnd,
  canDropOn,
  onDropOn,
}: Omit<Props, "groups" | "users" | "nameCollator"> & {
  group: MemberGroup
  count: number
  expanded: boolean
  level: number
  onToggle: () => void
  virtualProps: HTMLAttributes<HTMLLIElement>
  onMenuPin: (active: boolean) => void
  onDragPin: (active: boolean) => void
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionsFocused, setActionsFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [dropHovered, setDropHovered] = useState(false)
  const showActions = hovered || menuOpen || actionsFocused
  const actions = group.actions
  const label = (
    <>
      <HugeiconsIcon
        icon={expanded ? Folder02Icon : FolderIcon}
        className="size-4 shrink-0 text-yellow-600 dark:text-yellow-400"
        strokeWidth={2}
      />
      <span className="min-w-0 flex-1 truncate text-start">{group.name}</span>
    </>
  )
  const triggerButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="min-w-0 flex-1 cursor-pointer justify-start gap-2 border-0 text-start font-normal hover:!bg-transparent aria-expanded:!bg-transparent"
      style={{ paddingInlineStart: `${level * 1.25 + 0.5}rem` }}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {label}
    </Button>
  )

  return (
    <li {...virtualProps}>
      <div
        className={cn(
          "group/group-row flex items-center rounded-md pe-1 transition-colors",
          multiSelect && "gap-2",
          !multiSelect && "cursor-grab active:cursor-grabbing",
          (hovered || menuOpen) && "bg-foreground/5",
          dropHovered && "bg-foreground/5 text-foreground/60"
        )}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        draggable={!multiSelect}
        onDragStart={(event) => {
          if (
            (event.target as HTMLElement).closest(
              "[data-slot=dropdown-menu-trigger]"
            )
          ) {
            event.preventDefault()
            return
          }
          onDragPin(true)
          event.currentTarget.classList.add(...dragPreviewClasses)
          onGroupDragStart(group, event)
        }}
        onDragEnd={(event) => {
          event.currentTarget.classList.remove(...dragPreviewClasses)
          onDragPin(false)
          onDragEnd()
        }}
        onDragOver={(event) => {
          if (canDropOn(group)) {
            event.preventDefault()
            event.dataTransfer.dropEffect = "move"
            setDropHovered(true)
          }
        }}
        onDragLeave={() => setDropHovered(false)}
        onDrop={(event) => {
          setDropHovered(false)
          onDropOn(group, event)
        }}
      >
        {multiSelect && (
          <Checkbox
            checked={false}
            disabled
            aria-label={group.name}
            className="ms-1 shrink-0 !border-muted-foreground/30 !bg-muted !text-muted-foreground !opacity-100"
          />
        )}
        {triggerButton}
        <div
          className={cn(
            "relative flex h-8 shrink-0 items-center justify-center",
            showActions && "w-6"
          )}
          onFocusCapture={(event) =>
            setActionsFocused(event.target.matches(":focus-visible"))
          }
          onBlurCapture={() => setActionsFocused(false)}
        >
          <span
            className={cn(
              "pointer-events-none px-1 text-xs text-muted-foreground tabular-nums",
              showActions && "opacity-0"
            )}
          >
            {count}
          </span>
          <DropdownMenu
            onOpenChange={(open) => {
              setMenuOpen(open)
              onMenuPin(open)
            }}
          >
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    "pointer-events-none absolute inset-0 m-auto cursor-pointer opacity-0 transition-none hover:bg-foreground/5 focus-visible:pointer-events-auto focus-visible:opacity-100 aria-expanded:bg-foreground/5 dark:hover:bg-foreground/5",
                    showActions &&
                      "pointer-events-auto opacity-100 transition-opacity duration-100 ease-out motion-reduce:transition-none"
                  )}
                  aria-label={`${group.name} · ${t("pages.membersAndGroups.groupActions")}`}
                />
              }
            >
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                className="size-4"
                strokeWidth={2}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {allGroupActions
                  .filter((action) => action !== "delete")
                  .map((action) => (
                    <DropdownMenuItem
                      key={action}
                      disabled={!actions.includes(action)}
                      onClick={() => onAction({ action, group })}
                    >
                      <HugeiconsIcon
                        icon={actionIcons[action]}
                        strokeWidth={2}
                      />
                      {t(`pages.membersAndGroups.${groupActionKeys[action]}`)}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuGroup>
              {allGroupActions.includes("delete") && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={!actions.includes("delete")}
                      onClick={() => onAction({ action: "delete", group })}
                    >
                      <HugeiconsIcon
                        icon={actionIcons.delete}
                        strokeWidth={2}
                      />
                      {t("pages.membersAndGroups.deleteGroup")}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  )
}

function GroupTreeMemberRow({
  member,
  level,
  savingID,
  currentUserID,
  onViewDetails,
  onToggleStatus,
  onToggleRole,
  onResetPassword,
  multiSelect,
  selectionDisabled,
  selected,
  onSelect,
  onDragStart,
  onDragEnd,
  virtualProps,
  onMenuPin,
  onDragPin,
}: Pick<
  Props,
  | "savingID"
  | "currentUserID"
  | "onViewDetails"
  | "onToggleStatus"
  | "onToggleRole"
  | "onResetPassword"
  | "multiSelect"
  | "selectionDisabled"
> & {
  member: MemberActionUser
  level: number
  selected: boolean
  onSelect: (checked: boolean) => void
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
  virtualProps: HTMLAttributes<HTMLLIElement>
  onMenuPin: (active: boolean) => void
  onDragPin: (active: boolean) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionsFocused, setActionsFocused] = useState(false)
  const showActions = hovered || menuOpen || actionsFocused

  return (
    <li
      {...virtualProps}
      aria-busy={savingID === member.id}
      draggable={!multiSelect}
      onDragStart={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "button, [role=checkbox], [data-slot=dropdown-menu-trigger]"
          )
        ) {
          event.preventDefault()
          return
        }
        onDragPin(true)
        event.currentTarget.classList.add(...dragPreviewClasses)
        onDragStart(event)
      }}
      onDragEnd={(event) => {
        event.currentTarget.classList.remove(...dragPreviewClasses)
        onDragPin(false)
        if (!multiSelect) onDragEnd()
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={(event) => {
        if (!multiSelect || selectionDisabled) return
        if (
          (event.target as HTMLElement).closest(
            "button, [role=checkbox], [data-slot=dropdown-menu-trigger]"
          )
        ) {
          return
        }
        onSelect(!selected)
      }}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md pe-1 text-sm transition-colors",
        multiSelect ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        (hovered || menuOpen) && "bg-foreground/5",
        selected && "bg-foreground/5",
        member.status === "disabled" && "text-muted-foreground"
      )}
      style={{
        ...virtualProps.style,
        paddingInlineStart: multiSelect ? 0 : `${level * 1.25 + 0.5}rem`,
      }}
    >
      {multiSelect && (
        <Checkbox
          checked={selected}
          onCheckedChange={onSelect}
          disabled={selectionDisabled}
          aria-label={member.name}
          className="ms-1 shrink-0"
        />
      )}
      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        style={
          multiSelect
            ? { paddingInlineStart: `${level * 1.25 + 0.5}rem` }
            : undefined
        }
      >
        <UserAvatar src={member.avatar_url} className="!size-4" />
        <span className="min-w-0 flex-1 truncate" title={member.email}>
          {member.name}
        </span>
        <div
          className={cn(
            "flex h-8 shrink-0 items-center justify-center overflow-visible",
            showActions ? "w-6" : "w-0"
          )}
          onFocusCapture={(event) =>
            setActionsFocused(event.target.matches(":focus-visible"))
          }
          onBlurCapture={() => setActionsFocused(false)}
        >
          <MemberActions
            user={member}
            savingID={savingID}
            currentUserID={currentUserID}
            treeActionsVisible={showActions}
            onMenuOpenChange={(open) => {
              setMenuOpen(open)
              onMenuPin(open)
            }}
            onViewDetails={onViewDetails}
            onToggleStatus={onToggleStatus}
            onToggleRole={onToggleRole}
            onResetPassword={onResetPassword}
          />
        </div>
      </div>
    </li>
  )
}
