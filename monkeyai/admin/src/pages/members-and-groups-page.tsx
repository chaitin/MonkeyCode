import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Add01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
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
  DialogDescription,
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
import { BulkAddMembersForm } from "@/components/members/bulk-add-members-form"
import { GroupActionDialog } from "@/components/members/group-action-dialog"
import { MemberAvatar } from "@/components/members/member-avatar"
import { GroupTreeItem } from "@/components/members/group-tree"
import { ResetMemberPasswordDialog } from "@/components/members/reset-member-password-dialog"
import {
  MemberActions,
  type MemberActionUser,
} from "@/components/members/member-actions"
import {
  type ActiveGroupAction,
  ROOT_GROUP_ID,
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
  const [teamName, setTeamName] = useState("Monkey AI")
  const [groups, setGroups] = useState<MemberGroup[]>([])
  const [activeGroupAction, setActiveGroupAction] =
    useState<ActiveGroupAction | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const [savingID, setSavingID] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [createMode, setCreateMode] = useState<"single" | "bulk">("single")
  const [creating, setCreating] = useState(false)
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
      api<{
        settings: Array<{ key: string; value: { workspace_name?: string } }>
      }>("/api/admin/v1/settings"),
    ])
      .then(([members, result, { settings }]) => {
        setUsers(members.users)
        setGroups(result.groups)
        setTeamName(
          settings.find((item) => item.key === "branding")?.value
            .workspace_name || "Monkey AI"
        )
      })
      .catch((reason: Error) => {
        setError(reason.message)
        showToast({ status: "error", title: reason.message })
      })
      .finally(() => setLoading(false))
  }, [showToast])

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

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreating(true)
    setError("")
    try {
      const created = await api<User>("/api/admin/v1/users", {
        method: "POST",
        body: JSON.stringify(newUser),
      })
      setUsers((current) => [created, ...current])
      setNewUser({ name: "", email: "", role: "user", password: "" })
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
  const root: MemberGroup = {
    id: ROOT_GROUP_ID,
    parent_id: null,
    name: teamName,
    member_ids: [],
  }
  const displayGroups = [
    root,
    ...groups.map((group) => ({
      ...group,
      parent_id: group.parent_id ?? ROOT_GROUP_ID,
    })),
  ]

  return (
    <section className="flex flex-1 flex-col p-4 pt-px md:h-[calc(100svh-5rem)] md:min-h-0 md:flex-none md:overflow-hidden">
      {error && (
        <p
          className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="grid flex-1 gap-4 md:min-h-0 md:grid-cols-[minmax(14rem,1fr)_minmax(0,1.5fr)]">
        <Card className="min-h-64 md:min-h-0">
          <CardHeader>
            <CardTitle>{t("pages.membersAndGroups.groupsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1">
            <ScrollArea className="-ms-1 -me-(--card-spacing) min-h-0 min-w-0 flex-1 pe-[calc(var(--card-spacing)-4px)]">
              <ul
                className="flex flex-col gap-1"
                aria-label={t("pages.membersAndGroups.groupsTitle")}
              >
                {displayGroups
                  .filter((group) => group.parent_id === null)
                  .map((group) => (
                    <GroupTreeItem
                      key={group.id}
                      group={group}
                      groups={displayGroups}
                      users={users}
                      nameCollator={nameCollator}
                      savingID={savingID}
                      currentUserID={currentUser?.id}
                      onAction={setActiveGroupAction}
                      onToggleStatus={toggleUserStatus}
                      onToggleRole={toggleUserRole}
                      onResetPassword={setPasswordResetUser}
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
                      <ItemMedia>
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
                          {!groupsByMember.has(user.id) && (
                            <Badge variant="outline">
                              {t("pages.membersAndGroups.ungroupedMembers")}
                            </Badge>
                          )}
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
          groups={displayGroups}
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
            setError("")
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
            {createMode === "bulk" && (
              <DialogDescription>
                {t("pages.membersAndGroups.bulk.description")}
              </DialogDescription>
            )}
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
                <FieldGroup>
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
                  existingEmails={users.map((user) => user.email)}
                  saving={batchSaving}
                  onSavingChange={setBatchSaving}
                  onCreated={(created) =>
                    setUsers((current) => [...created, ...current])
                  }
                  onClose={() => setCreateOpen(false)}
                />
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

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
