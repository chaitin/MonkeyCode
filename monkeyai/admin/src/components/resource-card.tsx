import type { ComponentProps } from "react"
import { Card } from "@/components/ui/card"
import type { ResourceRow } from "@/lib/resources"
import { cn } from "@/lib/utils"

type Props = ComponentProps<typeof Card> & {
  origin?: ResourceRow["origin"]
  disabled?: boolean
  selectable?: boolean
  selected?: boolean
}

export function ResourceCard({
  origin,
  disabled = false,
  selectable = false,
  selected = false,
  className,
  ...props
}: Props) {
  return (
    <Card
      {...props}
      className={cn(
        "[&_[data-slot=avatar-fallback]]:bg-inherit [&_[data-slot=avatar-fallback]]:text-inherit [&_[data-slot=avatar]]:bg-gray-100 [&_[data-slot=avatar]]:text-gray-700 dark:[&_[data-slot=avatar]]:bg-gray-800 dark:[&_[data-slot=avatar]]:text-gray-200",
        origin !== "package" && [
          "bg-blue-50 ring-blue-200 dark:bg-blue-950 dark:ring-blue-800",
          "[&>[data-slot=card-footer]]:border-blue-200 dark:[&>[data-slot=card-footer]]:border-blue-800",
          "[&_[data-slot=avatar]]:bg-blue-100 [&_[data-slot=avatar]]:text-blue-800 dark:[&_[data-slot=avatar]]:bg-blue-900 dark:[&_[data-slot=avatar]]:text-blue-200",
          "[&_[data-slot=avatar]]:after:border-blue-200 dark:[&_[data-slot=avatar]]:after:border-blue-800",
        ],
        disabled && [
          "bg-muted ring-gray-300 dark:bg-muted dark:ring-gray-700",
          "[&>[data-slot=card-footer]]:border-gray-300 dark:[&>[data-slot=card-footer]]:border-gray-700",
          "[&_[data-slot=avatar]]:bg-gray-200 [&_[data-slot=avatar]]:text-gray-600 dark:[&_[data-slot=avatar]]:bg-gray-700 dark:[&_[data-slot=avatar]]:text-gray-300",
          "[&_[data-slot=avatar]]:after:border-gray-300 dark:[&_[data-slot=avatar]]:after:border-gray-700",
        ],
        selectable && "cursor-pointer",
        selected &&
          "relative ring-0 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border-2",
        selected &&
          (origin !== "package" && !disabled
            ? "after:border-blue-500 dark:after:border-blue-400"
            : "after:border-gray-500 dark:after:border-gray-400"),
        className
      )}
    />
  )
}
