import type { ComponentProps } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Props = ComponentProps<typeof Button> & {
  tone?: "blue" | "neutral"
}

export function ResourceCardMenuButton({
  tone = "neutral",
  className,
  ...props
}: Props) {
  return (
    <Button
      {...props}
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        tone === "blue"
          ? "hover:bg-blue-100 hover:text-blue-800 aria-expanded:bg-blue-100 aria-expanded:text-blue-800 dark:hover:bg-blue-900 dark:hover:text-blue-200 dark:aria-expanded:bg-blue-900 dark:aria-expanded:text-blue-200"
          : "hover:bg-gray-200 hover:text-gray-700 aria-expanded:bg-gray-200 aria-expanded:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300 dark:aria-expanded:bg-gray-800 dark:aria-expanded:text-gray-300",
        className
      )}
    />
  )
}
