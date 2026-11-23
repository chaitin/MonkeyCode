import type { ComponentProps } from "react"
import { Button } from "@/components/ui/button"

export function ResourceCardMenuButton(props: ComponentProps<typeof Button>) {
  return <Button {...props} type="button" variant="ghost" size="icon-sm" />
}
