import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
} from "react"
import {
  Add01Icon,
  ArrowDown01Icon,
  MoveIcon,
  PowerIcon,
  PowerOffIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import { MoveMembersDialog } from "@/components/members/move-members-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { compareMembers } from "@/lib/member-sorting"
import {
  canMoveTo,
  memberMoveKey,
  updateMemberSelection,
  type MoveMember,
  type MovePayload,
} from "@/lib/group-move"
import { BulkAddMembersForm } from "@/components/members/bulk-add-members-form"
import { GroupActionDialog } from "@/components/members/group-action-dialog"
import { MemberAvatar } from "@/components/members/member-avatar"
import { MemberGroupSelect } from "@/components/members/member-group-select"
import { GroupTreeItem } from "@/components/members/group-tree"
import { ResetMemberPasswordDialog } from "@/components/members/reset-member-password-dialog"
import {
  MemberActions,
  type MemberActionUser,
} from "@/components/members/member-actions"
import {
  type ActiveGroupAction,
  directGroupsByMember,
  type MemberGroup,
} from "@/lib/member-groups"

type User = MemberActionUser & {
  joined_at: string
  last_login_at?: string
}

type MemberAction =
  "enableMember" | "disableMember" | "makeAdministrator" | "removeAdministrator"

export function MembersAndGroupsPage() {
  const { i18n, t } = useTranslation()
  const { showToast } = useAppToast()
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [groups, setGroups] = useState<MemberGroup[]>([])
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedMembers, setSelectedMembers] = useState<MoveMember[]>([])
  const [moveSelection, setMoveSelection] = useState<MoveMember[] | null>(null)
  const [batchUpdatingStatus, setBatchUpdatingStatus] = useState(false)
  const [pendingBatchStatus, setPendingBatchStatus] = useState<
    User["status"] | null
  >(null)
  const [dragging, setDragging] = useState<MovePayload | null>(null)
  const [pendingMove, setPendingMove] = useState<{
    payload: MovePayload
    target: MemberGroup
  } | null>(null)
  const [moving, setMoving] = useState(false)
  const [activeGroupAction, setActiveGroupAction] =
    useState<ActiveGroupAction | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadRevision, setLoadRevision] = useState(0)
  const [query, setQuery] = useState("")
  const [savingID, setSavingID] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [createMode, setCreateMode] = useState<"single" | "bulk">("single")
  const [creating, setCreating] = useState(false)
  const [newMemberGroupIDs, setNewMemberGroupIDs] = useState<string[]>([])
  const [batchSaving, setBatchSaving] = useState(false)
  const [pendingMemberAction, setPendingMemberAction] = useState<{
    user: MemberActionUser
    action: MemberAction
  } | null>(null)
  const [passwordResetUser, setPasswordResetUser] =
    useState<MemberActionUser | null>(null)
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    role: "user" as User["role"],
    password: "",
  })

  useEffect(() => {
    Promise.all([
      api<{ users: User[] }>("/api/admin/v1/users"),
      api<{ groups: MemberGroup[] }>("/api/admin/v1/groups"),
    ])
      .then(([members, result]) => {
        setUsers(members.users)
        setGroups(result.groups)
      })
      .catch((reason: Error) => {
        showToast({
          status: "error",
          title: reason.message,
          action: {
            label: t("statistics.retry"),
            onClick: () => {
              setLoading(true)
              setLoadRevision((value) => value + 1)
            },
          },
        })
      })
      .finally(() => setLoading(false))
  }, [loadRevision, showToast, t])

  const updateUser = async (
    user: MemberActionUser,
    patch: Partial<Pick<MemberActionUser, "name" | "role" | "status">>,
    action: MemberAction
  ) => {
    setSavingID(user.id)
    try {
      const updated = await api<User>(`/api/admin/v1/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: patch.name ?? user.name,
          role: patch.role ?? user.role,
          status: patch.status ?? user.status,
        }),
      })
      setUsers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      )
      showToast({
        status: "success",
        title: t(`pages.membersAndGroups.${action}`),
        description: t("pages.membersAndGroups.actionSucceeded", {
          target: user.name,
        }),
      })
      return true
    } catch (reason) {
      showToast({ status: "error", title: (reason as Error).message })
      return false
    } finally {
      setSavingID("")
    }
  }

  const toggleUserStatus = (user: MemberActionUser) => {
    setPendingMemberAction({
      user,
      action: user.status === "disabled" ? "enableMember" : "disableMember",
    })
  }

  const toggleUserRole = (user: MemberActionUser) => {
    setPendingMemberAction({
      user,
      action:
        user.role === "admin" ? "removeAdministrator" : "makeAdministrator",
    })
  }

  const confirmMemberAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!pendingMemberAction || savingID) return
    const { user, action } = pendingMemberAction
    const patch: Parameters<typeof updateUser>[1] =
      action === "makeAdministrator"
        ? { role: "admin" }
        : action === "removeAdministrator"
          ? { role: "user" }
          : { status: action === "enableMember" ? "active" : "disabled" }
    if (await updateUser(user, patch, action)) {
      setPendingMemberAction(null)
    }
  }

  const visibleUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return users
      .filter(
        (user) =>
          !normalizedQuery ||
          user.name.toLocaleLowerCase().includes(normalizedQuery) ||
          user.email.toLocaleLowerCase().includes(normalizedQuery)
      )
      .sort(compareMembers)
  }, [query, users])

  const reloadGroups = () =>
    api<{ groups: MemberGroup[] }>("/api/admin/v1/groups")
      .then((result) => setGroups(result.groups))
      .catch((reason: Error) =>
        showToast({ status: "error", title: reason.message })
      )

  const selectedMemberKeys = selectedMembers.map(memberMoveKey)
  const selectMember = (member: MoveMember, checked: boolean) => {
    if (!multiSelect || moving) return
    setPendingMove(null)
    setSelectedMembers((current) =>
      updateMemberSelection(current, member, checked)
    )
  }
  const updateSelectedStatus = async (status: User["status"]) => {
    if (moving || batchUpdatingStatus) return
    const selectedUsers = [
      ...new Set(selectedMembers.map((member) => member.id)),
    ]
      .map((id) => users.find((user) => user.id === id))
      .filter((user): user is User => user !== undefined)
    if (!selectedUsers.length) return

    setBatchUpdatingStatus(true)
    let succeeded = 0
    const failures: string[] = []
    for (const user of selectedUsers) {
      try {
        const updated = await api<User>(`/api/admin/v1/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: user.name, role: user.role, status }),
        })
        setUsers((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        )
        succeeded += 1
      } catch (reason) {
        failures.push(`${user.name}: ${(reason as Error).message}`)
      }
    }
    setSelectedMembers([])
    setBatchUpdatingStatus(false)
    setPendingBatchStatus(null)
    if (failures.length) {
      showToast({
        status: "error",
        title: t("pages.membersAndGroups.treeSelection.statusFailure", {
          succeeded,
          failed: failures.length,
        }),
        description: failures.join("; "),
      })
      return
    }
    showToast({
      status: "success",
      title: t("pages.membersAndGroups.treeSelection.statusSuccess", {
        status: t(
          status === "active"
            ? "pages.membersAndGroups.enableMember"
            : "pages.membersAndGroups.disableMember"
        ),
        count: succeeded,
      }),
    })
  }

  const confirmSelectedStatus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!pendingBatchStatus) return
    await updateSelectedStatus(pendingBatchStatus)
  }

  const startDrag = (payload: MovePayload, event: DragEvent) => {
    setDragging(payload)
    setPendingMove(null)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", "move-group-members")
  }
  const dragGroup = (group: MemberGroup, event: DragEvent) => {
    startDrag({ kind: "group", ids: [group.id] }, event)
  }
  const dragMember = (member: MoveMember, event: DragEvent) => {
    const members =
      multiSelect && selectedMemberKeys.includes(memberMoveKey(member))
        ? selectedMembers
        : [member]
    startDrag({ kind: "member", members }, event)
  }
  const dropOn = (target: MemberGroup, event: DragEvent) => {
    if (!dragging || !canMoveTo(groups, dragging, target)) return
    event.preventDefault()
    setPendingMove({ payload: dragging, target })
    setDragging(null)
  }
  const saveMove = async (payload: MovePayload, target: MemberGroup) => {
    if (moving || !canMoveTo(groups, payload, target)) return
    setMoving(true)
    try {
      await api<void>("/api/admin/v1/groups/move", {
        method: "POST",
        body: JSON.stringify({
          target_id: target.id,
          group_ids: payload.kind === "group" ? payload.ids : [],
          members: payload.kind === "member" ? payload.members : [],
        }),
      })
      setSelectedMembers([])
      setPendingMove(null)
      setMoveSelection(null)
      void reloadGroups()
      showToast({
        status: "success",
        title: t("pages.membersAndGroups.actionSucceeded", {
          target: target.name,
        }),
      })
    } catch (reason) {
      showToast({ status: "error", title: (reason as Error).message })
    } finally {
      setMoving(false)
    }
  }

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreating(true)
    try {
      const created = await api<User>("/api/admin/v1/users", {
        method: "POST",
        body: JSON.stringify({ ...newUser, group_ids: newMemberGroupIDs }),
      })
      setUsers((current) => [created, ...current])
      void reloadGroups()
      setNewUser({ name: "", email: "", role: "user", password: "" })
      setNewMemberGroupIDs([])
      showToast({
        status: "success",
        title: t("pages.membersAndGroups.bulk.singleSuccess"),
      })
      setCreateOpen(false)
    } catch (reason) {
      showToast({ status: "error", title: (reason as Error).message })
    } finally {
      setCreating(false)
    }
  }

  const nameCollator = useMemo(
    () =>
      new Intl.Collator(i18n.resolvedLanguage ?? i18n.language, {
        sensitivity: "base",
        numeric: true,
      }),
    [i18n.language, i18n.resolvedLanguage]
  )
  const groupsByMember = useMemo(
    () => directGroupsByMember(groups, nameCollator),
    [groups, nameCollator]
  )
  const dateFormatter = new Intl.DateTimeFormat(
    i18n.resolvedLanguage ?? i18n.language,
    { dateStyle: "medium" }
  )
  const moveNames = pendingMove
    ? pendingMove.payload.kind === "group"
      ? pendingMove.payload.ids.map(
          (id) => groups.find((group) => group.id === id)?.name ?? id
        )
      : pendingMove.payload.members.map(
          (member) =>
            users.find((user) => user.id === member.id)?.name ?? member.id
        )
    : []
  return (
    <section className="flex flex-1 flex-col p-4 pt-px md:h-[calc(100svh-5rem)] md:min-h-0 md:flex-none md:overflow-hidden">
      {pendingMove && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm"
        >
          <span className="me-auto" title={moveNames.join(", ")}>
            {t("pages.membersAndGroups.moveAction")} {moveNames.length}:{" "}
            {moveNames.slice(0, 3).join(", ")}
            {moveNames.length > 3 && ` +${moveNames.length - 3}`} →{" "}
            {pendingMove.target.name}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={moving}
            onClick={() =>
              void saveMove(pendingMove.payload, pendingMove.target)
            }
          >
            {t("pages.membersAndGroups.saveChanges")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={moving}
            onClick={() => {
              setPendingMove(null)
              setSelectedMembers([])
            }}
          >
            {t("pages.membersAndGroups.cancelAction")}
          </Button>
        </div>
      )}
      <div className="grid flex-1 gap-4 md:min-h-0 md:grid-cols-[minmax(14rem,1fr)_minmax(0,1.5fr)]">
        <Card className="min-h-64 md:min-h-0">
          <CardHeader>
            <CardTitle>{t("pages.membersAndGroups.groupsTitle")}</CardTitle>
            <CardAction className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-pressed={multiSelect}
                disabled={loading || moving || batchUpdatingStatus}
                onClick={() => {
                  if (multiSelect) {
                    setSelectedMembers([])
                    setPendingMove(null)
                    setDragging(null)
                    setMultiSelect(false)
                  } else {
                    setMultiSelect(true)
                  }
                }}
              >
                {t(
                  `pages.membersAndGroups.treeSelection.${multiSelect ? "exit" : "enter"}`
                )}
              </Button>
              {multiSelect && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={
                          moving ||
                          batchUpdatingStatus ||
                          selectedMembers.length === 0
                        }
                      />
                    }
                  >
                    {t("pages.membersAndGroups.treeSelection.actions")}
                    <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        disabled={moving || batchUpdatingStatus}
                        onClick={() => setPendingBatchStatus("active")}
                      >
                        <HugeiconsIcon icon={PowerIcon} strokeWidth={2} />
                        {t("pages.membersAndGroups.enableMember")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={moving || batchUpdatingStatus}
                        onClick={() => setPendingBatchStatus("disabled")}
                      >
                        <HugeiconsIcon icon={PowerOffIcon} strokeWidth={2} />
                        {t("pages.membersAndGroups.disableMember")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={moving || batchUpdatingStatus}
                        onClick={() => {
                          setPendingMove(null)
                          setMoveSelection([...selectedMembers])
                        }}
                      >
                        <HugeiconsIcon icon={MoveIcon} strokeWidth={2} />
                        {t("pages.membersAndGroups.moveAction")}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </CardAction>
          </CardHeader>
          <CardContent className="min-h-0 flex-1">
            <ScrollArea className="-ms-1 -me-(--card-spacing) min-h-0 min-w-0 flex-1 pe-[calc(var(--card-spacing)-4px)]">
              <ul
                className="flex flex-col gap-1"
                aria-label={t("pages.membersAndGroups.groupsTitle")}
              >
                {groups
                  .filter((group) => group.parent_id === null)
                  .map((group) => (
                    <GroupTreeItem
                      key={group.id}
                      group={group}
                      groups={groups}
                      users={users}
                      nameCollator={nameCollator}
                      savingID={savingID}
                      currentUserID={currentUser?.id}
                      onAction={setActiveGroupAction}
                      onToggleStatus={toggleUserStatus}
                      onToggleRole={toggleUserRole}
                      onResetPassword={setPasswordResetUser}
                      multiSelect={multiSelect}
                      selectionDisabled={moving || batchUpdatingStatus}
                      selectedMemberKeys={selectedMemberKeys}
                      onMemberSelect={selectMember}
                      onGroupDragStart={dragGroup}
                      onMemberDragStart={dragMember}
                      onDragEnd={() => setDragging(null)}
                      canDropOn={(target) =>
                        !!dragging && canMoveTo(groups, dragging, target)
                      }
                      onDropOn={dropOn}
                    />
                  ))}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="min-h-96 md:min-h-0">
          <CardHeader className="gap-3">
            <CardTitle>{t("pages.membersAndGroups.membersTitle")}</CardTitle>
            <CardAction className="flex max-w-full items-center gap-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t(
                  "pages.membersAndGroups.searchMembersPlaceholder"
                )}
                aria-label={t("pages.membersAndGroups.searchMembers")}
                className="h-8 w-40 min-w-0 sm:w-52"
              />
              <Button
                type="button"
                size="sm"
                className="cursor-pointer"
                aria-label={t("pages.membersAndGroups.bulk.addMember")}
                onClick={() => {
                  setCreateMode("single")
                  setNewMemberGroupIDs([])
                  setCreateOpen(true)
                }}
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                <span className="hidden lg:inline">
                  {t("pages.membersAndGroups.bulk.addMember")}
                </span>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="min-h-0 flex-1">
            <ScrollArea className="-me-(--card-spacing) min-h-0 min-w-0 flex-1 pe-(--card-spacing)">
              {loading && (
                <p
                  role="status"
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  {t("common.loading")}
                </p>
              )}
              <ItemGroup className="gap-2">
                {visibleUsers.map((user) => {
                  const isDisabled = user.status === "disabled"
                  const joinedAt = new Date(user.joined_at)

                  return (
                    <Item
                      key={user.id}
                      role="listitem"
                      size="sm"
                      variant="outline"
                      aria-busy={savingID === user.id}
                    >
                      <ItemMedia
                        className="cursor-grab active:cursor-grabbing"
                        draggable
                        onDragStart={(event) =>
                          startDrag(
                            { kind: "member", members: [{ id: user.id }] },
                            event
                          )
                        }
                        onDragEnd={() => setDragging(null)}
                      >
                        <MemberAvatar
                          role={user.role}
                          status={user.status}
                          size="lg"
                        />
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="max-w-full min-w-0">
                          <span className="truncate font-medium">
                            {user.name}
                          </span>
                          {user.role === "admin" && (
                            <Badge
                              variant="outline"
                              className="border-green-500/40 text-green-700 dark:border-green-400/40 dark:text-green-400"
                            >
                              {t(
                                "pages.membersAndGroups.groupNames.administrators"
                              )}
                            </Badge>
                          )}
                          {isDisabled && (
                            <Badge
                              variant="outline"
                              className="border-red-500/40 text-red-700 dark:border-red-400/40 dark:text-red-400"
                            >
                              {t("pages.membersAndGroups.memberDisabled")}
                            </Badge>
                          )}
                        </ItemTitle>
                        <ItemDescription className="line-clamp-1 text-xs">
                          {user.email}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions className="ms-auto shrink-0">
                        <MemberActions
                          user={user}
                          savingID={savingID}
                          currentUserID={currentUser?.id}
                          onToggleStatus={toggleUserStatus}
                          onToggleRole={toggleUserRole}
                          onResetPassword={setPasswordResetUser}
                        />
                      </ItemActions>
                      <ItemSeparator className="my-0" />
                      <ItemFooter className="min-w-0 flex-wrap text-xs text-muted-foreground">
                        <span>
                          {t("pages.membersAndGroups.joinedAt", {
                            date: dateFormatter.format(joinedAt),
                            day: joinedAt.getDate(),
                            month: joinedAt.getMonth() + 1,
                            year: joinedAt.getFullYear(),
                          })}
                        </span>
                        <div className="ms-auto flex min-w-0 flex-wrap justify-end gap-1">
                          {(groupsByMember.get(user.id) ?? []).map((group) => (
                            <Badge
                              key={group.id}
                              variant="outline"
                              className="max-w-full"
                            >
                              <span
                                className="min-w-0 truncate"
                                title={group.name}
                              >
                                {group.name}
                              </span>
                            </Badge>
                          ))}
                        </div>
                      </ItemFooter>
                    </Item>
                  )
                })}
                {!loading && visibleUsers.length === 0 && (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    {t("pages.membersAndGroups.noMembersFound")}
                  </p>
                )}
              </ItemGroup>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {moveSelection && (
        <MoveMembersDialog
          groups={groups}
          members={moveSelection}
          saving={moving}
          onClose={() => setMoveSelection(null)}
          onMove={(target) =>
            saveMove({ kind: "member", members: moveSelection }, target)
          }
        />
      )}

      {passwordResetUser && (
        <ResetMemberPasswordDialog
          key={passwordResetUser.id}
          user={passwordResetUser}
          onClose={() => setPasswordResetUser(null)}
        />
      )}

      {activeGroupAction && (
        <GroupActionDialog
          key={`${activeGroupAction.action}-${activeGroupAction.group.id}`}
          {...activeGroupAction}
          groups={groups}
          users={users}
          onClose={() => setActiveGroupAction(null)}
          onSaved={(updated) => {
            if (updated) {
              setGroups((current) =>
                current.some((group) => group.id === updated.id)
                  ? current.map((group) =>
                      group.id === updated.id ? updated : group
                    )
                  : [...current, updated]
              )
            } else {
              setGroups((current) =>
                current.filter(
                  (group) => group.id !== activeGroupAction.group.id
                )
              )
            }
            void reloadGroups()
            setActiveGroupAction(null)
          }}
        />
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (open || (!creating && !batchSaving)) setCreateOpen(open)
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
          closeLabel={t("common.close")}
          showCloseButton={!creating && !batchSaving}
        >
          <DialogHeader>
            <DialogTitle>
              {t("pages.membersAndGroups.bulk.addMember")}
            </DialogTitle>
          </DialogHeader>
          <Tabs
            value={createMode}
            onValueChange={(value) => {
              if (!creating && !batchSaving)
                setCreateMode(value as "single" | "bulk")
            }}
          >
            <TabsList
              className="w-full"
              aria-label={t("pages.membersAndGroups.bulk.addMember")}
            >
              <TabsTrigger value="single" disabled={creating || batchSaving}>
                {t("pages.membersAndGroups.bulk.addOne")}
              </TabsTrigger>
              <TabsTrigger value="bulk" disabled={creating || batchSaving}>
                {t("pages.membersAndGroups.bulk.addMany")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="single" keepMounted className="pt-3">
              <form className="flex flex-col gap-6" onSubmit={createUser}>
                <FieldGroup className="gap-4">
                  <Field>
                    <FieldLabel htmlFor="new-user-role">
                      {t("pages.membersAndGroups.bulk.role")}
                    </FieldLabel>
                    <Select
                      items={{
                        user: t("pages.membersAndGroups.bulk.member"),
                        admin: t("pages.membersAndGroups.bulk.administrator"),
                      }}
                      value={newUser.role}
                      onValueChange={(value) => {
                        if (value === null) return
                        setNewUser((current) => ({
                          ...current,
                          role: value as User["role"],
                          password: value === "admin" ? current.password : "",
                        }))
                      }}
                    >
                      <SelectTrigger id="new-user-role" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectItem value="user">
                          {t("pages.membersAndGroups.bulk.member")}
                        </SelectItem>
                        <SelectItem value="admin">
                          {t("pages.membersAndGroups.bulk.administrator")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <MemberGroupSelect
                    id="new-user-groups"
                    groups={groups}
                    value={newMemberGroupIDs}
                    onValueChange={setNewMemberGroupIDs}
                    disabled={creating || loading}
                  />
                  <Field>
                    <FieldLabel htmlFor="new-user-name">
                      {t("pages.membersAndGroups.bulk.name")}
                    </FieldLabel>
                    <Input
                      id="new-user-name"
                      value={newUser.name}
                      onChange={(event) =>
                        setNewUser((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="new-user-email">
                      {t("pages.membersAndGroups.bulk.email")}
                    </FieldLabel>
                    <Input
                      id="new-user-email"
                      type="email"
                      value={newUser.email}
                      onChange={(event) =>
                        setNewUser((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      required
                    />
                  </Field>
                  {newUser.role === "admin" && (
                    <Field>
                      <FieldLabel htmlFor="new-user-password">
                        {t("pages.membersAndGroups.bulk.singlePassword")}
                      </FieldLabel>
                      <Input
                        id="new-user-password"
                        type="password"
                        autoComplete="new-password"
                        minLength={12}
                        value={newUser.password}
                        onChange={(event) =>
                          setNewUser((current) => ({
                            ...current,
                            password: event.target.value,
                          }))
                        }
                        required
                      />
                    </Field>
                  )}
                </FieldGroup>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCreateOpen(false)}
                  >
                    {t("pages.membersAndGroups.bulk.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      creating ||
                      !newUser.name.trim() ||
                      !newUser.email.trim() ||
                      (newUser.role === "admin" && newUser.password.length < 12)
                    }
                  >
                    {t(
                      creating
                        ? "pages.membersAndGroups.bulk.creating"
                        : "pages.membersAndGroups.bulk.createOne"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </TabsContent>
            <TabsContent value="bulk" keepMounted className="pt-3">
              {createOpen && (
                <BulkAddMembersForm
                  groups={groups}
                  existingEmails={users.map((user) => user.email)}
                  saving={batchSaving}
                  onSavingChange={setBatchSaving}
                  onCreated={(created) => {
                    setUsers((current) => [...created, ...current])
                    void reloadGroups()
                  }}
                  onClose={() => setCreateOpen(false)}
                />
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingBatchStatus !== null}
        onOpenChange={(open) => {
          if (!open && !batchUpdatingStatus) setPendingBatchStatus(null)
        }}
      >
        <AlertDialogContent>
          <form
            className="flex flex-col gap-6"
            onSubmit={confirmSelectedStatus}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pendingBatchStatus &&
                  t(
                    pendingBatchStatus === "active"
                      ? "pages.membersAndGroups.enableMember"
                      : "pages.membersAndGroups.disableMember"
                  )}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogDescription>
              {pendingBatchStatus &&
                t("pages.membersAndGroups.treeSelection.statusConfirm", {
                  action: t(
                    pendingBatchStatus === "active"
                      ? "pages.membersAndGroups.enableMember"
                      : "pages.membersAndGroups.disableMember"
                  ),
                  count: new Set(selectedMembers.map((member) => member.id))
                    .size,
                })}
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={batchUpdatingStatus}>
                {t("pages.membersAndGroups.cancelAction")}
              </AlertDialogCancel>
              <AlertDialogAction
                type="submit"
                variant={
                  pendingBatchStatus === "disabled" ? "destructive" : "default"
                }
                disabled={batchUpdatingStatus}
              >
                {batchUpdatingStatus
                  ? t("common.saving")
                  : t("pages.membersAndGroups.treeSelection.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingMemberAction !== null}
        onOpenChange={(open) => {
          if (!open && !savingID) {
            setPendingMemberAction(null)
          }
        }}
      >
        <AlertDialogContent>
          <form className="flex flex-col gap-6" onSubmit={confirmMemberAction}>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pendingMemberAction &&
                  t(`pages.membersAndGroups.${pendingMemberAction.action}`)}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogDescription>
              {pendingMemberAction &&
                t("pages.membersAndGroups.confirmMemberAction", {
                  action: t(
                    `pages.membersAndGroups.${pendingMemberAction.action}`
                  ),
                  member: pendingMemberAction.user.name,
                  email: pendingMemberAction.user.email,
                })}
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={Boolean(savingID)}>
                {t("pages.membersAndGroups.cancelAction")}
              </AlertDialogCancel>
              <AlertDialogAction
                type="submit"
                variant={
                  pendingMemberAction?.action === "disableMember" ||
                  pendingMemberAction?.action === "removeAdministrator"
                    ? "destructive"
                    : "default"
                }
                disabled={!pendingMemberAction || Boolean(savingID)}
              >
                {savingID
                  ? t("common.saving")
                  : pendingMemberAction &&
                    t(`pages.membersAndGroups.${pendingMemberAction.action}`)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
