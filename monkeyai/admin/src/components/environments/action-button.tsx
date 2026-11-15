import type { ComponentProps } from "react"
import { Button } from "@/components/ui/button"

export function ActionButton({
  label,
  ...props
}: ComponentProps<typeof Button> & {
  label: string
}) {
  return (
    <Button type="button" size="xs" variant="outline" {...props}>
      {label}
    </Button>
  )
}
