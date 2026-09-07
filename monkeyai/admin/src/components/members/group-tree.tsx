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
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
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
  descendantIDs,
  type MemberGroup,
} from "@/lib/member-groups"
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
  users: Array<{ id: string; role: "admin" | "user" }>
  selectedID: string
  onSelect: (id: string) => void
  onAction: (action: ActiveGroupAction) => void
  level?: number
}

export function GroupTreeItem({
  group,
  groups,
  users,
  selectedID,
  onSelect,
  onAction,
  level = 0,
}: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const open =
    expanded ||
    (selectedID !== group.id && descendantIDs(groups, group.id).has(selectedID))
  const children = groups.filter((child) => child.parent_id === group.id)
  const isRoot = group.id === ROOT_GROUP_ID
  const actions: GroupAction[] = isRoot
    ? ["add-subgroup"]
    : ["add-subgroup", "rename", "adjust-members", "move", "delete"]
  const count = groupMemberIDs(groups, users, group.id).size
  const label = (
    <>
      <HugeiconsIcon
        icon={children.length && open ? Folder02Icon : FolderIcon}
        strokeWidth={2}
      />
      <span className="truncate">{group.name}</span>
    </>
  )
  const selectButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={selectedID === group.id}
      className="min-w-0 flex-1 justify-start font-normal hover:bg-transparent! aria-expanded:bg-transparent!"
      style={{ paddingInlineStart: `${level * 1.25 + 0.5}rem` }}
      onClick={() => onSelect(group.id)}
    />
  )

  return (
    <li>
      <Collapsible open={open} onOpenChange={setExpanded}>
        <div
          className={cn(
            "group/group-row flex items-center rounded-md hover:bg-muted",
            selectedID === group.id && "bg-muted"
          )}
        >
          {children.length ? (
            <CollapsibleTrigger render={selectButton}>
              {label}
            </CollapsibleTrigger>
          ) : (
            <Button {...selectButton.props}>{label}</Button>
          )}
          <span className="px-2 text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 cursor-pointer"
                  aria-label={`${group.name} · ${t("pages.membersAndGroups.groupActions")}`}
                />
              }
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
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
        {children.length > 0 && (
          <CollapsibleContent>
            <ul className="flex flex-col gap-1">
              {children.map((child) => (
                <GroupTreeItem
                  key={child.id}
                  group={child}
                  groups={groups}
                  users={users}
                  selectedID={selectedID}
                  onSelect={onSelect}
                  onAction={onAction}
                  level={level + 1}
                />
              ))}
            </ul>
          </CollapsibleContent>
        )}
      </Collapsible>
    </li>
  )
}
