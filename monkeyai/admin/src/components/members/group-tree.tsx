import { useRef, useState, type DragEvent, type PointerEvent } from "react"
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
  groupActionKeys,
  type ActiveGroupAction,
  groupMemberIDs,
  directMemberIDs,
  compareByName,
  type MemberGroup,
} from "@/lib/member-groups"
import { memberIconColor } from "@/lib/member-appearance"
import { cn } from "@/lib/utils"

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
  selectedGroupIDs: string[]
  selectedMemberKeys: string[]
  onGroupSelect: (id: string) => void
  onMemberSelect: (member: MoveMember) => void
  onGroupSweepStart: (id: string, selected: boolean) => void
  onMemberSweepStart: (member: MoveMember, selected: boolean) => void
  onGroupSweepEnter: (id: string, pressed: boolean) => void
  onMemberSweepEnter: (member: MoveMember, pressed: boolean) => void
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
  selectedGroupIDs,
  selectedMemberKeys,
  onGroupSelect,
  onMemberSelect,
  onGroupSweepStart,
  onMemberSweepStart,
  onGroupSweepEnter,
  onMemberSweepEnter,
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
        icon={
          (children.length || directMembers.length) && expanded
            ? Folder02Icon
            : FolderIcon
        }
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
      selected={selectedMemberKeys.includes(`${group.id}:${member.id}`)}
      onSelect={() =>
        onMemberSelect({ id: member.id, source_group_id: group.id })
      }
      onSweepStart={() =>
        onMemberSweepStart(
          { id: member.id, source_group_id: group.id },
          selectedMemberKeys.includes(`${group.id}:${member.id}`)
        )
      }
      onSweepEnter={(pressed) =>
        onMemberSweepEnter(
          { id: member.id, source_group_id: group.id },
          pressed
        )
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
            "group/group-row flex cursor-pointer items-center rounded-md pe-1 transition-colors",
            (hovered || menuOpen) && "bg-foreground/5",
            selectedGroupIDs.includes(group.id) && "bg-primary/10",
            dropHovered && "ring-2 ring-primary"
          )}
          onPointerEnter={(event) => {
            setHovered(true)
            if (actions.includes("move")) {
              onGroupSweepEnter(group.id, (event.buttons & 1) !== 0)
            }
          }}
          onPointerLeave={() => setHovered(false)}
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
          {actions.includes("move") && (
            <SelectionDot
              selected={selectedGroupIDs.includes(group.id)}
              onPress={() =>
                onGroupSweepStart(group.id, selectedGroupIDs.includes(group.id))
              }
              onToggle={() => onGroupSelect(group.id)}
              label={`${group.name} · ${t("pages.membersAndGroups.moveGroup")}`}
              className="ms-2"
            />
          )}
          {children.length || directMembers.length ? (
            <CollapsibleTrigger render={triggerButton}>
              {label}
            </CollapsibleTrigger>
          ) : (
            <span
              className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm"
              style={{ paddingInlineStart: `${level * 1.25 + 0.5}rem` }}
            >
              {label}
            </span>
          )}
          {actions.includes("move") && (
            <span
              draggable
              onDragStart={(event) => onGroupDragStart(group, event)}
              onDragEnd={onDragEnd}
              title={t("pages.membersAndGroups.moveGroup")}
              className="cursor-grab px-1 text-muted-foreground active:cursor-grabbing"
            >
              <HugeiconsIcon
                icon={MoveIcon}
                className="size-4"
                strokeWidth={2}
              />
            </span>
          )}
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
                  {actions
                    .filter((action) => action !== "delete")
                    .map((action) => (
                      <DropdownMenuItem
                        key={action}
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
                {actions.includes("delete") && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onAction({ action: "delete", group })}
                      >
                        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
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
          <CollapsibleContent>
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
                  selectedGroupIDs={selectedGroupIDs}
                  selectedMemberKeys={selectedMemberKeys}
                  onGroupSelect={onGroupSelect}
                  onMemberSelect={onMemberSelect}
                  onGroupSweepStart={onGroupSweepStart}
                  onMemberSweepStart={onMemberSweepStart}
                  onGroupSweepEnter={onGroupSweepEnter}
                  onMemberSweepEnter={onMemberSweepEnter}
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
  selected,
  onSelect,
  onSweepStart,
  onSweepEnter,
  onDragStart,
  onDragEnd,
}: Pick<
  Props,
  | "savingID"
  | "currentUserID"
  | "onToggleStatus"
  | "onToggleRole"
  | "onResetPassword"
> & {
  member: MemberActionUser
  level: number
  selected: boolean
  onSelect: () => void
  onSweepStart: () => void
  onSweepEnter: (pressed: boolean) => void
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
      onPointerEnter={(event) => {
        setHovered(true)
        onSweepEnter((event.buttons & 1) !== 0)
      }}
      onPointerLeave={() => setHovered(false)}
      className={cn(
        "flex min-w-0 cursor-pointer items-center gap-2 rounded-md pe-1 text-sm transition-colors",
        (hovered || menuOpen) && "bg-foreground/5",
        selected && "bg-primary/10",
        member.status === "disabled" && "text-muted-foreground"
      )}
      style={{ paddingInlineStart: `${level * 1.25 + 0.5}rem` }}
    >
      <SelectionDot
        selected={selected}
        onPress={onSweepStart}
        onToggle={onSelect}
        label={member.name}
        className="me-2"
      />
      <HugeiconsIcon
        icon={User02Icon}
        className={cn("size-4 shrink-0", memberIconColor(member))}
        strokeWidth={2}
        aria-hidden="true"
      />
      <span
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="min-w-0 flex-1 cursor-grab truncate active:cursor-grabbing"
        title={member.email}
      >
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
    </li>
  )
}

function SelectionDot({
  selected,
  label,
  className,
  onPress,
  onToggle,
}: {
  selected: boolean
  label: string
  className?: string
  onPress: () => void
  onToggle: () => void
}) {
  const pointerType = useRef("")

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      className={cn(
        "relative inline-flex size-5 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        pointerType.current = event.pointerType
        if (event.pointerType === "mouse" && event.button === 0) {
          event.preventDefault()
          onPress()
        }
      }}
      onClick={(event) => {
        if (event.detail === 0 || pointerType.current !== "mouse") onToggle()
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2.5 rounded-full border border-input bg-white transition-colors",
          selected && "border-foreground bg-foreground"
        )}
      />
    </button>
  )
}
