import type { ReactNode } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function MetricCard({
  title,
  value,
  stats,
  icon,
  className,
}: {
  title: string
  value: string
  stats?: { label: string; value: string }[]
  icon?: ReactNode
  className?: string
}) {
  return (
    <Card className={cn("gap-0 rounded-lg py-4 shadow-none", className)}>
      <CardHeader className="flex items-center justify-between gap-2 px-4 pb-4">
        <CardTitle className="text-muted-foreground text-sm font-medium leading-5">
          {title}
        </CardTitle>
        {icon && (
          <div className="flex size-8 items-center justify-center rounded-md border border-[var(--dashboard-brand-border)] bg-[var(--dashboard-brand-muted)] text-[var(--dashboard-brand)] [&_svg]:size-4">
            {icon}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4 px-4">
        <div className="text-[2rem] font-semibold leading-8 tracking-normal">
          {value}
        </div>
        {stats && stats.length > 0 && (
          <div className="space-y-2 border-t pt-4">
            {stats.map((item) => (
              <div
                key={item.label}
                className="flex min-w-0 items-center justify-between gap-2 text-sm leading-5"
              >
                <div className="truncate text-muted-foreground">
                  {item.label}
                </div>
                <div className="shrink-0 truncate font-medium text-[var(--dashboard-brand)]">
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
