import { useDeferredValue, useMemo, useState } from "react"
import type { DomainProviderModelListItem } from "@/api/Api"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { getModelDisplayName } from "@/utils/common"
import { IconSelector } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"
import {
  filterAndGroupProviderModels,
  getProviderModelCommandValue,
} from "./provider-model-options"

interface ProviderModelComboboxProps {
  value: string
  models: DomainProviderModelListItem[]
  loading: boolean
  disabled: boolean
  onOpen: () => void
  onValueChange: (model: string) => void
}

function ProviderModelCombobox({
  value,
  models,
  loading,
  disabled,
  onOpen,
  onValueChange,
}: ProviderModelComboboxProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const fallbackGroup = t("consoleSettings.models.fallback.other")
  const groupedModels = useMemo(
    () => filterAndGroupProviderModels(models, deferredQuery, fallbackGroup),
    [deferredQuery, fallbackGroup, models],
  )
  const isSearchPending = query !== deferredQuery

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      onOpen()
      return
    }
    setQuery("")
  }

  const handleSelect = (modelId: string) => {
    onValueChange(modelId)
    setOpen(false)
    setQuery("")
  }

  return (
    <Popover modal open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className="w-full justify-between font-normal"
        >
          <span className="truncate text-left">
            {loading
              ? t("consoleSettings.models.loadingShort")
              : value
                ? getModelDisplayName(value)
                : t("consoleSettings.models.placeholders.selectModel")}
          </span>
          {loading ? (
            <Spinner className="ml-2 size-4 shrink-0" />
          ) : (
            <IconSelector className="ml-2 size-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        avoidCollisions={false}
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={t("consoleSettings.models.placeholders.searchModel")}
          />
          <CommandList
            aria-busy={isSearchPending}
            className="overscroll-contain touch-pan-y"
            style={{
              maxHeight:
                "clamp(0px, calc(var(--radix-popover-content-available-height) - 3rem), 280px)",
            }}
          >
            {isSearchPending ? (
              <div
                role="status"
                className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
              >
                <Spinner className="size-4" />
                {t("consoleSettings.models.loadingShort")}
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {t("consoleSettings.models.noSearchResults")}
                </CommandEmpty>
                {groupedModels.map((group) => (
                  <CommandGroup key={group.key} heading={group.key}>
                    {group.models.map((item) => {
                      const modelId = item.model ?? ""
                      return (
                        <CommandItem
                          key={modelId}
                          value={getProviderModelCommandValue(modelId)}
                          data-checked={value === modelId}
                          onSelect={() => handleSelect(modelId)}
                        >
                          <span className="truncate">
                            {getModelDisplayName(modelId)}
                          </span>
                          {value === modelId && (
                            <span className="sr-only">
                              {t("consoleSettings.models.selected")}
                            </span>
                          )}
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { ProviderModelCombobox, type ProviderModelComboboxProps }
