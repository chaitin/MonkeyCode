import { useEffect, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/lib/api"
import { loadProxies, type SystemProxy } from "@/lib/proxy-settings"

type Setting = { value: { proxies: SystemProxy[] } }

export function SystemProxySelect({
  id,
  selected,
  proxies,
}: {
  id: string
  selected: string
  proxies: SystemProxy[]
}) {
  const { t } = useTranslation()
  const options = [
    {
      value: "__direct__",
      label: t("pages.otherSettings.proxies.direct", { defaultValue: "直连" }),
    },
    ...proxies.map(({ id, name }) => ({ value: id, label: name })),
  ]
  if (selected && !options.some(({ value }) => value === selected))
    options.push({ value: selected, label: selected })
  return (
    <Select
      key={selected}
      name="proxyId"
      defaultValue={selected || "__direct__"}
      items={options}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            label={option.label}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ProxySettings() {
  const { t } = useTranslation()
  const [proxies, setProxies] = useState<SystemProxy[]>([])
  const [editing, setEditing] = useState<SystemProxy | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    void loadProxies()
      .then((items) => {
        setProxies(items)
        setLoaded(true)
      })
      .catch((reason: Error) => setError(reason.message))
  }, [])

  const persist = async (items: SystemProxy[]) => {
    setSaving(true)
    setError("")
    try {
      const saved = await api<Setting>("/api/admin/v1/settings/proxies", {
        method: "PUT",
        body: JSON.stringify({ schema_version: 1, value: { proxies: items } }),
      })
      setProxies(saved.value.proxies)
      setEditing(null)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    const data = new FormData(event.currentTarget)
    const item: SystemProxy = {
      id: editing.id,
      name: String(data.get("name") ?? "").trim(),
      url: String(data.get("url") ?? "").trim(),
      username: String(data.get("username") ?? "").trim(),
      password: String(data.get("password") ?? ""),
    }
    const items = editing.id
      ? proxies.map((proxy) => (proxy.id === item.id ? item : proxy))
      : [...proxies, item]
    void persist(items)
  }

  return (
    <Card className="order-5">
      <CardHeader>
        <CardTitle>{t("pages.otherSettings.proxies.title")}</CardTitle>
        <CardDescription>
          {t("pages.otherSettings.proxies.description")}
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            disabled={!loaded || saving}
            onClick={() => {
              setEditing({ id: "", name: "", url: "" })
              setError("")
            }}
          >
            {t("pages.otherSettings.proxies.add")}
          </Button>
          <Dialog
            open={editing !== null}
            onOpenChange={(open) => {
              if (!open && !saving) setEditing(null)
            }}
          >
            <DialogContent closeLabel={t("common.close")}>
              <DialogHeader>
                <DialogTitle>
                  {editing?.id
                    ? t("pages.otherSettings.proxies.edit")
                    : t("pages.otherSettings.proxies.add")}
                </DialogTitle>
              </DialogHeader>
              {editing && (
                <form
                  key={editing.id || "new"}
                  className="flex flex-col gap-4"
                  onSubmit={submit}
                >
                  <Field className="gap-2">
                    <FieldLabel htmlFor="system-proxy-name">
                      {t("pages.otherSettings.proxies.name")}
                    </FieldLabel>
                    <Input
                      id="system-proxy-name"
                      name="name"
                      defaultValue={editing.name}
                      required
                    />
                  </Field>
                  <Field className="gap-2">
                    <FieldLabel htmlFor="system-proxy-url">
                      {t("pages.otherSettings.proxies.url")}
                    </FieldLabel>
                    <Input
                      id="system-proxy-url"
                      name="url"
                      placeholder="http://host:port, https://host:port, socks5://host:port"
                      defaultValue={editing.url}
                      required
                    />
                  </Field>
                  <Field className="gap-2">
                    <FieldLabel htmlFor="system-proxy-username">
                      {t("pages.otherSettings.proxies.username")}
                    </FieldLabel>
                    <Input
                      id="system-proxy-username"
                      name="username"
                      defaultValue={editing.username}
                      autoComplete="off"
                    />
                  </Field>
                  <Field className="gap-2">
                    <FieldLabel htmlFor="system-proxy-password">
                      {t(
                        editing.id
                          ? "pages.otherSettings.proxies.password"
                          : "pages.otherSettings.proxies.newPassword"
                      )}
                    </FieldLabel>
                    <Input
                      id="system-proxy-password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                    />
                  </Field>
                  {error && (
                    <p role="alert" className="text-destructive">
                      {error}
                    </p>
                  )}
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={() => setEditing(null)}
                    >
                      {t("pages.otherSettings.proxies.cancel")}
                    </Button>
                    <Button type="submit" disabled={saving}>
                      {t("pages.otherSettings.proxies.save")}
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {proxies.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-2 rounded-md border p-3"
          >
            <span className="min-w-0 truncate">
              {item.name} · {item.url}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setEditing(item)
                  setError("")
                }}
              >
                {t("pages.otherSettings.proxies.editAction")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => {
                  if (
                    window.confirm(
                      t("pages.otherSettings.proxies.confirmDelete")
                    )
                  )
                    void persist(
                      proxies.filter((proxy) => proxy.id !== item.id)
                    )
                }}
              >
                {t("pages.otherSettings.proxies.delete")}
              </Button>
            </div>
          </div>
        ))}
        {!editing && error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
