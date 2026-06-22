import { useEffect, useState } from "react"
import { pinyin } from "pinyin-pro"
import { toast } from "sonner"

import type {
  DomainCreateUserMCPUpstreamReq,
  DomainMCPHeader,
  DomainMCPUpstream,
} from "@/api/Api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useTranslation } from "react-i18next"

interface AddMcpServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: DomainCreateUserMCPUpstreamReq) => Promise<boolean>
  saving?: boolean
  server?: DomainMCPUpstream | null
}

function generateMcpSlug(name: string) {
  return pinyin(name, {
    toneType: "none",
    nonZh: "consecutive",
    type: "string",
  })
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]+/g, "")
}

export default function AddMcpServerDialog({
  open,
  onOpenChange,
  onSubmit,
  saving = false,
  server = null,
}: AddMcpServerDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [headersJson, setHeadersJson] = useState("")
  const isEditMode = Boolean(server?.id)

  useEffect(() => {
    if (!open) {
      setName("")
      setUrl("")
      setHeadersJson("")
      return
    }

    if (server) {
      setName(server.name || "")
      setUrl(server.url || "")
      const headers = server.headers || []
      const headersObject = Object.fromEntries(
        headers
          .filter((item) => item.name)
          .map((item) => [item.name as string, item.value || ""])
      )
      setHeadersJson(
        Object.keys(headersObject).length > 0
          ? JSON.stringify(headersObject, null, 2)
          : ""
      )
    } else {
      setName("")
      setUrl("")
      setHeadersJson("")
    }
  }, [open, server])

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t("consoleSettings.mcp.toast.nameRequired"))
      return
    }

    if (!url.trim()) {
      toast.error(t("consoleSettings.mcp.toast.urlRequired"))
      return
    }

    const slug = generateMcpSlug(name.trim())
    if (!slug) {
      toast.error(t("consoleSettings.mcp.toast.invalidSlug"))
      return
    }

    let parsedHeaders: DomainMCPHeader[] | undefined

    if (headersJson.trim()) {
      try {
        const parsed = JSON.parse(headersJson)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          toast.error(t("consoleSettings.mcp.toast.headerObjectRequired"))
          return
        }

        parsedHeaders = Object.entries(parsed).map(([key, value]) => ({
          name: key,
          value: String(value ?? ""),
        }))
      } catch {
        toast.error(t("consoleSettings.mcp.toast.headerJsonInvalid"))
        return
      }
    }

    const success = await onSubmit({
      name: name.trim(),
      slug,
      url: url.trim(),
      headers: parsedHeaders,
      enabled: true,
    })

    if (success) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditMode ? t("consoleSettings.mcp.dialog.editTitle") : t("consoleSettings.mcp.dialog.addTitle")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <Field>
            <FieldLabel>{t("consoleSettings.mcp.labels.name")}</FieldLabel>
            <FieldContent>
              <Input
                placeholder={t("consoleSettings.mcp.placeholders.name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>{t("consoleSettings.mcp.labels.url")}</FieldLabel>
            <FieldContent>
              <Input
                placeholder={t("consoleSettings.mcp.placeholders.url")}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>HTTP Header</FieldLabel>
            <FieldContent className="gap-2">
              <Textarea
                className="min-h-28 break-all font-mono"
                placeholder={`{\n  "Authorization": "Bearer <token>",\n  "X-API-Key": "<your-api-key>"\n}`}
                value={headersJson}
                onChange={(e) => setHeadersJson(e.target.value)}
              />
            </FieldContent>
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("consoleSettings.mcp.actions.cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            {isEditMode ? t("consoleSettings.mcp.actions.save") : t("consoleSettings.mcp.actions.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
