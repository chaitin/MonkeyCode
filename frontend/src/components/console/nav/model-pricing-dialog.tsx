import Icon from "@/components/common/Icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Item, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from "@/components/ui/item"
import { cn } from "@/lib/utils"
import { getBrandFromModelName, getModelDisplayName, modelPricingList } from "@/utils/common"
import { IconChevronDown } from "@tabler/icons-react"
import { useMemo, useState } from "react"

interface ModelPricingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TOP_MODEL_COUNT = 3

type PricingSort = "value" | "score" | "name"

function formatPoints(value: number) {
  return Math.ceil(value).toLocaleString()
}

export default function ModelPricingDialog({ open, onOpenChange }: ModelPricingDialogProps) {
  const [pricingSort, setPricingSort] = useState<PricingSort>("name")
  const pricingSortLabel = pricingSort === "value"
    ? "性价比排序"
    : pricingSort === "score"
      ? "代码能力排序"
      : "按名字排序"

  const topScoreModels = useMemo(
    () => [...modelPricingList]
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_MODEL_COUNT),
    [],
  )
  const scoreRankMap = useMemo(
    () => new Map(topScoreModels.map((item, index) => [item.model, index + 1])),
    [topScoreModels],
  )
  const sortedModelPricing = useMemo(
    () => [...modelPricingList].sort((a, b) => {
      if (pricingSort === "name") {
        return a.model.localeCompare(b.model)
      }

      if (pricingSort === "score") {
        return b.score - a.score
      }

      if (a.credits === 0 && b.credits === 0) {
        return b.score - a.score
      }
      if (a.credits === 0) {
        return -1
      }
      if (b.credits === 0) {
        return 1
      }

      return (b.score / b.credits) - (a.score / a.credits)
    }),
    [pricingSort],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] min-w-0 flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>模型定价</DialogTitle>
          <DialogDescription>查看不同模型每百万 Token 对应的积分消耗</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              价格按每百万 Token 计算
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="outline" className="gap-2">
                  <span>{pricingSortLabel}</span>
                  <IconChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setPricingSort("value")}>
                  性价比排序
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPricingSort("score")}>
                  代码能力排序
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPricingSort("name")}>
                  按名字排序
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ItemGroup className="min-h-0 flex-1 overflow-y-auto">
            {sortedModelPricing.map((item, index) => (
              <div key={item.model}>
                <Item variant="default" size="sm" className="px-2 py-3">
                  <ItemContent>
                    <ItemTitle className="grid w-full grid-cols-[minmax(0,1.6fr)_minmax(120px,0.8fr)_minmax(100px,0.6fr)] items-center gap-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon name={getBrandFromModelName(item.model)} className="size-4 shrink-0" />
                        <div className="truncate font-mono text-sm font-medium">{getModelDisplayName(item.model)}</div>
                      </div>
                      <div>
                        <Badge
                          variant={item.credits === 0 ? "default" : "outline"}
                          className={cn(
                            "h-6 rounded-full px-2.5 text-xs font-medium",
                            item.credits === 0 && "hover:bg-primary",
                          )}
                        >
                          {item.credits === 0 ? "免费" : `${formatPoints(item.credits)} 积分 / 1M`}
                        </Badge>
                      </div>
                      <div className="flex justify-end">
                        <Badge
                          variant={scoreRankMap.has(item.model) ? "default" : "secondary"}
                          className={cn(
                            "h-6 rounded-full px-2.5 text-xs font-medium",
                            scoreRankMap.has(item.model) && "bg-amber-500 text-white hover:bg-amber-500",
                          )}
                        >
                          {item.score} 分
                        </Badge>
                      </div>
                    </ItemTitle>
                  </ItemContent>
                </Item>
                {index < sortedModelPricing.length - 1 && <ItemSeparator className="my-0" />}
              </div>
            ))}
          </ItemGroup>
        </div>
      </DialogContent>
    </Dialog>
  )
}
