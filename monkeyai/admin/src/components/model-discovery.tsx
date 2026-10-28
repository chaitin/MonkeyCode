import { useEffect, useState, type RefObject } from "react"
import {
  LeftToRightListDashIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { api } from "@/lib/api"

type DiscoveryQuery = {
  base_url: string
  protocol: string
  api_key: string
  proxy_id: string
  model_resource_id?: string
}

export function ModelDiscovery({
  anchor,
  protocol,
  modelResourceId,
  onSelect,
}: {
  anchor: RefObject<HTMLDivElement | null>
  protocol: string
  modelResourceId?: string
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState<DiscoveryQuery | null>(null)
  const [models, setModels] = useState<Array<{ id: string }> | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    api<{ models: Array<{ id: string }> }>("/api/admin/v1/models/discover", {
      method: "POST",
      body: JSON.stringify(query),
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setModels(result.models)
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setError(reason.message)
      })
    return () => controller.abort()
  }, [query])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    setQuery(null)
    if (!next) return
    setModels(null)
    setError("")
    const form = anchor.current?.closest("form")
    if (!form) return
    const data = new FormData(form)
    const baseUrl = String(data.get("baseUrl") ?? "").trim()
    const apiKey = String(data.get("apiKey") ?? "").trim()
    if (!baseUrl || (!apiKey && !modelResourceId)) {
      setError(t("pages.models.discoveryCredentialsRequired"))
      return
    }
    const proxyId = String(data.get("proxyId") ?? "")
    setQuery({
      base_url: baseUrl,
      protocol,
      api_key: apiKey,
      proxy_id: proxyId === "__direct__" ? "" : proxyId,
      model_resource_id: modelResourceId,
    })
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            id="model-discovery-trigger"
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 top-1 size-7 rtl:left-1 rtl:right-auto"
            aria-label={t("pages.models.discoverModels")}
            title={t("pages.models.discoverModels")}
          />
        }
      >
        <HugeiconsIcon icon={LeftToRightListDashIcon} className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        anchor={anchor}
        align="start"
        aria-label={t("pages.models.discoverModels")}
        style={{ maxHeight: "min(16rem, var(--available-height))" }}
      >
        {error ? (
          <div role="alert" className="px-2 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : models === null ? (
          <div
            role="status"
            aria-label={t("resources.tableLoading")}
            className="flex h-9 items-center justify-center"
          >
            <HugeiconsIcon
              icon={Loading03Icon}
              className="size-4 animate-spin"
            />
          </div>
        ) : models.length === 0 ? (
          <div className="px-2 py-2 text-sm text-muted-foreground">
            {t("pages.models.noDiscoveredModels")}
          </div>
        ) : (
          models.map((model) => (
            <DropdownMenuItem key={model.id} onClick={() => onSelect(model.id)}>
              <span className="truncate" title={model.id}>
                {model.id}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
