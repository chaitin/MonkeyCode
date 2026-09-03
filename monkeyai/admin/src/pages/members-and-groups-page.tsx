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
import type { TFunction } from "i18next"
import {
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react"
import { useTranslation } from "react-i18next"

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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogClose,
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"

type GroupNode = {
  id: string
  labelKey: string
  count: number
  children?: GroupNode[]
}

type Member = {
  id: string
  name: string
  email: string
  joinedAt: string
  remainingCredits: number
  groupId: string
}

type GroupAction =
  "add-subgroup" | "rename" | "adjust-members" | "move" | "delete"

type ActiveGroupAction = {
  action: GroupAction
  groupId: string
}

const MEMBERS: Member[] = [
  {
    id: "member-01",
    name: "陈晨",
    email: "chen.chen@example.com",
    joinedAt: "2024-03-18",
    remainingCredits: 12840,
    groupId: "administrators",
  },
  {
    id: "member-02",
    name: "Alice Zhang",
    email: "alice.zhang@example.com",
    joinedAt: "2024-05-06",
    remainingCredits: 9320,
    groupId: "administrators",
  },
  {
    id: "member-03",
    name: "Omar Hassan",
    email: "omar.hassan@example.com",
    joinedAt: "2024-07-22",
    remainingCredits: 7650,
    groupId: "administrators",
  },
  {
    id: "member-04",
    name: "林玫",
    email: "lin.mei@example.com",
    joinedAt: "2024-08-14",
    remainingCredits: 11460,
    groupId: "product",
  },
  {
    id: "member-05",
    name: "Sophia Chen",
    email: "sophia.chen@example.com",
    joinedAt: "2024-09-03",
    remainingCredits: 6890,
    groupId: "product",
  },
  {
    id: "member-06",
    name: "Lucas Martin",
    email: "lucas.martin@example.com",
    joinedAt: "2024-10-19",
    remainingCredits: 10230,
    groupId: "product",
  },
  {
    id: "member-07",
    name: "Priya Patel",
    email: "priya.patel@example.com",
    joinedAt: "2024-11-08",
    remainingCredits: 5480,
    groupId: "product",
  },
  {
    id: "member-08",
    name: "Carlos Silva",
    email: "carlos.silva@example.com",
    joinedAt: "2024-12-16",
    remainingCredits: 8770,
    groupId: "product",
  },
  {
    id: "member-09",
    name: "王伟",
    email: "wang.wei@example.com",
    joinedAt: "2025-01-09",
    remainingCredits: 14320,
    groupId: "engineering",
  },
  {
    id: "member-10",
    name: "Alex Kim",
    email: "alex.kim@example.com",
    joinedAt: "2025-01-27",
    remainingCredits: 7280,
    groupId: "engineering",
  },
  {
    id: "member-11",
    name: "Daniel Weber",
    email: "daniel.weber@example.com",
    joinedAt: "2025-02-11",
    remainingCredits: 4160,
    groupId: "engineering",
  },
  {
    id: "member-12",
    name: "Elena Petrova",
    email: "elena.petrova@example.com",
    joinedAt: "2025-03-05",
    remainingCredits: 9860,
    groupId: "engineering",
  },
  {
    id: "member-13",
    name: "Yuki Tanaka",
    email: "yuki.tanaka@example.com",
    joinedAt: "2025-03-24",
    remainingCredits: 6310,
    groupId: "engineering",
  },
  {
    id: "member-14",
    name: "Minh Nguyen",
    email: "minh.nguyen@example.com",
    joinedAt: "2025-04-17",
    remainingCredits: 11940,
    groupId: "engineering",
  },
  {
    id: "member-15",
    name: "Ahmed Saleh",
    email: "ahmed.saleh@example.com",
    joinedAt: "2025-05-02",
    remainingCredits: 3520,
    groupId: "engineering",
  },
  {
    id: "member-16",
    name: "María García",
    email: "maria.garcia@example.com",
    joinedAt: "2025-05-28",
    remainingCredits: 8240,
    groupId: "engineering",
  },
  {
    id: "member-17",
    name: "Ethan Brown",
    email: "ethan.brown@example.com",
    joinedAt: "2025-06-13",
    remainingCredits: 13570,
    groupId: "engineering",
  },
  {
    id: "member-18",
    name: "李娜",
    email: "li.na@example.com",
    joinedAt: "2025-07-01",
    remainingCredits: 5970,
    groupId: "operations",
  },
  {
    id: "member-19",
    name: "Emma Wilson",
    email: "emma.wilson@example.com",
    joinedAt: "2025-07-21",
    remainingCredits: 10880,
    groupId: "operations",
  },
  {
    id: "member-20",
    name: "João Santos",
    email: "joao.santos@example.com",
    joinedAt: "2025-08-08",
    remainingCredits: 4710,
    groupId: "operations",
  },
  {
    id: "member-21",
    name: "Fatima Zahra",
    email: "fatima.zahra@example.com",
    joinedAt: "2025-09-15",
    remainingCredits: 7960,
    groupId: "operations",
  },
  {
    id: "member-22",
    name: "박지훈",
    email: "jihoon.park@example.com",
    joinedAt: "2025-10-06",
    remainingCredits: 12450,
    groupId: "operations",
  },
  {
    id: "member-23",
    name: "Ivan Smirnov",
    email: "ivan.smirnov@example.com",
    joinedAt: "2025-11-18",
    remainingCredits: 2890,
    groupId: "operations",
  },
  {
    id: "member-24",
    name: "Ana López",
    email: "ana.lopez@example.com",
    joinedAt: "2025-12-04",
    remainingCredits: 9150,
    groupId: "operations",
  },
]

const GROUP_TREE: GroupNode[] = [
  {
    id: "all-members",
    labelKey: "rootGroup",
    count: 24,
    children: [
      {
        id: "administrators",
        labelKey: "administrators",
        count: 3,
      },
      {
        id: "product-and-engineering",
        labelKey: "productAndEngineering",
        count: 14,
        children: [
          {
            id: "product",
            labelKey: "product",
            count: 5,
          },
          {
            id: "engineering",
            labelKey: "engineering",
            count: 9,
          },
        ],
      },
      {
        id: "operations",
        labelKey: "operations",
        count: 7,
      },
    ],
  },
]

function getGroupAndDescendantIds(group: GroupNode): string[] {
  return [
    group.id,
    ...(group.children?.flatMap(getGroupAndDescendantIds) ?? []),
  ]
}

function findGroup(
  groups: GroupNode[],
  groupId: string
): GroupNode | undefined {
  for (const group of groups) {
    if (group.id === groupId) {
      return group
    }

    const childGroup = findGroup(group.children ?? [], groupId)
    if (childGroup) {
      return childGroup
    }
  }

  return undefined
}

function getAvailableMoveTargetTree(
  groups: GroupNode[],
  excludedGroupIds: Set<string>
): GroupNode[] {
  return groups.flatMap((group) => {
    if (excludedGroupIds.has(group.id)) {
      return []
    }

    return [
      {
        ...group,
        children: getAvailableMoveTargetTree(
          group.children ?? [],
          excludedGroupIds
        ),
      },
    ]
  })
}

function getGroupLabel(group: GroupNode, t: TFunction) {
  return t(`pages.membersAndGroups.groupNames.${group.labelKey}`)
}

function GroupActions({
  group,
  onAction,
  t,
}: {
  group: GroupNode
  onAction: (action: GroupAction, groupId: string) => void
  t: TFunction
}) {
  return (
    <div className="group/actions relative ms-auto size-8 shrink-0">
      <span className="pointer-events-none absolute inset-0 hidden items-center justify-center text-xs text-muted-foreground tabular-nums transition-opacity md:flex md:group-focus-within/actions:opacity-0 md:group-hover/group-row:opacity-0">
        {group.count}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute inset-0 aria-expanded:opacity-100 md:opacity-0 md:group-focus-within/actions:opacity-100 md:group-hover/group-row:opacity-100"
              aria-label={t("pages.membersAndGroups.groupActions")}
              onClick={(event) => event.stopPropagation()}
            />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => onAction("add-subgroup", group.id)}
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              {t("pages.membersAndGroups.addSubgroup")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("rename", group.id)}>
              <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
              {t("pages.membersAndGroups.renameGroup")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onAction("adjust-members", group.id)}
            >
              <HugeiconsIcon icon={UserMultiple02Icon} strokeWidth={2} />
              {t("pages.membersAndGroups.adjustMembers")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("move", group.id)}>
              <HugeiconsIcon icon={MoveIcon} strokeWidth={2} />
              {t("pages.membersAndGroups.moveGroup")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onAction("delete", group.id)}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
              {t("pages.membersAndGroups.deleteGroup")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function MemberActions({
  isAdministrator,
  isEnabled,
  member,
  onToggleAdministrator,
  onToggleEnabled,
  t,
}: {
  isAdministrator: boolean
  isEnabled: boolean
  member: Member
  onToggleAdministrator: (memberId: string) => void
  onToggleEnabled: (memberId: string) => void
  t: TFunction
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("pages.membersAndGroups.memberActions", {
              member: member.name,
            })}
          />
        }
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => onToggleEnabled(member.id)}>
            {t(
              isEnabled
                ? "pages.membersAndGroups.disableMember"
                : "pages.membersAndGroups.enableMember"
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onToggleAdministrator(member.id)}>
            {t(
              isAdministrator
                ? "pages.membersAndGroups.removeAdministrator"
                : "pages.membersAndGroups.makeAdministrator"
            )}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const ACTION_TITLE_KEYS: Record<GroupAction, string> = {
  "add-subgroup": "pages.membersAndGroups.addSubgroup",
  rename: "pages.membersAndGroups.renameGroup",
  "adjust-members": "pages.membersAndGroups.adjustMembers",
  move: "pages.membersAndGroups.moveGroup",
  delete: "pages.membersAndGroups.deleteGroup",
}

const ACTION_SUBMIT_KEYS: Record<GroupAction, string> = {
  "add-subgroup": "pages.membersAndGroups.createGroup",
  rename: "pages.membersAndGroups.saveChanges",
  "adjust-members": "pages.membersAndGroups.applyChanges",
  move: "pages.membersAndGroups.moveAction",
  delete: "pages.membersAndGroups.deleteAction",
}

function MoveTargetTree({
  groups,
  level = 0,
  selectedGroupId,
  t,
}: {
  groups: GroupNode[]
  level?: number
  selectedGroupId: string
  t: TFunction
}) {
  return (
    <ul className="flex flex-col gap-1">
      {groups.map((candidate) => {
        const radioId = `move-target-${candidate.id}`
        const hasChildren = Boolean(candidate.children?.length)
        const isSelected = selectedGroupId === candidate.id

        return (
          <li key={candidate.id}>
            <Field
              className={cn(
                "min-w-0 gap-0 rounded-md hover:bg-muted has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                isSelected && "bg-muted"
              )}
              orientation="horizontal"
            >
              <RadioGroupItem
                className="sr-only"
                id={radioId}
                value={candidate.id}
              />
              <FieldLabel
                className="h-8 w-full min-w-0 cursor-pointer justify-start px-2 font-normal [&_svg]:size-4 [&_svg]:shrink-0"
                htmlFor={radioId}
                style={{ paddingInlineStart: `${level * 1.25 + 0.5}rem` }}
              >
                <HugeiconsIcon
                  icon={hasChildren ? Folder02Icon : FolderIcon}
                  strokeWidth={2}
                />
                <span className="truncate">{getGroupLabel(candidate, t)}</span>
              </FieldLabel>
            </Field>
            {hasChildren && (
              <MoveTargetTree
                groups={candidate.children ?? []}
                level={level + 1}
                selectedGroupId={selectedGroupId}
                t={t}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function GroupActionDialog({
  action,
  group,
  groups,
  members,
  onOpenChange,
  t,
}: {
  action: GroupAction
  group: GroupNode
  groups: GroupNode[]
  members: Member[]
  onOpenChange: (open: boolean) => void
  t: TFunction
}) {
  const groupName = getGroupLabel(group, t)
  const groupIds = new Set(getGroupAndDescendantIds(group))
  const [selectedMemberIds, setSelectedMemberIds] = useState(() =>
    members
      .filter((member) => groupIds.has(member.groupId))
      .map((member) => member.id)
  )
  const [memberQuery, setMemberQuery] = useState("")
  const [moveTarget, setMoveTarget] = useState("")
  const moveTargetTree = getAvailableMoveTargetTree(groups, groupIds)
  const normalizedMemberQuery = memberQuery.trim().toLocaleLowerCase()
  const visibleMembers = members.filter(
    (member) =>
      normalizedMemberQuery.length === 0 ||
      member.name.toLocaleLowerCase().includes(normalizedMemberQuery) ||
      member.email.toLocaleLowerCase().includes(normalizedMemberQuery)
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onOpenChange(false)
  }

  if (action === "delete") {
    return (
      <AlertDialog open onOpenChange={onOpenChange}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t(ACTION_TITLE_KEYS[action])}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.membersAndGroups.deleteGroupDialogDescription", {
                group: groupName,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("pages.membersAndGroups.cancelAction")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => onOpenChange(false)}
            >
              {t(ACTION_SUBMIT_KEYS[action])}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        closeLabel={t("common.close")}
      >
        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t(ACTION_TITLE_KEYS[action])}</DialogTitle>
          </DialogHeader>

          {action === "add-subgroup" && (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="subgroup-name">
                  {t("pages.membersAndGroups.groupName")}
                </FieldLabel>
                <Input
                  autoFocus
                  id="subgroup-name"
                  name="groupName"
                  placeholder={t("pages.membersAndGroups.groupNamePlaceholder")}
                  required
                />
              </Field>
            </FieldGroup>
          )}

          {action === "rename" && (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="group-name">
                  {t("pages.membersAndGroups.groupName")}
                </FieldLabel>
                <Input
                  autoFocus
                  defaultValue={groupName}
                  id="group-name"
                  name="groupName"
                  required
                />
              </Field>
            </FieldGroup>
          )}

          {action === "adjust-members" && (
            <FieldSet>
              <FieldLegend variant="label">
                {t("pages.membersAndGroups.selectMembers")}
              </FieldLegend>
              <Field>
                <FieldLabel className="sr-only" htmlFor="member-search">
                  {t("pages.membersAndGroups.searchMembers")}
                </FieldLabel>
                <Input
                  autoFocus
                  id="member-search"
                  placeholder={t(
                    "pages.membersAndGroups.searchMembersPlaceholder"
                  )}
                  type="search"
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                />
              </Field>
              <div
                className="flex max-h-80 flex-col gap-2 overflow-y-auto pe-1"
                data-slot="checkbox-group"
              >
                {visibleMembers.map((member) => {
                  const checkboxId = `member-${group.id}-${member.id}`
                  const checked = selectedMemberIds.includes(member.id)

                  return (
                    <FieldLabel htmlFor={checkboxId} key={member.id}>
                      <Field className="min-w-0" orientation="horizontal">
                        <Checkbox
                          checked={checked}
                          id={checkboxId}
                          onCheckedChange={(nextChecked) => {
                            setSelectedMemberIds((currentIds) =>
                              nextChecked
                                ? [...currentIds, member.id]
                                : currentIds.filter(
                                    (memberId) => memberId !== member.id
                                  )
                            )
                          }}
                        />
                        <span className="min-w-0 truncate text-sm">
                          <span className="font-medium">{member.name}</span>
                          <span className="ms-2 text-muted-foreground">
                            {member.email}
                          </span>
                        </span>
                      </Field>
                    </FieldLabel>
                  )
                })}
                {visibleMembers.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t("pages.membersAndGroups.noMembersFound")}
                  </p>
                )}
              </div>
            </FieldSet>
          )}

          {action === "move" && (
            <Field>
              <FieldLabel>
                {t("pages.membersAndGroups.targetParentGroup")}
              </FieldLabel>
              {moveTargetTree.length > 0 ? (
                <RadioGroup
                  aria-label={t("pages.membersAndGroups.targetParentGroup")}
                  className="max-h-72 overflow-y-auto pe-1"
                  value={moveTarget}
                  onValueChange={setMoveTarget}
                >
                  <MoveTargetTree
                    groups={moveTargetTree}
                    selectedGroupId={moveTarget}
                    t={t}
                  />
                </RadioGroup>
              ) : (
                <FieldDescription>
                  {t("pages.membersAndGroups.noMoveTargets")}
                </FieldDescription>
              )}
            </Field>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t("pages.membersAndGroups.cancelAction")}
            </DialogClose>
            <Button disabled={action === "move" && !moveTarget} type="submit">
              {t(ACTION_SUBMIT_KEYS[action])}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function GroupTreeItem({
  group,
  level,
  selectedGroupId,
  onSelect,
  onGroupAction,
  t,
}: {
  group: GroupNode
  level: number
  selectedGroupId: string
  onSelect: (groupId: string) => void
  onGroupAction: (action: GroupAction, groupId: string) => void
  t: TFunction
}) {
  const [isOpen, setIsOpen] = useState(level === 0)
  const isSelected = selectedGroupId === group.id
  const rowStyle = {
    paddingInlineStart: `${level * 1.25 + 0.5}rem`,
  }
  const label = t(`pages.membersAndGroups.groupNames.${group.labelKey}`)

  return (
    <li>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div
          className={cn(
            "group/group-row flex items-center rounded-md hover:bg-muted",
            isSelected && "bg-muted"
          )}
        >
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={isSelected}
                className="min-w-0 flex-1 justify-start pe-2 font-normal hover:bg-transparent! aria-expanded:bg-transparent!"
                style={rowStyle}
                onClick={() => onSelect(group.id)}
              />
            }
          >
            <HugeiconsIcon
              icon={isOpen ? Folder02Icon : FolderIcon}
              strokeWidth={2}
              data-icon="inline-start"
            />
            <span className="truncate">{label}</span>
          </CollapsibleTrigger>
          <GroupActions group={group} onAction={onGroupAction} t={t} />
        </div>
        <CollapsibleContent>
          <ul className="flex flex-col gap-1">
            {group.children?.map((child) => (
              <GroupTreeItem
                key={child.id}
                group={child}
                level={level + 1}
                selectedGroupId={selectedGroupId}
                onSelect={onSelect}
                onGroupAction={onGroupAction}
                t={t}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

export function MembersAndGroupsPage() {
  const { i18n, t } = useTranslation()
  const [selectedGroupId, setSelectedGroupId] = useState(GROUP_TREE[0].id)
  const [activeGroupAction, setActiveGroupAction] =
    useState<ActiveGroupAction | null>(null)
  const [disabledMemberIds, setDisabledMemberIds] = useState(
    () => new Set<string>()
  )
  const [administratorMemberIds, setAdministratorMemberIds] = useState(
    () =>
      new Set(
        MEMBERS.filter((member) => member.groupId === "administrators").map(
          (member) => member.id
        )
      )
  )
  const selectedGroup = findGroup(GROUP_TREE, selectedGroupId)
  const actionGroup = activeGroupAction
    ? findGroup(GROUP_TREE, activeGroupAction.groupId)
    : undefined
  const selectedGroupIds = new Set(
    selectedGroup ? getGroupAndDescendantIds(selectedGroup) : []
  )
  const visibleMembers = MEMBERS.filter((member) =>
    selectedGroupIds.has(member.groupId)
  )
  const numberFormatter = new Intl.NumberFormat(
    i18n.resolvedLanguage ?? i18n.language
  )
  const dateFormatter = new Intl.DateTimeFormat(
    i18n.resolvedLanguage ?? i18n.language,
    { dateStyle: "medium" }
  )

  const toggleSetValue = (
    setValues: Dispatch<SetStateAction<Set<string>>>,
    value: string
  ) => {
    setValues((currentValues) => {
      const nextValues = new Set(currentValues)

      if (nextValues.has(value)) {
        nextValues.delete(value)
      } else {
        nextValues.add(value)
      }

      return nextValues
    })
  }

  return (
    <section className="flex flex-1 flex-col p-4 pt-px md:h-[calc(100svh-4rem)] md:min-h-0 md:flex-none md:overflow-hidden">
      <div className="grid flex-1 gap-4 md:min-h-0 md:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]">
        <Card className="min-h-96 md:min-h-0">
          <CardHeader>
            <CardTitle>{t("pages.membersAndGroups.groupsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            <ul
              className="flex flex-col gap-1"
              aria-label={t("pages.membersAndGroups.groupsTitle")}
            >
              {GROUP_TREE.map((group) => (
                <GroupTreeItem
                  key={group.id}
                  group={group}
                  level={0}
                  selectedGroupId={selectedGroupId}
                  onSelect={setSelectedGroupId}
                  onGroupAction={(action, groupId) =>
                    setActiveGroupAction({ action, groupId })
                  }
                  t={t}
                />
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="min-h-96 md:min-h-0">
          <CardHeader>
            <CardTitle>{t("pages.membersAndGroups.membersTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            <ItemGroup className="gap-2">
              {visibleMembers.map((member) => {
                const isDisabled = disabledMemberIds.has(member.id)
                const joinedAt = new Date(`${member.joinedAt}T00:00:00`)

                return (
                  <Item
                    key={member.id}
                    role="listitem"
                    size="sm"
                    variant={isDisabled ? "muted" : "outline"}
                  >
                    <ItemMedia>
                      <Avatar size="lg">
                        <AvatarFallback>
                          {member.name.slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="max-w-full min-w-0">
                        <span className="truncate font-medium">
                          {member.name}
                        </span>
                        {isDisabled && (
                          <Badge variant="outline">
                            {t("pages.membersAndGroups.memberDisabled")}
                          </Badge>
                        )}
                      </ItemTitle>
                      <ItemDescription className="line-clamp-1 text-xs">
                        {member.email}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions className="ms-auto shrink-0">
                      <Badge variant="secondary">
                        {t("pages.membersAndGroups.remainingCredits", {
                          count: numberFormatter.format(
                            member.remainingCredits
                          ),
                        })}
                      </Badge>
                      <MemberActions
                        isAdministrator={administratorMemberIds.has(member.id)}
                        isEnabled={!isDisabled}
                        member={member}
                        onToggleAdministrator={(memberId) =>
                          toggleSetValue(setAdministratorMemberIds, memberId)
                        }
                        onToggleEnabled={(memberId) =>
                          toggleSetValue(setDisabledMemberIds, memberId)
                        }
                        t={t}
                      />
                    </ItemActions>
                    <ItemSeparator className="my-0" />
                    <ItemFooter className="text-xs text-muted-foreground">
                      <span>
                        {t("pages.membersAndGroups.joinedAt", {
                          date: dateFormatter.format(joinedAt),
                          day: joinedAt.getDate(),
                          month: joinedAt.getMonth() + 1,
                          year: joinedAt.getFullYear(),
                        })}
                      </span>
                      <Badge variant="outline">
                        {t(
                          `pages.membersAndGroups.groupNames.${findGroup(GROUP_TREE, member.groupId)?.labelKey}`
                        )}
                      </Badge>
                    </ItemFooter>
                  </Item>
                )
              })}
            </ItemGroup>
          </CardContent>
        </Card>
      </div>
      {activeGroupAction && actionGroup && (
        <GroupActionDialog
          key={`${activeGroupAction.action}-${actionGroup.id}`}
          action={activeGroupAction.action}
          group={actionGroup}
          groups={GROUP_TREE}
          members={MEMBERS}
          onOpenChange={(open) => {
            if (!open) {
              setActiveGroupAction(null)
            }
          }}
          t={t}
        />
      )}
    </section>
  )
}
