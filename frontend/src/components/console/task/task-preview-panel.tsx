import type { DomainVMPort } from "@/api/Api"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Item, ItemContent, ItemTitle, ItemGroup, ItemActions, ItemDescription } from "@/components/ui/item"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { IconAccessPoint, IconAlertCircle, IconCloudOff, IconReload, IconX } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

interface TaskPreviewPanelProps {
  ports: DomainVMPort[] | undefined
  onRefresh?: () => void
  disabled?: boolean
  onClosePanel?: () => void
  embedded?: boolean
}

export function TaskPreviewPanel({
  ports,
  onRefresh,
  disabled,
  onClosePanel,
  embedded = false,
}: TaskPreviewPanelProps) {
  const { t } = useTranslation()

  if (disabled) {
    return (
      <div className={embedded ? "flex flex-col h-full min-h-0" : "flex flex-col h-full min-h-0 rounded-lg border overflow-hidden"}>
        {!embedded && (
          <div className="flex items-center justify-between gap-2 pl-4 pr-2 py-2 min-h-12 border-b bg-muted/50 shrink-0">
            <span className="text-sm font-medium">{t("taskDetail.preview.title")}</span>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:text-primary" onClick={() => onRefresh?.()} disabled={!onRefresh || !!disabled}>
                <IconReload className="size-4" />
              </Button>
              {onClosePanel && (
                <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:text-primary" onClick={onClosePanel}>
                  <IconX className="size-4" />
                </Button>
              )}
            </div>
          </div>
        )}
        <div className={embedded ? "flex-1 min-h-0 flex flex-col" : "flex-1 min-h-0 flex flex-col p-2"}>
          <Empty className="w-full flex-1 min-h-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconCloudOff className="size-6" />
              </EmptyMedia>
              <EmptyDescription>
                {t("taskDetail.preview.envNotReady")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={embedded ? "flex flex-col h-full min-h-0" : "flex flex-col h-full min-h-0 rounded-lg border overflow-hidden"}>
        {!embedded && (
          <div className="flex items-center justify-between gap-2 pl-4 pr-2 py-1 min-h-11 border-b bg-muted/30 shrink-0">
            <span className="text-sm font-medium">{t("taskDetail.preview.title")}</span>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:text-primary" onClick={() => onRefresh?.()} disabled={!onRefresh}>
                <IconReload className="size-4" />
              </Button>
              {onClosePanel && (
                <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:text-primary" onClick={onClosePanel}>
                  <IconX className="size-4" />
                </Button>
              )}
            </div>
          </div>
        )}
        <div className={embedded ? "flex-1 min-h-0 overflow-auto flex flex-col" : "flex-1 min-h-0 overflow-auto flex flex-col p-2"}>
        {(ports && ports.length > 0) ? (
        <ItemGroup className="gap-2">
          {ports.map((port: DomainVMPort) => {
            const canAccess = Boolean(port.preview_url)
            return (
            <Item
              variant="outline"
              size="sm"
              key={port.port?.toString()}
              className="group hover:border-primary/50"
            >
              <ItemContent>
                <ItemTitle>
                  <span>
                    {port.port}
                  </span>
                  {port.error_message && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <IconAlertCircle className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent>{port.error_message}</TooltipContent>
                    </Tooltip>
                  )}
                </ItemTitle>
                {!canAccess && (
                  <ItemDescription>
                    {port.error_message || t("taskDetail.preview.unavailable")}
                  </ItemDescription>
                )}
              </ItemContent>
              {canAccess && port.preview_url && (
                <ItemActions>
                  <Button size="sm" variant="default" onClick={() => window.open(port.preview_url, "_blank")}>
                    {t("taskDetail.preview.open")}
                  </Button>
                </ItemActions>
              )}
            </Item>
          )})}
        </ItemGroup>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <Empty className="w-full flex-1 min-h-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconAccessPoint className="size-6" />
                </EmptyMedia>
                <EmptyDescription>
                  {t("taskDetail.preview.empty")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
        </div>
      </div>
    </>
  )
}
