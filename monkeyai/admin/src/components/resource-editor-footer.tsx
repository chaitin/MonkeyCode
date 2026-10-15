import type { ReactNode } from "react"
import { DialogFooter } from "@/components/ui/dialog"

export function ResourceEditorFooter({
  id,
  reason,
  children,
}: {
  id: string
  reason?: string
  children: ReactNode
}) {
  return (
    <DialogFooter className="shrink-0 flex-col sm:items-center">
      {reason && (
        <p
          id={id}
          className="min-w-0 flex-1 text-start text-sm text-red-600 dark:text-red-400"
        >
          {reason}
        </p>
      )}
      <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
        {children}
      </div>
    </DialogFooter>
  )
}
