import { useEffect, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"

type Setting = { key: string; value: { blocked_cidrs: string[] } }

export function MCPNetworkSettings() {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const [cidrs, setCIDRs] = useState<string[]>([])
  const [savedCIDRs, setSavedCIDRs] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const dirty = JSON.stringify(cidrs) !== JSON.stringify(savedCIDRs)

  useEffect(() => {
    let cancelled = false
    void api<{ settings: Setting[] }>("/api/admin/v1/settings")
      .then(({ settings }) => {
        if (cancelled) return
        const items =
          settings.find((setting) => setting.key === "mcp")?.value
            .blocked_cidrs ?? []
        setCIDRs(items)
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
      setCIDRs(saved.value.blocked_cidrs)
      setSavedCIDRs(saved.value.blocked_cidrs)
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
        <CardDescription>
          {t("pages.otherSettings.mcpNetwork.description")}
        </CardDescription>
        {dirty && (
          <CardAction className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                setCIDRs(savedCIDRs)
                setError("")
              }}
            >
              {t("pages.otherSettings.mcpNetwork.cancel")}
            </Button>
            <Button
              type="submit"
              form="mcp-network-settings"
              loading={saving}
              disabled={!loaded || saving || cidrs.some((cidr) => !cidr.trim())}
            >
              {t("pages.otherSettings.mcpNetwork.save")}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <form id="mcp-network-settings" className="space-y-4" onSubmit={submit}>
          <Field>
            <FieldLabel>{t("pages.otherSettings.mcpNetwork.label")}</FieldLabel>
            <FieldDescription>
              {t("pages.otherSettings.mcpNetwork.hint")}
            </FieldDescription>
            {cidrs.map((cidr, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label={t("pages.otherSettings.mcpNetwork.entry", {
                    index: index + 1,
                  })}
                  value={cidr}
                  placeholder="10.0.0.0/8"
                  required
                  disabled={!loaded || saving}
                  onChange={(event) =>
                    setCIDRs((items) =>
                      items.map((item, i) =>
                        i === index ? event.target.value : item
                      )
                    )
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() =>
                    setCIDRs((items) => items.filter((_, i) => i !== index))
                  }
                >
                  {t("pages.otherSettings.mcpNetwork.remove")}
                </Button>
              </div>
            ))}
            {loaded && cidrs.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("pages.otherSettings.mcpNetwork.empty")}
              </p>
            )}
          </Field>
          <Button
            type="button"
            variant="outline"
            disabled={!loaded || saving}
            onClick={() => setCIDRs((items) => [...items, ""])}
          >
            {t("pages.otherSettings.mcpNetwork.add")}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
