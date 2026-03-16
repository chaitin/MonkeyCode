import { useMemo } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { IconCheck, IconLoader, IconX } from "@tabler/icons-react"
import { GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType, TypesVirtualMachineStatus, type DomainProjectTask } from "@/api/Api"
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
    return task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusPending
  }, [task?.virtualmachine])
}

function TaskPreparingContent({ task }: TaskPreparingProps) {
  return (
    <div className="border border-dashed rounded-md p-4 items-center justify-center flex flex-col gap-4">
      <div className="flex flex-row gap-2 items-center justify-center py-2">
        <div className="flex items-center justify-center bg-muted rounded-md p-2">
          {task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusOffline && <IconX className="size-6" />}
          {task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusPending && <IconLoader className="size-6 animate-spin" />}
          {task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusOnline && <IconCheck className="size-6" />}
        </div>
        <div className="text-md font-bold text-center">
          {getConditionTypeText(task?.virtualmachine?.conditions)}
        </div>
      </div>
      <div className="break-all text-xs text-muted-foreground max-h-[100px] overflow-y-auto">
        {task?.virtualmachine?.conditions?.[task?.virtualmachine?.conditions?.length - 1]?.message || "正在准备开发环境..."}
      </div>
    </div>
  )
}

function TaskPreparingIcon({ task }: TaskPreparingProps) {
  if (task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusOffline) return <IconX className="size-8" />
  if (task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusPending) return <IconLoader className="size-8 animate-spin" />
  return <IconCheck className="size-8" />
}

export function TaskPreparingDialog({ task }: TaskPreparingProps) {
  const open = useShouldShowPreparing(task)

  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>准备执行任务</DialogTitle>
        </DialogHeader>
        <TaskPreparingContent task={task} />
      </DialogContent>
    </Dialog>
  )
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

