// TaskPluginSelector mirrors TaskSkillSelector but targets the plugin
// listing endpoint (GET /api/v1/plugins, see agent-resources slim spec §7.4).
//
// Plugins use a flat list (no tag tabs) because the listing surface is much
// smaller than skills and the backend does not group them by tag. Like the
// skill picker, plugins flagged `is_force_delivery=true` render as
// checked-and-disabled chips with a force-delivery badge; the backend re-injects
// these IDs so the form does not submit them.

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { PluginListItem } from "@/lib/agent-resources-api"
import { cn } from "@/lib/utils"
import { IconPlug } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

interface TaskPluginSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Plugin IDs currently selected by the user (excludes force-delivered ones). */
  selectedPlugins: string[]
  plugins: PluginListItem[]
  /** Called with the toggled plugin id and the new checked state. */
  onPluginChange: (pluginId: string, checked: boolean) => void
  triggerClassName?: string
  labelClassName?: string
}

interface PluginRowProps {
  plugin: PluginListItem
  selectedPlugins: string[]
  onPluginChange: (pluginId: string, checked: boolean) => void
}

function PluginRow({ plugin, selectedPlugins, onPluginChange }: PluginRowProps) {
  const { t } = useTranslation()

  if (!plugin.id) {
    return null
  }

  const isForceDelivery = plugin.is_force_delivery
  const isChecked = isForceDelivery || selectedPlugins.includes(plugin.id)

  return (
    <div
      className={cn(
        "flex flex-row items-center gap-2 rounded-md px-2 py-1",
        isForceDelivery
          ? "cursor-not-allowed opacity-80"
          : "cursor-pointer hover:bg-accent"
      )}
      onClick={() => {
        if (isForceDelivery) {
          return
        }
        onPluginChange(plugin.id, !isChecked)
      }}
    >
      <Checkbox checked={isChecked} disabled={isForceDelivery} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="truncate">{plugin.name}</span>
          {isForceDelivery && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="secondary"
                  className="shrink-0 px-1.5 py-0 text-[10px] leading-4"
                >
                  {t("taskWorkflow.plugin.forceDelivery")}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{t("taskWorkflow.plugin.forceDeliveryTooltip")}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {plugin.description && (
          <div className="line-clamp-1 break-all text-xs text-muted-foreground">
            {plugin.description}
          </div>
        )}
      </div>
    </div>
  )
}

export function TaskPluginSelector({
  open,
  onOpenChange,
  selectedPlugins,
  plugins,
  onPluginChange,
  triggerClassName,
  labelClassName,
}: TaskPluginSelectorProps) {
  const { t } = useTranslation()
  // Hide force-delivery plugins entirely — backend injects them server-side
  // regardless of user selection, so showing them in the picker is just noise.
  const visiblePlugins = plugins.filter((p) => !p.is_force_delivery)
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={cn(
            triggerClassName,
            selectedPlugins.length > 0 && "text-primary hover:text-primary"
          )}
        >
          <IconPlug />
          <span className={labelClassName}>
            {selectedPlugins.length > 0
              ? t("taskWorkflow.plugin.selectedCount", { count: selectedPlugins.length })
              : t("taskWorkflow.plugin.label")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[90vw] max-w-xl flex-col overflow-hidden p-2"
        align="start"
      >
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-background p-1">
          {visiblePlugins.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              {t("taskWorkflow.plugin.empty")}
            </div>
          ) : (
            visiblePlugins.map((plugin) => (
              <PluginRow
                key={plugin.id}
                plugin={plugin}
                selectedPlugins={selectedPlugins}
                onPluginChange={onPluginChange}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
