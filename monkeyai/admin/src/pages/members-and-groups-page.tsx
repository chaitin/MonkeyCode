import { useEffect, useState, type FormEvent } from "react"
import { Add01Icon, UserMultiple02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { useAuth } from "@/hooks/use-auth"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"

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
  const { t } = useTranslation()
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<User[]>([])
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
    api<{ users: User[] }>("/api/admin/v1/users")
      .then((result) => setUsers(result.users))
      .catch((reason: Error) => setError(reason.message))
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

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleUsers = users.filter(
    (user) =>
      !normalizedQuery ||
      user.name.toLocaleLowerCase().includes(normalizedQuery) ||
      user.email.toLocaleLowerCase().includes(normalizedQuery)
  )

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

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pt-0 md:p-6 md:pt-0">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("pages.membersAndGroups.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("pages.membersAndGroups.description")}
        </p>
      </div>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HugeiconsIcon icon={UserMultiple02Icon} strokeWidth={2} />
              {t("pages.membersAndGroups.membersTitle")}
            </CardTitle>
            <CardDescription className="mt-1">
              {t("pages.membersAndGroups.membersDescription")}
            </CardDescription>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("pages.membersAndGroups.searchMembersPlaceholder")}
              aria-label={t("pages.membersAndGroups.searchMembers")}
              className="min-w-0 flex-1 sm:w-64"
            />
            <Button
              type="button"
              className="cursor-pointer"
              onClick={() => setCreateOpen(true)}
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              添加成员
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <p
              className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>成员</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近登录</TableHead>
                <TableHead className="text-end">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={user.avatar_url} alt={user.name} />
                        <AvatarFallback>{user.name.slice(0, 2)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{user.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {user.role === "admin" ? "管理员" : "成员"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        user.status === "active" ? "secondary" : "outline"
                      }
                    >
                      {user.status === "active" ? "已启用" : "已停用"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.last_login_at
                      ? new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(user.last_login_at))
                      : "—"}
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="cursor-pointer"
                        disabled={
                          savingID === user.id || user.id === currentUser?.id
                        }
                        onClick={() => {
                          if (user.role === "admin") {
                            void updateUser(user, { role: "user" })
                            return
                          }
                          setRolePassword("")
                          setRoleTarget(user)
                        }}
                      >
                        {user.role === "admin" ? "取消管理员" : "设为管理员"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="cursor-pointer"
                        disabled={
                          savingID === user.id || user.id === currentUser?.id
                        }
                        onClick={() =>
                          void updateUser(user, {
                            status:
                              user.status === "active" ? "disabled" : "active",
                          })
                        }
                      >
                        {user.status === "active"
                          ? t("pages.membersAndGroups.disableMember")
                          : t("pages.membersAndGroups.enableMember")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {visibleUsers.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-muted-foreground"
                  >
                    {t("pages.membersAndGroups.noMembersFound")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
    </main>
  )
}
