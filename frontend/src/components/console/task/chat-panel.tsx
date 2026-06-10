import React from "react"
import { Button } from "@/components/ui/button"
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { Label } from "@/components/ui/label"
import { IconCircle, IconCircleCheck, IconLoader, IconSubtask } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import type {
  PlanEntry,
  TaskPlan,
  TaskStreamStatus,
} from "./task-shared"

export interface PlanStepsBlockProps {
  plan: TaskPlan
  streamStatus: TaskStreamStatus
}

export function PlanStepsBlock({ plan, streamStatus }: PlanStepsBlockProps) {
  const [planOpened, setPlanOpened] = React.useState(false)

  if (!plan || plan.entries.length === 0) return null

  const renderPlan = () => {
    if (planOpened) {
      return plan.entries.map((entry: PlanEntry, index: number) => (
        <div key={index} className="flex items-center gap-2">
          {entry.status === "in_progress" && streamStatus === "executing" ? (
            <IconLoader className="min-w-3 size-3 animate-spin" />
          ) : entry.status === "completed" ? (
            <IconCircleCheck className="min-w-3 size-3 text-primary" />
          ) : (
            <IconCircle className="min-w-3 size-3 text-muted-foreground" />
          )}
          <div
            className={cn(
              "line-clamp-1 text-xs",
              entry.status === "completed" ? "text-muted-foreground" : "",
              entry.status === "in_progress" && streamStatus === "executing" ? "text-primary" : ""
            )}
          >
            {entry.content}
          </div>
        </div>
      ))
    } else {
      const firstInProgress = plan.entries.find((entry: PlanEntry) => entry.status === "in_progress")
      if (!firstInProgress || streamStatus !== "executing") return null
      return (
        <div className="flex items-center gap-2">
          {firstInProgress.status === "in_progress" ? (
            <IconLoader className="min-w-3 size-3 animate-spin" />
          ) : firstInProgress.status === "completed" ? (
            <IconCircleCheck className="min-w-3 size-3 text-primary" />
          ) : (
            <IconCircle className="min-w-3 size-3 text-muted-foreground" />
          )}
          <div className="line-clamp-1 text-xs text-primary">{firstInProgress.content}</div>
        </div>
      )
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 border rounded-md p-2 shrink-0">
      <div className="flex items-center justify-between">
        <Label>
          <IconSubtask className="size-4 text-primary" />
          执行步骤 ({plan.entries.filter((entry: PlanEntry) => entry.status === "completed").length}/{plan.entries.length})
        </Label>
        <Button variant={planOpened ? "secondary" : "ghost"} size="icon-sm" className="size-5" onClick={() => setPlanOpened(!planOpened)}>
          {planOpened ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
        </Button>
      </div>
      <div
        className={cn(
          "flex flex-col gap-2",
          planOpened ? "max-h-48 overflow-y-auto overscroll-contain" : "overflow-hidden"
        )}
      >
        {renderPlan()}
      </div>
    </div>
  )
}
