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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  getBrandFromModel,
  getBuiltinModelName,
  getModelDisplayName,
  getOwnerTypeBadge,
  isBuiltinPublicModelPackage,
  stripBuiltinPublicModelPackagePrefix,
  canUseModelBySubscription,
} from "@/utils/common"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { IconChevronDown } from "@tabler/icons-react"
import { useMemo, useState } from "react"

const BUILTIN_MODEL_OPTIONS = [
  {
    model: "monkeycode-basic",
    label: "基础模型",
    badge: "免费使用",
  },
  {
    model: "monkeycode-pro",
    label: "专业模型",
    badge: "专业会员可免费使用",
  },
  {
    model: "monkeycode-ultra",
    label: "旗舰模型",
    badge: "旗舰会员可免费使用",
  },
] as const

interface ModelSelectProps {
  models: DomainModel[]
  selectedModel?: DomainModel
  selectedModelId: string
  setSelectedModelId: (modelId: string) => void
  className?: string
  subscription?: DomainSubscriptionResp | null
}

export default function ModelSelect({
  models,
  selectedModel,
  selectedModelId,
  setSelectedModelId,
  className,
  subscription,
}: ModelSelectProps) {
  const isMobile = useIsMobile()
  const supportedModels = useMemo(
    () => models.filter((model) => model.id || model.model),
    [models],
  )
  const builtinModelGroups = useMemo(
    () => IS_OFFLINE_EDITION
      ? []
      : BUILTIN_MODEL_OPTIONS.map((option) => ({
        key: option.model,
        label: option.label,
        badge: option.badge,
        badgeVariant: option.model === "monkeycode-basic" ? "default" as const : "secondary" as const,
        iconName: option.model === "monkeycode-basic"
          ? "gift"
          : option.model === "monkeycode-pro"
            ? "vip-1"
            : "vip-2",
        models: supportedModels.filter((model) => getBuiltinModelName(model.model) === option.model),
      })),
    [supportedModels],
  )
  const privateModels = useMemo(
    () => supportedModels.filter((model) => (
      model.owner?.type === ConstsOwnerType.OwnerTypePrivate
      && !getBuiltinModelName(model.model)
    )),
    [supportedModels],
  )
  const otherPaidModels = useMemo(
    () => supportedModels.filter((model) => (
      model.owner?.type === ConstsOwnerType.OwnerTypePublic
      && !isBuiltinPublicModelPackage(model.model)
    )),
    [supportedModels],
  )
  const teamModelGroups = useMemo(
    () => Array.from(
      supportedModels
        .filter((model) => (
          model.owner?.type === ConstsOwnerType.OwnerTypeTeam
          && !getBuiltinModelName(model.model)
        ))
        .reduce((groups, model) => {
          const teamName = model.owner?.name || "团队模型"
          const teamId = model.owner?.id || teamName
          const groupKey = `${teamId}:${teamName}`
          const group = groups.get(groupKey) || { key: groupKey, label: teamName, iconName: "team", models: [] as DomainModel[] }
          group.models.push(model)
          groups.set(groupKey, group)
          return groups
        }, new Map<string, { key: string; label: string; iconName: string; models: DomainModel[] }>())
        .values(),
    ),
    [supportedModels],
  )
  const modelGroups = useMemo(
    () => [
      ...builtinModelGroups,
      {
        key: "other-public-models",
        label: "付费模型",
        badge: "消耗积分使用",
        iconName: "qiandaizi",
        models: otherPaidModels,
      },
      {
        key: "private-models",
        label: "我的模型",
        iconName: "a-AIshezhi",
        models: privateModels,
      },
      ...teamModelGroups,
    ].filter((group) => group.models.length > 0),
    [builtinModelGroups, privateModels, otherPaidModels, teamModelGroups],
  )
  const hasSelectableModel = modelGroups.some((group) => group.models.some((model) => model.id))
  const [openModelGroupKey, setOpenModelGroupKey] = useState<string>()

  const getNestedModelDisplayName = (modelName?: string | null) => {
    const normalizedModelName = modelName?.trim()
    if (!normalizedModelName) {
      return ""
    }

    const builtinModelName = getBuiltinModelName(normalizedModelName)
    if (!builtinModelName) {
      return getModelDisplayName(normalizedModelName)
    }

    const nestedModelName = normalizedModelName.slice(builtinModelName.length).replace(/^\/+/, "")
    return nestedModelName || getModelDisplayName(normalizedModelName)
  }

  const getModelOptionDisplayName = (model: DomainModel, nested = false) => {
    const remark = model.remark?.trim()
    if (remark) {
      return stripBuiltinPublicModelPackagePrefix(remark)
    }

    return nested ? getNestedModelDisplayName(model.model) : getModelDisplayName(model.model)
  }

  const getSelectedModelDisplayName = () => {
    const builtinModelName = getBuiltinModelName(selectedModel?.model)
    const builtinOption = BUILTIN_MODEL_OPTIONS.find((option) => option.model === builtinModelName)
    if (builtinOption && selectedModel) {
      const nestedModelName = getModelOptionDisplayName(selectedModel, true)
      return isMobile ? nestedModelName : `${builtinOption.label} / ${nestedModelName}`
    }

    return selectedModel ? getModelOptionDisplayName(selectedModel) : ""
  }

  const getRecommendedModelBadge = (modelName?: string | null) => {
    const normalizedModelName = modelName?.trim().toLowerCase()
    if (!normalizedModelName) {
      return null
    }

    const builtinModelName = getBuiltinModelName(normalizedModelName)
    const nestedModelName = builtinModelName
      ? normalizedModelName.slice(builtinModelName.length).replace(/^\/+/, "")
      : normalizedModelName

    if (
      (builtinModelName === "monkeycode-basic" && nestedModelName === "qwen3.5-plus")
      || (builtinModelName === "monkeycode-pro" && nestedModelName === "qwen3.6-plus")
      || (builtinModelName === "monkeycode-ultra" && nestedModelName === "gpt-5.5")
    ) {
      return "推荐"
    }

    return null
  }

  const renderModelOption = (model: DomainModel, nested = false, indented = false) => {
    const displayName = getModelOptionDisplayName(model, nested)
    const recommendedBadge = getRecommendedModelBadge(model.model)

    return (
      <DropdownMenuRadioItem
        key={model.id || model.model}
        value={model.id || ""}
        className={cn(
          "w-full justify-between gap-3 pr-2 [&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden",
          indented && "pl-7",
        )}
        disabled={!model.id || !canUseModelBySubscription(model, subscription)}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Icon name={getBrandFromModel(model)} className="size-4" />
          <span className="truncate">{displayName}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5">
          {recommendedBadge ? (
            <Badge variant="secondary" className="shrink-0">{recommendedBadge}</Badge>
          ) : null}
          {model.owner?.type !== ConstsOwnerType.OwnerTypePublic && getOwnerTypeBadge(model.owner)}
        </div>
      </DropdownMenuRadioItem>
    )
  }

  const renderModelGroupHeader = (group: { key: string; label: string; badge?: string; badgeVariant?: "default" | "secondary"; iconName?: string; models: DomainModel[] }) => (
    <div key={group.key} className="flex min-w-0 items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
      {group.iconName ? (
        <Icon name={group.iconName} className="size-4 shrink-0" />
      ) : null}
      <span className="truncate">{group.label}</span>
      {group.badge ? (
        <Badge
          variant={group.badgeVariant || "secondary"}
          className={cn("shrink-0", group.badgeVariant === "default" && "!text-primary-foreground")}
        >
          {group.badge}
        </Badge>
      ) : null}
    </div>
  )

  const renderModelGroup = (group: { key: string; label: string; badge?: string; badgeVariant?: "default" | "secondary"; iconName?: string; models: DomainModel[] }) => {
    const hasAvailableModel = group.models.some((model) => model.id)

    return (
      <DropdownMenuSub
        key={group.key}
        open={openModelGroupKey === group.key}
        onOpenChange={(open) => {
          setOpenModelGroupKey((currentKey) => {
            if (open) {
              return group.key
            }

            return currentKey === group.key ? undefined : currentKey
          })
        }}
      >
        <DropdownMenuSubTrigger className="w-full" disabled={!hasAvailableModel}>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {group.iconName ? (
              <Icon name={group.iconName} className="size-4 shrink-0" />
            ) : null}
            <span className="truncate">{group.label}</span>
            {group.badge ? (
              <Badge
                variant={group.badgeVariant || "secondary"}
                className={cn("shrink-0", group.badgeVariant === "default" && "!text-primary-foreground")}
              >
                {group.badge}
              </Badge>
            ) : null}
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-[320px] min-w-[280px] overflow-y-auto">
          {group.models.map((model) => renderModelOption(model, Boolean(getBuiltinModelName(model.model))))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="flex w-full items-center gap-2">
        <DropdownMenu onOpenChange={(open) => {
          if (!open) {
            setOpenModelGroupKey(undefined)
          }
        }}>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-8 min-w-0 flex-1 justify-between rounded-md px-2 text-sm"
              disabled={!hasSelectableModel}
            >
              {selectedModel ? (
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Icon name={getBrandFromModel(selectedModel)} className="size-4 shrink-0" />
                  <span className="truncate">{getSelectedModelDisplayName()}</span>
                </span>
              ) : (
                <span className="truncate text-muted-foreground">选择模型</span>
              )}
              <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-w-[320px] overflow-y-auto max-sm:w-[calc(100vw-2rem)] max-sm:min-w-0">
            <DropdownMenuRadioGroup value={selectedModelId} onValueChange={setSelectedModelId}>
              {isMobile ? modelGroups.map((group) => (
                <div key={group.key} className="not-first:mt-1 not-first:border-t not-first:border-border not-first:pt-2">
                  {renderModelGroupHeader(group)}
                  <div className="mt-1 space-y-0.5">
                    {group.models.map((model) => renderModelOption(model, Boolean(getBuiltinModelName(model.model)), true))}
                  </div>
                </div>
              )) : modelGroups.map(renderModelGroup)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
