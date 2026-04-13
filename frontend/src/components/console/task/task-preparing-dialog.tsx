import { useMemo } from "react"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { IconCheck, IconLoader, IconX } from "@tabler/icons-react"
import { ConstsTaskStatus, GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType, type DomainProjectTask } from "@/api/Api"
import { getConditionTypeText, getLastCondition } from "@/utils/common"

interface TaskPreparingProps {
  task: DomainProjectTask | null
}

export function useShouldShowPreparing(task: DomainProjectTask | null) {
  return useMemo(() => {
    const lastCondition = getLastCondition(task?.virtualmachine)
    if (lastCondition?.type === GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeFailed) {
      return true
    }
    return task?.status === ConstsTaskStatus.TaskStatusPending
  }, [task?.status, task?.virtualmachine])
}

function TaskPreparingIcon({ task }: TaskPreparingProps) {
  if (task?.status === ConstsTaskStatus.TaskStatusError) return <IconX className="size-8" />
  if (task?.status === ConstsTaskStatus.TaskStatusPending) return <IconLoader className="size-8 animate-spin" />
  return <IconCheck className="size-8" />
}

/** 内联形式，用于主内容区替换，不阻塞页面。使用 Empty 组件展示 */
export function TaskPreparingView({ task }: TaskPreparingProps) {
  const show = useShouldShowPreparing(task)
  if (!show) return null

  const statusText = getConditionTypeText(task?.virtualmachine?.conditions)
  const detailMessage = task?.virtualmachine?.conditions?.[task?.virtualmachine?.conditions?.length - 1]?.message || "正在准备开发环境..."

  return (
    <Empty className="flex-1 bg-muted/60">
      <EmptyHeader className="md:max-w-2xl">
        <EmptyMedia variant="icon">
          <TaskPreparingIcon task={task} />
        </EmptyMedia>
      </EmptyHeader>
      <EmptyContent className="md:max-w-2xl gap-3">
        <EmptyDescription className="text-base font-medium text-foreground">
          {statusText}
        </EmptyDescription>
        <EmptyDescription className="text-sm break-all overflow-y-auto">
          {detailMessage}
        </EmptyDescription>
      </EmptyContent>
    </Empty>
  )
}
