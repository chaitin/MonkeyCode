import type { ReactNode } from "react"
import { DialogFooter } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export function ResourceEditorFooter({
  id,
  reason,
  leading,
  children,
}: {
  id: string
  reason?: string
  leading?: ReactNode
  children: ReactNode
}) {
  return (
    <DialogFooter
      className={cn(
        "shrink-0 flex-col sm:items-center",
        leading && "sm:flex-col sm:items-stretch"
      )}
    >
      {reason && (
        <p
          id={id}
          className="min-w-0 flex-1 text-start text-sm text-red-600 dark:text-red-400"
        >
          {reason}
        </p>
      )}
      {leading ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {leading}
          <div className="flex shrink-0 items-center gap-2">{children}</div>
        </div>
      ) : (
        <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
          {children}
        </div>
      )}
    </DialogFooter>
  )
}
