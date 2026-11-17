import type { ReactNode } from "react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Card } from "@/components/ui/card"
import { LoadState } from "./common"
import { cn } from "@/lib/utils"

export function CloudSection({
  title,
  description,
  action,
  headerAction,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  headerAction?: ReactNode
  children: ReactNode
}) {
  return (
    <Collapsible
      defaultOpen
      className="overflow-hidden rounded-lg border bg-card"
    >
      <div className="relative flex min-h-[3.25rem] flex-wrap items-center gap-3 py-2 pe-12 ps-4">
        <CollapsibleTrigger
          aria-label={title}
          className="group absolute inset-0 flex w-full items-center justify-end px-4 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <HugeiconsIcon
            aria-hidden="true"
            className="size-4 transition-transform group-aria-expanded:rotate-90 [[dir=rtl]_&]:rotate-180 [[dir=rtl]_&]:group-aria-expanded:-rotate-90"
            icon={ArrowRight01Icon}
            strokeWidth={2}
          />
        </CollapsibleTrigger>
        <span className="pointer-events-none relative min-w-0 flex-1 font-medium">
          {title}
        </span>
        {headerAction && <div className="relative ms-auto">{headerAction}</div>}
      </div>
      <CollapsibleContent className="space-y-4 border-t p-4">
        {(description || action) && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
            {action}
          </div>
        )}
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function CloudGrid({
  title,
  loading,
  error,
  empty,
  refresh,
  children,
  singleColumn = false,
}: {
  title: string
  loading: boolean
  error?: string
  empty: boolean
  refresh: () => void
  children: ReactNode
  singleColumn?: boolean
}) {
  return (
    <section aria-label={title} aria-busy={loading}>
      <LoadState
        loading={loading}
        error={error}
        empty={empty}
        refresh={refresh}
      />
      {!empty && (
        <div
          className={cn(
            "grid gap-4",
            !singleColumn && "sm:grid-cols-2 xl:grid-cols-3"
          )}
        >
          {children}
        </div>
      )}
    </section>
  )
}

export function CloudCard({ children }: { children: ReactNode }) {
  return (
    <Card
      size="sm"
      className="grid h-full grid-cols-2 content-start gap-4 p-4 [&>div:first-child>p]:hidden [&>div:first-child]:col-span-2 [&>div:last-child]:col-span-2 [&>div:last-child]:mt-auto [&>div:last-child]:border-t [&>div:last-child]:pt-3"
    >
      {children}
    </Card>
  )
}

export function CloudField({
  label,
  children,
  wide = false,
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className={cn("min-w-0 space-y-1", wide && "col-span-2")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="min-w-0 break-words text-sm [&_.truncate]:max-w-full">
        {children}
      </div>
    </div>
  )
}
