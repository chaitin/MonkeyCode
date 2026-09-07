import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Add01Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
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
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { GroupActionDialog } from "@/components/members/group-action-dialog"
import { GroupTreeItem } from "@/components/members/group-tree"
import {
  type ActiveGroupAction,
  ROOT_GROUP_ID,
  groupMemberIDs,
  type MemberGroup,
} from "@/lib/member-groups"

type User = {
  id: string
  name: string
  email: string
  avatar_url?: string
  role: "admin" | "user"
  status: "active" | "disabled"
  joined_at: string
  last_login_at?: string
}

export function MembersAndGroupsPage() {
  const { i18n, t } = useTranslation()
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [selectedGroupID, setSelectedGroupID] = useState(ROOT_GROUP_ID)
  const [teamName, setTeamName] = useState("Monkey AI")
  const [groups, setGroups] = useState<MemberGroup[]>([])
  const [activeGroupAction, setActiveGroupAction] =
    useState<ActiveGroupAction | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const [savingID, setSavingID] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [roleTarget, setRoleTarget] = useState<User | null>(null)
  const [rolePassword, setRolePassword] = useState("")
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    role: "user" as User["role"],
    password: "",
  })

  const load = () => {
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
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const updateUser = async (
    user: User,
    patch: Partial<Pick<User, "name" | "role" | "status">> & {
      password?: string
    }
  ) => {
    setSavingID(user.id)
    setError("")
    try {
      const updated = await api<User>(`/api/admin/v1/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: patch.name ?? user.name,
          role: patch.role ?? user.role,
          status: patch.status ?? user.status,
          password: patch.password,
        }),
      })
      setUsers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      )
      return true
    } catch (reason) {
      setError((reason as Error).message)
      return false
    } finally {
      setSavingID("")
    }
  }

  const visibleUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const memberIDs = groupMemberIDs(groups, users, selectedGroupID)
    return users.filter(
      (user) =>
        memberIDs.has(user.id) &&
        (!normalizedQuery ||
          user.name.toLocaleLowerCase().includes(normalizedQuery) ||
          user.email.toLocaleLowerCase().includes(normalizedQuery))
    )
  }, [groups, query, selectedGroupID, users])

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
      setCreateOpen(false)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const promoteUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!roleTarget || rolePassword.length < 12) return
    if (
      await updateUser(roleTarget, {
        role: "admin",
        password: rolePassword,
      })
    ) {
      setRoleTarget(null)
      setRolePassword("")
    }
  }

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
    <section className="flex flex-1 flex-col p-4 pt-px md:h-[calc(100svh-4rem)] md:min-h-0 md:flex-none md:overflow-hidden">
      <div className="grid flex-1 gap-4 md:min-h-0 md:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]">
        <Card className="min-h-64 md:min-h-0">
          <CardHeader>
            <CardTitle>{t("pages.membersAndGroups.groupsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
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
                    selectedID={selectedGroupID}
                    onSelect={setSelectedGroupID}
                    onAction={setActiveGroupAction}
                  />
                ))}
            </ul>
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
                onClick={() => setCreateOpen(true)}
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                <span className="hidden lg:inline">添加成员</span>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            {error && (
              <p
                className="mb-1 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            )}
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
                const isCurrentUser = user.id === currentUser?.id

                return (
                  <Item
                    key={user.id}
                    role="listitem"
                    size="sm"
                    variant={isDisabled ? "muted" : "outline"}
                    aria-busy={savingID === user.id}
                  >
                    <ItemMedia>
                      <Avatar size="lg">
                        <AvatarImage src={user.avatar_url} alt={user.name} />
                        <AvatarFallback>{user.name.slice(0, 2)}</AvatarFallback>
                      </Avatar>
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="max-w-full min-w-0">
                        <span className="truncate font-medium">
                          {user.name}
                        </span>
                        {isDisabled && (
                          <Badge variant="outline">
                            {t("pages.membersAndGroups.memberDisabled")}
                          </Badge>
                        )}
                      </ItemTitle>
                      <ItemDescription className="line-clamp-1 text-xs">
                        {user.email}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions className="ms-auto shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={savingID === user.id}
                              aria-label={t(
                                "pages.membersAndGroups.memberActions",
                                { member: user.name }
                              )}
                            />
                          }
                        >
                          <HugeiconsIcon
                            icon={MoreHorizontalIcon}
                            strokeWidth={2}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              disabled={isCurrentUser}
                              onClick={() =>
                                void updateUser(user, {
                                  status: isDisabled ? "active" : "disabled",
                                })
                              }
                            >
                              {t(
                                isDisabled
                                  ? "pages.membersAndGroups.enableMember"
                                  : "pages.membersAndGroups.disableMember"
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={isCurrentUser}
                              onClick={() => {
                                if (user.role === "admin") {
                                  void updateUser(user, { role: "user" })
                                  return
                                }
                                setRolePassword("")
                                setRoleTarget(user)
                              }}
                            >
                              {t(
                                user.role === "admin"
                                  ? "pages.membersAndGroups.removeAdministrator"
                                  : "pages.membersAndGroups.makeAdministrator"
                              )}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
                        {user.role === "admin"
                          ? t(
                              "pages.membersAndGroups.groupNames.administrators"
                            )
                          : t("pages.membersAndGroups.membersTitle")}
                      </Badge>
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
          </CardContent>
        </Card>
      </div>

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
              setSelectedGroupID(updated.id)
            } else {
              setGroups((current) =>
                current.filter(
                  (group) => group.id !== activeGroupAction.group.id
                )
              )
              if (selectedGroupID === activeGroupAction.group.id)
                setSelectedGroupID(
                  activeGroupAction.group.parent_id ?? ROOT_GROUP_ID
                )
            }
            setError("")
            setActiveGroupAction(null)
          }}
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form className="flex flex-col gap-6" onSubmit={createUser}>
            <DialogHeader>
              <DialogTitle>添加成员</DialogTitle>
              <DialogDescription>
                普通成员通过 OAuth 绑定该邮箱；管理员使用设置的密码登录后台。
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="new-user-name">姓名</FieldLabel>
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
                <FieldLabel htmlFor="new-user-email">邮箱</FieldLabel>
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
                <FieldLabel htmlFor="new-user-role">角色</FieldLabel>
                <select
                  id="new-user-role"
                  value={newUser.role}
                  onChange={(event) =>
                    setNewUser((current) => ({
                      ...current,
                      role: event.target.value as User["role"],
                      password:
                        event.target.value === "admin" ? current.password : "",
                    }))
                  }
                  className="h-9 cursor-pointer rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="user">成员</option>
                  <option value="admin">管理员</option>
                </select>
              </Field>
              {newUser.role === "admin" && (
                <Field>
                  <FieldLabel htmlFor="new-user-password">初始密码</FieldLabel>
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
                取消
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
                {creating ? "正在创建…" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={roleTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRoleTarget(null)
            setRolePassword("")
          }
        }}
      >
        <DialogContent>
          <form className="flex flex-col gap-6" onSubmit={promoteUser}>
            <DialogHeader>
              <DialogTitle>设为管理员</DialogTitle>
              <DialogDescription>
                为 {roleTarget?.email} 设置管理后台初始密码。
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="promote-user-password">初始密码</FieldLabel>
              <Input
                id="promote-user-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={rolePassword}
                onChange={(event) => setRolePassword(event.target.value)}
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">至少 12 个字符</p>
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRoleTarget(null)}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={
                  !roleTarget ||
                  rolePassword.length < 12 ||
                  savingID === roleTarget.id
                }
              >
                确认
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
