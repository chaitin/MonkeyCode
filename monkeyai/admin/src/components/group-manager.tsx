import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { api } from "@/lib/api"

type Group = { id: string; parent_id: string | null; name: string }
type Groups = {
  groups: Group[]
  memberships: { group_id: string; user_id: string }[]
}
type User = { id: string; name: string; email: string }
const rootID = "00000000-0000-0000-0000-000000000001"
const adminID = "00000000-0000-0000-0000-000000000002"
const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm"

export function GroupManager() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        管理分组
      </Button>
      {open && <GroupEditor onClose={() => setOpen(false)} />}
    </>
  )
}
function GroupEditor({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Groups | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [id, setID] = useState("")
  const [name, setName] = useState("")
  const [parent, setParent] = useState(rootID)
  const [members, setMembers] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const load = useCallback(
    () =>
      Promise.all([
        api<Groups>("/api/admin/v1/groups"),
        api<{ users: User[] }>("/api/admin/v1/users"),
      ]).then(([g, u]) => {
        setData(g)
        setUsers(u.users)
      }),
    []
  )
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message))
  }, [load])
  const select = (value: string) => {
    const g = data?.groups.find((item) => item.id === value)
    setID(value)
    setName(g?.name ?? "")
    setParent(g?.parent_id ?? rootID)
    setMembers(
      data?.memberships
        .filter((m) => m.group_id === value)
        .map((m) => m.user_id) ?? []
    )
    setError("")
    setNotice("")
  }
  const save = async (action: "group" | "members" | "delete") => {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      if (action === "group") {
        const result = await api<{ id: string }>(
          `/api/admin/v1/groups${id ? `/${id}` : ""}`,
          {
            method: id ? "PATCH" : "POST",
            body: JSON.stringify({ name, parent_id: parent }),
          }
        )
        setID(result.id)
      }
      if (action === "members")
        await api(`/api/admin/v1/groups/${id}/members`, {
          method: "PUT",
          body: JSON.stringify({ user_ids: members }),
        })
      if (action === "delete") {
        await api(`/api/admin/v1/groups/${id}`, { method: "DELETE" })
        setID("")
        setName("")
        setMembers([])
      }
      await load()
      setNotice(action === "delete" ? "空分组已删除" : "分组设置已保存")
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const fixed = id === rootID || id === adminID
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>成员分组管理</DialogTitle>
          <DialogDescription>
            管理资源授权分组。成员的计费归属请在费用设置中调整。
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        {!data ? (
          <p>正在读取分组…</p>
        ) : (
          <div className="space-y-5">
            <Field>
              <FieldLabel htmlFor="managed-group">选择分组</FieldLabel>
              <select
                id="managed-group"
                className={selectClass}
                value={id}
                onChange={(e) => select(e.target.value)}
              >
                <option value="">新建分组</option>
                {data.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                void save("group")
              }}
            >
              <Field>
                <FieldLabel htmlFor="group-name">分组名称</FieldLabel>
                <Input
                  id="group-name"
                  value={name}
                  required
                  maxLength={100}
                  disabled={fixed}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="group-parent">父分组</FieldLabel>
                <select
                  id="group-parent"
                  className={selectClass}
                  value={parent}
                  disabled={fixed}
                  onChange={(e) => setParent(e.target.value)}
                >
                  {data.groups
                    .filter((g) => g.id !== id)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Button type="submit" disabled={busy || fixed || !name.trim()}>
                {id ? "保存名称与位置" : "创建分组"}
              </Button>
            </form>
            {id && !fixed && (
              <div className="space-y-3 border-t pt-4">
                <p className="text-sm font-medium">授权成员</p>
                <fieldset className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3">
                  <legend className="sr-only">分组授权成员</legend>
                  {users.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={members.includes(u.id)}
                        onChange={(e) =>
                          setMembers(
                            e.target.checked
                              ? [...members, u.id]
                              : members.filter((v) => v !== u.id)
                          )
                        }
                      />
                      {u.name}
                      <span className="text-xs text-muted-foreground">
                        {u.email}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="flex justify-between gap-3">
                  <Button disabled={busy} onClick={() => void save("members")}>
                    保存授权成员
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      busy ||
                      members.length > 0 ||
                      data.groups.some((g) => g.parent_id === id)
                    }
                    onClick={() => void save("delete")}
                  >
                    删除空分组
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  仍有计费归属用户或资源授权的分组不能删除，请先迁移相关引用。
                </p>
              </div>
            )}
            {fixed && (
              <p className="text-sm text-muted-foreground">
                系统分组按用户身份自动维护。
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
