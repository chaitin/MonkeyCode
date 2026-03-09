import { useMemo } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { IconCheck, IconLoader, IconX } from "@tabler/icons-react"
import { GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType, TypesVirtualMachineStatus, type DomainProjectTask } from "@/api/Api"
import { getConditionTypeText, getLastCondition } from "@/utils/common"

interface TaskPreparingDialogProps {
  task: DomainProjectTask | null
}

export function TaskPreparingDialog({ task }: TaskPreparingDialogProps) {
  const open = useMemo(() => {
    const lastCondition = getLastCondition(task?.virtualmachine)
    if (lastCondition?.type === GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeFailed) {
      return true
    }
    return task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusPending
  }, [task?.virtualmachine])

  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>准备执行任务</DialogTitle>
        </DialogHeader>
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
            {task?.virtualmachine?.conditions?.[task?.virtualmachine?.conditions?.length - 1]?.message || '正在准备开发环境...'}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

