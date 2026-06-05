import type { ReactNode } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function TrendCard({
  title,
  description,
  children,
  className,
  contentClassName,
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <Card className={cn("gap-0 rounded-lg shadow-none", className)}>
      <CardHeader className="gap-2 px-6 pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className={cn("h-64", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  )
}
