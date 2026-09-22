import { useState, type DragEvent } from "react"
import {
  Add01Icon,
  Delete02Icon,
  Edit02Icon,
  Folder02Icon,
  FolderIcon,
  MoreHorizontalIcon,
  MoveIcon,
  UserMultiple02Icon,
  User02Icon,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
  groupMemberIDs,
  directMemberIDs,
  compareByName,
  type MemberGroup,
} from "@/lib/member-groups"
import { memberIconColor } from "@/lib/member-appearance"
import { cn } from "@/lib/utils"

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
  group: MemberGroup
  groups: MemberGroup[]
  users: MemberActionUser[]
  nameCollator: Intl.Collator
  savingID: string
  currentUserID?: string
  onAction: (action: ActiveGroupAction) => void
  onToggleStatus: (user: MemberActionUser) => void
  onToggleRole: (user: MemberActionUser) => void
  onResetPassword: (user: MemberActionUser) => void
  multiSelect: boolean
  selectionDisabled: boolean
  selectedMemberKeys: string[]
  onMemberSelect: (member: MoveMember, checked: boolean) => void
  onGroupDragStart: (group: MemberGroup, event: DragEvent) => void
  onMemberDragStart: (member: MoveMember, event: DragEvent) => void
  onDragEnd: () => void
  canDropOn: (group: MemberGroup) => boolean
  onDropOn: (group: MemberGroup, event: DragEvent) => void
  level?: number
}

export function GroupTreeItem({
  group,
  groups,
  users,
  nameCollator,
  savingID,
  currentUserID,
  onAction,
  onToggleStatus,
  onToggleRole,
  onResetPassword,
  multiSelect,
  selectionDisabled,
  selectedMemberKeys,
  onMemberSelect,
  onGroupDragStart,
  onMemberDragStart,
  onDragEnd,
  canDropOn,
  onDropOn,
  level = 0,
}: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(group.parent_id === null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionsFocused, setActionsFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [dropHovered, setDropHovered] = useState(false)
  const showActions = hovered || menuOpen || actionsFocused
  const children = groups
    .filter((child) => child.parent_id === group.id)
    .sort((a, b) => compareByName(a, b, nameCollator))
  const directIDs = directMemberIDs(groups, group.id)
  const directMembers = users
    .filter((user) => directIDs.has(user.id))
    .sort((a, b) => compareByName(a, b, nameCollator))
  const actions = group.actions
  const count = groupMemberIDs(groups, group.id).size
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
      className="min-w-0 flex-1 cursor-pointer justify-start gap-2 text-start font-normal hover:bg-transparent! aria-expanded:bg-transparent!"
      style={{ paddingInlineStart: `${level * 1.25 + 0.5}rem` }}
    />
  )

  const memberRows = directMembers.map((member) => (
    <GroupTreeMemberRow
      key={member.id}
      member={member}
      level={level + 1}
      savingID={savingID}
      currentUserID={currentUserID}
      onToggleStatus={onToggleStatus}
      onToggleRole={onToggleRole}
      onResetPassword={onResetPassword}
      multiSelect={multiSelect}
      selectionDisabled={selectionDisabled}
      selected={
        multiSelect && selectedMemberKeys.includes(`${group.id}:${member.id}`)
      }
      onSelect={(checked) =>
        onMemberSelect({ id: member.id, source_group_id: group.id }, checked)
      }
      onDragStart={(event) =>
        onMemberDragStart({ id: member.id, source_group_id: group.id }, event)
      }
      onDragEnd={onDragEnd}
    />
  ))

  return (
    <li>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div
          className={cn(
            "group/group-row flex items-center rounded-md pe-1 transition-colors",
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
            event.currentTarget.classList.add(...dragPreviewClasses)
            onGroupDragStart(group, event)
          }}
          onDragEnd={(event) => {
            event.currentTarget.classList.remove(...dragPreviewClasses)
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
              className="ms-1 shrink-0 border-muted-foreground/30! bg-muted! text-muted-foreground! opacity-100!"
            />
          )}
          <CollapsibleTrigger render={triggerButton}>
            {label}
          </CollapsibleTrigger>
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
            <DropdownMenu onOpenChange={setMenuOpen}>
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
        {(children.length > 0 || directMembers.length > 0) && (
          <CollapsibleContent className="pt-1">
            <ul className="flex flex-col gap-1">
              {children.map((child) => (
                <GroupTreeItem
                  key={child.id}
                  group={child}
                  groups={groups}
                  users={users}
                  nameCollator={nameCollator}
                  savingID={savingID}
                  currentUserID={currentUserID}
                  onAction={onAction}
                  onToggleStatus={onToggleStatus}
                  onToggleRole={onToggleRole}
                  onResetPassword={onResetPassword}
                  multiSelect={multiSelect}
                  selectionDisabled={selectionDisabled}
                  selectedMemberKeys={selectedMemberKeys}
                  onMemberSelect={onMemberSelect}
                  onGroupDragStart={onGroupDragStart}
                  onMemberDragStart={onMemberDragStart}
                  onDragEnd={onDragEnd}
                  canDropOn={canDropOn}
                  onDropOn={onDropOn}
                  level={level + 1}
                />
              ))}
              {memberRows}
            </ul>
          </CollapsibleContent>
        )}
      </Collapsible>
    </li>
  )
}

function GroupTreeMemberRow({
  member,
  level,
  savingID,
  currentUserID,
  onToggleStatus,
  onToggleRole,
  onResetPassword,
  multiSelect,
  selectionDisabled,
  selected,
  onSelect,
  onDragStart,
  onDragEnd,
}: Pick<
  Props,
  | "savingID"
  | "currentUserID"
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
}) {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionsFocused, setActionsFocused] = useState(false)
  const showActions = hovered || menuOpen || actionsFocused

  return (
    <li
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
        event.currentTarget.classList.add(...dragPreviewClasses)
        onDragStart(event)
      }}
      onDragEnd={(event) => {
        event.currentTarget.classList.remove(...dragPreviewClasses)
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
        <HugeiconsIcon
          icon={User02Icon}
          className={cn("size-4 shrink-0", memberIconColor(member))}
          strokeWidth={2}
          aria-hidden="true"
        />
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
            onMenuOpenChange={setMenuOpen}
            onToggleStatus={onToggleStatus}
            onToggleRole={onToggleRole}
            onResetPassword={onResetPassword}
          />
        </div>
      </div>
    </li>
  )
}
