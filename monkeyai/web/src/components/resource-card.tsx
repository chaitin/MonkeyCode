import type { ComponentProps } from "react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type Props = ComponentProps<typeof Card> & {
  disabled?: boolean
  selectable?: boolean
  selected?: boolean
}

export function ResourceCard({
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
        disabled && [
          "[&_[data-slot=avatar-fallback]]:bg-inherit [&_[data-slot=avatar-fallback]]:text-inherit",
          "bg-muted ring-gray-300 dark:bg-muted dark:ring-gray-700",
          "[&>[data-slot=card-footer]]:border-gray-300 dark:[&>[data-slot=card-footer]]:border-gray-700",
          "[&_[data-slot=avatar]]:bg-gray-200 [&_[data-slot=avatar]]:text-gray-600 dark:[&_[data-slot=avatar]]:bg-gray-700 dark:[&_[data-slot=avatar]]:text-gray-300",
          "[&_[data-slot=avatar]]:after:border-gray-300 dark:[&_[data-slot=avatar]]:after:border-gray-700",
        ],
        selectable && "cursor-pointer",
        selected &&
          "relative ring-0 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border-2",
        selected &&
          (disabled
            ? "after:border-gray-500 dark:after:border-gray-400"
            : "after:border-primary"),
        className
      )}
    />
  )
}
