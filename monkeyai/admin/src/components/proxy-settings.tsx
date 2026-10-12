import { useEffect, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/lib/api"

export type SystemProxy = { id: string; name: string; url: string; username?: string; password?: string }
type Setting = { value: { proxies: SystemProxy[] } }

export async function loadProxies(): Promise<SystemProxy[]> {
  const result = await api<{ settings: (Setting & { key: string })[] }>("/api/admin/v1/settings")
  return result.settings.find((item) => item.key === "proxies")?.value.proxies ?? []
}

export function SystemProxySelect({ id, selected, proxies }: { id: string; selected: string; proxies: SystemProxy[] }) {
  const { t } = useTranslation()
  const options = [{ value: "__direct__", label: t("pages.otherSettings.proxies.direct", { defaultValue: "直连" }) }, ...proxies.map(({ id, name }) => ({ value: id, label: name }))]
  if (selected && !options.some(({ value }) => value === selected)) options.push({ value: selected, label: selected })
  return <Select key={selected} name="proxyId" defaultValue={selected || "__direct__"} items={options}>
    <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
    <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value} label={option.label}>{option.label}</SelectItem>)}</SelectContent>
  </Select>
}

export function ProxySettings() {
  const { t } = useTranslation()
  const [proxies, setProxies] = useState<SystemProxy[]>([])
  const [editing, setEditing] = useState<SystemProxy | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => { loadProxies().then(setProxies).catch((reason: Error) => setError(reason.message)) }, [])
  const persist = async (items: SystemProxy[]) => {
    setSaving(true)
    setError("")
    try {
      const saved = await api<Setting>("/api/admin/v1/settings/proxies", {
        method: "PUT", body: JSON.stringify({ schema_version: 1, value: { proxies: items } }),
      })
      setProxies(saved.value.proxies)
      setEditing(null)
    } catch (reason) { setError((reason as Error).message) }
    finally { setSaving(false) }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const item: SystemProxy = {
      id: editing?.id ?? "", name: String(data.get("name") ?? "").trim(),
      url: String(data.get("url") ?? "").trim(),
      username: String(data.get("username") ?? "").trim(),
      password: String(data.get("password") ?? ""),
    }
    void persist(editing ? proxies.map((proxy) => proxy.id === editing.id ? item : proxy) : [...proxies, item])
  }
  return <Card className="order-5">
    <CardHeader>
      <CardTitle>{t("pages.otherSettings.proxies.title", { defaultValue: "系统代理" })}</CardTitle>
      <CardDescription>{t("pages.otherSettings.proxies.description", { defaultValue: "配置可供模型和连接器选择的出站代理。删除使用中的代理会被拒绝。" })}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {proxies.map((item) => <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
        <span className="min-w-0 truncate">{item.name} · {item.url}</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(item)}>{t("common.edit", { defaultValue: "编辑" })}</Button>
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => { if (window.confirm(t("pages.otherSettings.proxies.confirmDelete", { defaultValue: "确认删除该代理？" }))) void persist(proxies.filter((proxy) => proxy.id !== item.id)) }}>{t("common.delete", { defaultValue: "删除" })}</Button>
        </div>
      </div>)}
      {editing ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit} key={editing.id}>
        <Input name="name" aria-label={t("pages.otherSettings.proxies.name", { defaultValue: "名称" })} placeholder={t("pages.otherSettings.proxies.name", { defaultValue: "名称" })} defaultValue={editing.name} required />
        <Input name="url" aria-label="Proxy URL" placeholder="http://host:port, https://host:port, socks5://host:port" defaultValue={editing.url} required />
        <Input name="username" aria-label={t("pages.otherSettings.proxies.username", { defaultValue: "用户名" })} placeholder={t("pages.otherSettings.proxies.username", { defaultValue: "用户名（可选）" })} defaultValue={editing.username} autoComplete="off" />
        <Input name="password" aria-label={t("pages.otherSettings.proxies.password", { defaultValue: "密码" })} placeholder={t("pages.otherSettings.proxies.password", { defaultValue: "密码（留空保持不变）" })} type="password" autoComplete="new-password" />
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={saving}>{t("common.save", { defaultValue: "保存" })}</Button>
          <Button type="button" variant="outline" onClick={() => setEditing(null)}>{t("common.cancel", { defaultValue: "取消" })}</Button>
        </div>
      </form> : <Button type="button" variant="outline" onClick={() => setEditing({ id: "", name: "", url: "" })}>{t("pages.otherSettings.proxies.add", { defaultValue: "添加代理" })}</Button>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </CardContent>
  </Card>
}
