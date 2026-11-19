import { useEffect, useState, type FormEvent } from "react"
import { Trans, useTranslation } from "react-i18next"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons"

import { useAppToast } from "@/components/animated-toast-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"

type Setting = { key: string; value: { blocked_cidrs: string[] } }

export function MCPNetworkSettings() {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const [rows, setRows] = useState<{ id: number; cidr: string }[]>([])
  const [savedCIDRs, setSavedCIDRs] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const cidrs = rows.map((row) => row.cidr)
  const dirty = JSON.stringify(cidrs) !== JSON.stringify(savedCIDRs)

  useEffect(() => {
    let cancelled = false
    void api<{ settings: Setting[] }>("/api/admin/v1/settings")
      .then(({ settings }) => {
        if (cancelled) return
        const items =
          settings.find((setting) => setting.key === "mcp")?.value
            .blocked_cidrs ?? []
        setSavedCIDRs(items)
        setLoaded(true)
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleOpenChange = (nextOpen: boolean) => {
    if (saving) return
    if (nextOpen) {
      setRows(savedCIDRs.map((cidr, id) => ({ id, cidr })))
      setError("")
    }
    setOpen(nextOpen)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!loaded || saving) return
    setSaving(true)
    setError("")
    try {
      const saved = await api<Setting>("/api/admin/v1/settings/mcp", {
        method: "PUT",
        body: JSON.stringify({
          schema_version: 1,
          value: { blocked_cidrs: cidrs.map((cidr) => cidr.trim()) },
        }),
      })
      setOpen(false)
      setSavedCIDRs(saved.value.blocked_cidrs ?? [])
      showToast({
        status: "success",
        title: t("pages.otherSettings.mcpNetwork.saved"),
      })
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="order-5">
      <CardHeader>
        <CardTitle>{t("pages.otherSettings.mcpNetwork.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <Item variant="outline">
            <ItemContent className="min-w-0">
              <ItemTitle>
                {t("pages.otherSettings.mcpNetwork.blocklist")}
              </ItemTitle>
              {loaded && (
                <ItemDescription className="line-clamp-none break-words">
                  {savedCIDRs.length ? (
                    <Trans
                      i18nKey="pages.otherSettings.mcpNetwork.description"
                      values={{ cidrs: savedCIDRs.join(", ") }}
                      components={{ ranges: <bdi dir="ltr" /> }}
                    />
                  ) : (
                    t("pages.otherSettings.mcpNetwork.empty")
                  )}
                </ItemDescription>
              )}
            </ItemContent>
            <ItemActions>
              <DialogTrigger
                disabled={!loaded}
                render={<Button variant="secondary" />}
              >
                {t("pages.otherSettings.mcpNetwork.configure")}
              </DialogTrigger>
            </ItemActions>
          </Item>
          <DialogContent
            className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-lg"
            closeLabel={t("common.close")}
            showCloseButton={!saving}
          >
            <DialogHeader>
              <DialogTitle>
                {t("pages.otherSettings.mcpNetwork.blocklist")}
              </DialogTitle>
              <DialogDescription>
                {t("pages.otherSettings.mcpNetwork.hint")}
              </DialogDescription>
            </DialogHeader>
            <form className="flex min-h-0 flex-col gap-4" onSubmit={submit}>
              <fieldset
                disabled={saving}
                className="flex min-h-0 flex-col gap-4"
              >
                <ScrollArea className="-me-6 min-h-0 flex-1">
                  <div className="space-y-3 pe-6">
                    <div className="overflow-hidden rounded-lg border">
                      <div className="border-b bg-muted/40 px-4 py-3 text-sm font-medium">
                        {t("pages.otherSettings.mcpNetwork.label")}
                      </div>
                      {rows.length === 0 ? (
                        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                          {t("pages.otherSettings.mcpNetwork.empty")}
                        </p>
                      ) : (
                        <ul className="divide-y">
                          {rows.map((row, index) => {
                            const label = t(
                              "pages.otherSettings.mcpNetwork.entry",
                              { index: index + 1 }
                            )
                            return (
                              <li
                                key={row.id}
                                className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-3 px-4 py-3"
                              >
                                <Input
                                  aria-label={label}
                                  dir="ltr"
                                  value={row.cidr}
                                  placeholder="10.0.0.0/8"
                                  required
                                  onChange={(event) => {
                                    const cidr = event.target.value
                                    setRows((items) =>
                                      items.map((item) =>
                                        item.id === row.id
                                          ? { ...item, cidr }
                                          : item
                                      )
                                    )
                                    setError("")
                                  }}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  aria-label={
                                    t("pages.otherSettings.mcpNetwork.remove") +
                                    " · " +
                                    label
                                  }
                                  onClick={() => {
                                    setRows((items) =>
                                      items.filter((item) => item.id !== row.id)
                                    )
                                    setError("")
                                  }}
                                >
                                  <HugeiconsIcon
                                    icon={Delete02Icon}
                                    strokeWidth={2}
                                    aria-hidden="true"
                                  />
                                </Button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                    {error && (
                      <p role="alert" className="text-sm text-destructive">
                        {error}
                      </p>
                    )}
                  </div>
                </ScrollArea>
                <DialogFooter className="shrink-0 sm:justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setRows((items) => [
                        ...items,
                        { id: (items.at(-1)?.id ?? -1) + 1, cidr: "" },
                      ])
                      setError("")
                    }}
                  >
                    <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
                    {t("pages.otherSettings.mcpNetwork.add")}
                  </Button>
                  <div className="flex items-center justify-end gap-2">
                    <DialogClose
                      render={<Button type="button" variant="outline" />}
                    >
                      {t("pages.otherSettings.mcpNetwork.cancel")}
                    </DialogClose>
                    <Button
                      type="submit"
                      loading={saving}
                      disabled={
                        !dirty || saving || cidrs.some((cidr) => !cidr.trim())
                      }
                    >
                      {t("pages.otherSettings.mcpNetwork.save")}
                    </Button>
                  </div>
                </DialogFooter>
              </fieldset>
            </form>
          </DialogContent>
        </Dialog>
        {!loaded && error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
