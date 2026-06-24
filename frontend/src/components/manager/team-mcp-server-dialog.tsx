import { useEffect, useMemo, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { pinyin } from "pinyin-pro"
import { toast } from "sonner"

import type {
  GithubComChaitinMonkeyCodeBackendDomainCreateTeamMCPUpstreamReq as DomainCreateTeamMCPUpstreamReq,
  GithubComChaitinMonkeyCodeBackendDomainMCPHeader as DomainMCPHeader,
  DomainTeamGroup,
  GithubComChaitinMonkeyCodeBackendDomainTeamMCPUpstream as DomainTeamMCPUpstream,
  GithubComChaitinMonkeyCodeBackendDomainUpdateTeamMCPUpstreamReq as DomainUpdateTeamMCPUpstreamReq,
} from "@/api/Api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"

type TeamMCPUpstreamPayload =
  | DomainCreateTeamMCPUpstreamReq
  | DomainUpdateTeamMCPUpstreamReq

type Translate = (key: string, options?: Record<string, unknown>) => string

interface TeamMCPServerDialogProps {
  groups: DomainTeamGroup[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: TeamMCPUpstreamPayload) => Promise<boolean>
  saving?: boolean
  server?: DomainTeamMCPUpstream | null
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

function headersToJson(headers?: DomainMCPHeader[]) {
  const headersObject = Object.fromEntries(
    (headers || [])
      .filter((item) => item.name)
      .map((item) => [item.name as string, item.value || ""])
  )

  return Object.keys(headersObject).length > 0
    ? JSON.stringify(headersObject, null, 2)
    : ""
}

function parseHeaders(headersJson: string, t: Translate) {
  if (!headersJson.trim()) {
    return undefined
  }

  const parsed = JSON.parse(headersJson)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("managerMcp.toast.headerMustBeObject"))
  }

  return Object.entries(parsed).map(([key, value]) => ({
    name: key,
    value: String(value ?? ""),
  }))
}

export default function TeamMCPServerDialog({
  groups,
  open,
  onOpenChange,
  onSubmit,
  saving = false,
  server = null,
}: TeamMCPServerDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [description, setDescription] = useState("")
  const [headersJson, setHeadersJson] = useState("")
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const isEditMode = Boolean(server?.id)

  useEffect(() => {
    if (!open) {
      setName("")
      setUrl("")
      setDescription("")
      setHeadersJson("")
      setSelectedGroupIds([])
      return
    }

    setName(server?.name || "")
    setUrl(server?.url || "")
    setDescription(server?.description || "")
    setHeadersJson(headersToJson(server?.headers))
    setSelectedGroupIds((server?.groups || []).map((group) => group.id || "").filter(Boolean))
  }, [open, server])

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t("managerMcp.toast.nameRequired"))
      return
    }

    if (!url.trim()) {
      toast.error(t("managerMcp.toast.urlRequired"))
      return
    }

    const slug = generateMcpSlug(name.trim())
    if (!slug) {
      toast.error(t("managerMcp.toast.invalidSlug"))
      return
    }

    let parsedHeaders: DomainMCPHeader[] | undefined
    try {
      parsedHeaders = parseHeaders(headersJson, t)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("managerMcp.toast.headerJsonInvalid"))
      return
    }

    const success = await onSubmit({
      name: name.trim(),
      slug,
      url: url.trim(),
      description: description.trim() || undefined,
      headers: parsedHeaders,
      group_ids: selectedGroupIds,
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
          <DialogTitle>{isEditMode ? t("managerMcp.dialog.editTitle") : t("managerMcp.dialog.addTitle")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <Field>
            <FieldLabel>{t("managerMcp.fields.name")}</FieldLabel>
            <FieldContent>
              <Input
                placeholder={t("managerMcp.fields.namePlaceholder")}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={saving}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>{t("managerMcp.fields.url")}</FieldLabel>
            <FieldContent>
              <Input
                placeholder={t("managerMcp.fields.urlPlaceholder")}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={saving}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>{t("managerMcp.fields.description")}</FieldLabel>
            <FieldContent>
              <Textarea
                className="min-h-20"
                placeholder={t("managerMcp.fields.descriptionPlaceholder")}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={saving}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>{t("managerMcp.fields.groups")}</FieldLabel>
            <FieldContent>
              <GroupMultiSelect
                disabled={saving}
                groups={groups}
                selectedGroupIds={selectedGroupIds}
                onSelectedGroupIdsChange={setSelectedGroupIds}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>HTTP Header</FieldLabel>
            <FieldContent>
              <Textarea
                className="min-h-28 break-all font-mono"
                placeholder={`{\n  "Authorization": "Bearer <token>",\n  "X-API-Key": "<your-api-key>"\n}`}
                value={headersJson}
                onChange={(event) => setHeadersJson(event.target.value)}
                disabled={saving}
              />
            </FieldContent>
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("managerShell.common.cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            {isEditMode ? t("managerMcp.actions.save") : t("managerMcp.actions.addShort")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GroupMultiSelect({
  disabled,
  groups,
  selectedGroupIds,
  onSelectedGroupIdsChange,
}: {
  disabled: boolean
  groups: DomainTeamGroup[]
  selectedGroupIds: string[]
  onSelectedGroupIdsChange: (value: string[]) => void
}) {
  const { t } = useTranslation()
  const selectedGroups = useMemo(
    () => groups.filter((group) => group.id && selectedGroupIds.includes(group.id)),
    [groups, selectedGroupIds]
  )

  const selectedLabel =
    selectedGroups.length === 0
      ? t("managerMcp.groups.defaultSelection")
      : selectedGroups.length === 1
        ? selectedGroups[0]?.name || t("managerMcp.groups.selectedOne")
        : t("managerMcp.groups.selectedMany", { count: selectedGroups.length })

  const toggleGroup = (groupId: string, checked: boolean) => {
    if (checked) {
      onSelectedGroupIdsChange(
        selectedGroupIds.includes(groupId)
          ? selectedGroupIds
          : [...selectedGroupIds, groupId]
      )
      return
    }

    onSelectedGroupIdsChange(selectedGroupIds.filter((id) => id !== groupId))
  }

  return (
    <div className="grid gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="w-full justify-between"
            disabled={disabled}
          >
            <span className="truncate">{selectedLabel}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1">
          <div className="max-h-[300px] overflow-auto">
            {groups.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{t("managerMcp.groups.empty")}</div>
            ) : (
              groups.map((group) => {
                const groupId = group.id || ""
                const checked = selectedGroupIds.includes(groupId)
                return (
                  <div
                    key={groupId}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent",
                      !groupId && "cursor-not-allowed opacity-50"
                    )}
                    onClick={() => {
                      if (groupId) {
                        toggleGroup(groupId, !checked)
                      }
                    }}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(nextChecked) => toggleGroup(groupId, nextChecked === true)}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{group.name}</span>
                    <Check className={cn("size-4 opacity-0", checked && "opacity-100")} />
                  </div>
                )
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

      {selectedGroups.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedGroups.map((group) => (
            <Badge key={group.id} variant="outline">
              {group.name}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
