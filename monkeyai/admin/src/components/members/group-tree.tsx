import { useState } from "react"
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
  type GroupAction,
  type ActiveGroupAction,
  ROOT_GROUP_ID,
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
  level = 0,
}: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const [ungroupedExpanded, setUngroupedExpanded] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [ungroupedHovered, setUngroupedHovered] = useState(false)
  const children = groups
    .filter((child) => child.parent_id === group.id)
    .sort((a, b) => compareByName(a, b, nameCollator))
  const directIDs = directMemberIDs(groups, users, group.id)
  const directMembers = users
    .filter((user) => directIDs.has(user.id))
    .sort((a, b) => compareByName(a, b, nameCollator))
  const isRoot = group.id === ROOT_GROUP_ID
  const actions: GroupAction[] = isRoot
    ? ["add-subgroup"]
    : ["add-subgroup", "rename", "adjust-members", "move", "delete"]
  const count = groupMemberIDs(groups, users, group.id).size
  const label = (
    <>
      <HugeiconsIcon
        icon={
          (children.length || directMembers.length || isRoot) && expanded
            ? Folder02Icon
            : FolderIcon
        }
        className="size-4 shrink-0 text-yellow-600 dark:text-yellow-400"
        strokeWidth={2}
      />
      <span className="truncate">{group.name}</span>
    </>
  )
  const triggerButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="min-w-0 flex-1 justify-start font-normal hover:bg-transparent! aria-expanded:bg-transparent!"
      style={{ paddingInlineStart: `${level * 1.25 + 0.5}rem` }}
    />
  )

  const memberRows = directMembers.map((member) => (
    <GroupTreeMemberRow
      key={member.id}
      member={member}
      level={level + (isRoot ? 2 : 1)}
      savingID={savingID}
      currentUserID={currentUserID}
      onToggleStatus={onToggleStatus}
      onToggleRole={onToggleRole}
    />
  ))

  return (
    <li>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div
          className={cn(
            "group/group-row flex items-center rounded-md transition-colors",
            hovered && "bg-foreground/8 dark:bg-foreground/10"
          )}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          {children.length || directMembers.length || isRoot ? (
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
          <div className="group/row-actions grid min-h-8 min-w-8 shrink-0 place-items-center">
            <span
              className={cn(
                "pointer-events-none col-start-1 row-start-1 px-1 text-xs text-muted-foreground tabular-nums transition-opacity duration-150 ease-in-out group-has-[:focus-visible]/row-actions:opacity-0 motion-reduce:transition-none",
                (hovered || menuOpen) && "opacity-0"
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
                      "col-start-1 row-start-1 cursor-pointer opacity-0 transition-[opacity,background-color] duration-150 ease-in-out focus-visible:opacity-100 motion-reduce:transition-none",
                      (hovered || menuOpen) && "opacity-100"
                    )}
                    aria-label={`${group.name} · ${t("pages.membersAndGroups.groupActions")}`}
                  />
                }
              >
                <HugeiconsIcon
                  icon={MoreHorizontalIcon}
                  className="size-3"
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
                {!isRoot && (
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
        {(children.length > 0 || directMembers.length > 0 || isRoot) && (
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
                  level={level + 1}
                />
              ))}
              {isRoot ? (
                <li>
                  <Collapsible
                    open={ungroupedExpanded}
                    onOpenChange={setUngroupedExpanded}
                  >
                    <div
                      className={cn(
                        "group/group-row flex items-center rounded-md transition-colors",
                        ungroupedHovered &&
                          "bg-foreground/8 dark:bg-foreground/10"
                      )}
                      onPointerEnter={() => setUngroupedHovered(true)}
                      onPointerLeave={() => setUngroupedHovered(false)}
                    >
                      {directMembers.length > 0 ? (
                        <CollapsibleTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="min-w-0 flex-1 justify-start font-normal hover:bg-transparent! aria-expanded:bg-transparent!"
                              style={{
                                paddingInlineStart: `${(level + 1) * 1.25 + 0.5}rem`,
                              }}
                            />
                          }
                        >
                          <HugeiconsIcon
                            icon={ungroupedExpanded ? Folder02Icon : FolderIcon}
                            className="size-4 shrink-0 text-yellow-600 dark:text-yellow-400"
                            strokeWidth={2}
                          />
                          <span className="truncate">
                            {t("pages.membersAndGroups.ungroupedMembers")}
                          </span>
                        </CollapsibleTrigger>
                      ) : (
                        <span
                          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm"
                          style={{
                            paddingInlineStart: `${(level + 1) * 1.25 + 0.5}rem`,
                          }}
                        >
                          <HugeiconsIcon
                            icon={FolderIcon}
                            className="size-4 shrink-0 text-yellow-600 dark:text-yellow-400"
                            strokeWidth={2}
                          />
                          <span className="truncate">
                            {t("pages.membersAndGroups.ungroupedMembers")}
                          </span>
                        </span>
                      )}
                      <span className="grid min-h-8 min-w-8 shrink-0 place-items-center px-1 text-xs text-muted-foreground tabular-nums">
                        {directMembers.length}
                      </span>
                    </div>
                    {directMembers.length > 0 && (
                      <CollapsibleContent>
                        <ul className="flex flex-col gap-1">{memberRows}</ul>
                      </CollapsibleContent>
                    )}
                  </Collapsible>
                </li>
              ) : (
                memberRows
              )}
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
}: Pick<
  Props,
  "savingID" | "currentUserID" | "onToggleStatus" | "onToggleRole"
> & {
  member: MemberActionUser
  level: number
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <li
      aria-busy={savingID === member.id}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md text-sm transition-colors",
        hovered && "bg-foreground/8 dark:bg-foreground/10",
        member.status === "disabled" && "text-muted-foreground"
      )}
      style={{ paddingInlineStart: `${level * 1.25 + 0.5}rem` }}
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
      <div className="flex size-8 shrink-0 items-center justify-center">
        <MemberActions
          user={member}
          savingID={savingID}
          currentUserID={currentUserID}
          treeRowHovered={hovered}
          onToggleStatus={onToggleStatus}
          onToggleRole={onToggleRole}
        />
      </div>
    </li>
  )
}
