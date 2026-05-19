import type { DomainModel, DomainSubscriptionResp } from "@/api/Api"
import { ConstsOwnerType } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  getBrandFromModelName,
  getBuiltinModelName,
  getModelDisplayName,
  getModelPricingItem,
  getOwnerTypeBadge,
  canUseModelBySubscription,
} from "@/utils/common"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { cn } from "@/lib/utils"
import { IconChevronDown, IconHelpCircle } from "@tabler/icons-react"
import { useEffect, useMemo } from "react"

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"
const OTHER_MODELS_TOOLTIP = "消耗积分调用"

const BUILTIN_MODEL_OPTIONS = [
  {
    model: "monkeycode-basic",
    label: "基础模型",
    tooltip: "当前为 qwen3.6-plus",
  },
  {
    model: "monkeycode-pro",
    label: "专业模型",
    tooltip: "当前为 kimi-k2.6",
  },
  {
    model: "monkeycode-ultra",
    label: "旗舰模型",
    tooltip: "当前为 gpt-5.5",
  },
] as const

interface ModelSelectProps {
  models: DomainModel[]
  selectedModel?: DomainModel
  selectedModelId: string
  setSelectedModelId: (modelId: string) => void
  className?: string
  showPricingButton?: boolean
  subscription?: DomainSubscriptionResp | null
}

export default function ModelSelect({
  models,
  selectedModel,
  selectedModelId,
  setSelectedModelId,
  className,
  showPricingButton = true,
  subscription,
}: ModelSelectProps) {
  const builtinModelOptions = useMemo(
    () => BUILTIN_MODEL_OPTIONS.map((option) => ({
      ...option,
      modelItem: models.find((model) => getBuiltinModelName(model.model) === option.model),
    })),
    [models],
  )
  const selectedBuiltinModelName = getBuiltinModelName(selectedModel?.model)
  const selectedBuiltinModel = BUILTIN_MODEL_OPTIONS.find((option) => option.model === selectedBuiltinModelName)
  const selectedOtherModel = selectedModel && !selectedBuiltinModel ? selectedModel : undefined
  const otherModels = useMemo(
    () => models.filter((model) => !getBuiltinModelName(model.model)),
    [models],
  )
  const offlineModels = otherModels
  const selectedOfflineModel = offlineModels.find((model) => model.id === selectedModelId)

  useEffect(() => {
    if (!IS_OFFLINE_EDITION || offlineModels.length === 0) {
      return
    }

    const hasSelectedOfflineModel = offlineModels.some((model) => model.id === selectedModelId)
    const firstOfflineModelId = offlineModels.find((model) => model.id)?.id
    if (!hasSelectedOfflineModel && firstOfflineModelId) {
      setSelectedModelId(firstOfflineModelId)
    }
  }, [offlineModels, selectedModelId, setSelectedModelId])

  const handleOpenModelPricing = () => {
    window.dispatchEvent(new CustomEvent(OPEN_WALLET_DIALOG_EVENT, {
      detail: { section: "pricing" },
    }))
  }

  const renderModelOption = (model: DomainModel) => {
    const showPricingSummary =
      !IS_OFFLINE_EDITION && model.owner?.type === ConstsOwnerType.OwnerTypePublic
    const pricing = showPricingSummary ? getModelPricingItem(model.model) : undefined
    const pricingTags = pricing?.tags ?? []

    return (
      <DropdownMenuRadioItem
        key={model.id}
        value={model.id || ""}
        className="w-full justify-between gap-3 pr-2 [&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Icon name={getBrandFromModelName(model.model || "")} className="size-4" />
          <span className="truncate">{getModelDisplayName(model.model)}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5">
          {showPricingSummary && pricing ? (
            <Badge variant="secondary" className="shrink-0">
              {pricing.credits} 积分
            </Badge>
          ) : null}
          {showPricingSummary && pricingTags.map((tag) => (
            <Badge
              key={`${model.id}-${tag}`}
              variant="default"
              className="shrink-0 !bg-primary !text-primary-foreground"
            >
              {tag}
            </Badge>
          ))}
          {model.owner?.type !== ConstsOwnerType.OwnerTypePublic && getOwnerTypeBadge(model.owner)}
        </div>
      </DropdownMenuRadioItem>
    )
  }

  if (IS_OFFLINE_EDITION) {
    return (
      <div className={cn("w-full", className)}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-full min-w-0 justify-between rounded-md px-2 text-sm"
              disabled={offlineModels.length === 0}
            >
              {selectedOfflineModel ? (
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Icon name={getBrandFromModelName(selectedOfflineModel.model || "")} className="size-4 shrink-0" />
                  <span className="truncate">{getModelDisplayName(selectedOfflineModel.model)}</span>
                </span>
              ) : (
                <span className="truncate text-muted-foreground">选择模型</span>
              )}
              <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[320px]">
            <DropdownMenuRadioGroup value={selectedModelId} onValueChange={setSelectedModelId}>
              {offlineModels.map(renderModelOption)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="flex w-full items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border bg-background p-1">
          {builtinModelOptions.map((option) => (
            (() => {
              const disabled = !option.modelItem?.id || !canUseModelBySubscription(option.modelItem, subscription)

              return (
                <Button
                  key={option.model}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-sm data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary"
                  data-selected={selectedBuiltinModelName === option.model}
                  disabled={disabled}
                  onClick={() => {
                    if (option.modelItem?.id && !disabled) {
                      setSelectedModelId(option.modelItem.id)
                    }
                  }}
                >
                  <span>{option.label}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex shrink-0 text-muted-foreground transition-colors hover:text-primary"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <IconHelpCircle className="size-3.5" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[320px] leading-6">
                      {option.tooltip}
                    </TooltipContent>
                  </Tooltip>
                </Button>
              )
            })()
          ))}
          <div className="min-w-0 flex-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-full min-w-0 justify-between rounded-sm px-2 text-sm data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary"
                  data-selected={Boolean(selectedOtherModel)}
                >
                  {selectedOtherModel ? (
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <Icon name={getBrandFromModelName(selectedOtherModel.model || "")} className="size-4 shrink-0" />
                      <span className="truncate">{getModelDisplayName(selectedOtherModel.model)}</span>
                    </span>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
                      <span className="truncate">其他模型</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="inline-flex shrink-0 text-muted-foreground transition-colors hover:text-primary"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <IconHelpCircle className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[320px] leading-6">
                          {OTHER_MODELS_TOOLTIP}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  )}
                  <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[320px]">
                <DropdownMenuRadioGroup value={selectedModelId} onValueChange={setSelectedModelId}>
                  {otherModels.map(renderModelOption)}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {showPricingButton ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                className="shrink-0 rounded-md"
                onClick={handleOpenModelPricing}
                aria-label="查看模型定价"
              >
                <IconHelpCircle className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>查看模型定价</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}
