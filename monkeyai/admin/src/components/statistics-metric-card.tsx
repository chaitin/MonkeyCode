import {
  ArrowDownRight01Icon,
  ArrowUpRight01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type StatisticsMetricCardProps = {
  comparison: string
  icon: IconSvgElement
  label: string
  trend: string
  trendDirection?: "up" | "down"
  value: string
}

export function StatisticsMetricCard({
  comparison,
  icon,
  label,
  trend,
  trendDirection = "up",
  value,
}: StatisticsMetricCardProps) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
        <CardAction>
          <HugeiconsIcon
            icon={icon}
            size={20}
            strokeWidth={2}
            className="text-muted-foreground"
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            <HugeiconsIcon
              icon={
                trendDirection === "up"
                  ? ArrowUpRight01Icon
                  : ArrowDownRight01Icon
              }
              data-icon="inline-start"
              strokeWidth={2}
            />
            {trend}
          </Badge>
          <span className="truncate text-xs text-muted-foreground">
            {comparison}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
