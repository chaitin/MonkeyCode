import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import React from "react"

interface VmRenewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hostId: string | undefined
  vmId: string | undefined
  onSuccess?: () => void
}

// 格式化剩余时间
function formatRemainingTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  if (hours > 0 && minutes > 0) {
    return `${hours} 小时 ${minutes} 分钟`
  } else if (hours > 0) {
    return `${hours} 小时`
  } else if (minutes > 0) {
    return `${minutes} 分钟`
  } else {
    return `${seconds} 秒`
  }
}

// 续期时间选项
const renewLifeOptions = [
  { label: `续期 1 小时`, value: `1h`, seconds: 1 * 60 * 60 },
  { label: `续期 2 小时`, value: `2h`, seconds: 2 * 60 * 60 },
  { label: `续期 3 小时`, value: `3h`, seconds: 3 * 60 * 60 }
]

export function VmRenewDialog({
  open,
  onOpenChange,
  hostId,
  vmId,
  onSuccess,
}: VmRenewDialogProps) {
  const [renewLife, setRenewLife] = useState<string>("1h")
  const [renewLoading, setRenewLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [remainingTime, setRemainingTime] = useState<number>(0)

  React.useEffect(() => {
    if (open) {
      setRenewLife("1h")
      setRemainingTime(0)
      setRenewLoading(false)
      setIsSuccess(false)
    }
  }, [open])

  const confirmRenewVM = async () => {
    if (!vmId || !hostId) {
      toast.error("无法获取开发环境信息")
      onOpenChange(false)
      return
    }

    const selectedOption = renewLifeOptions.find(opt => opt.value === renewLife)
    if (!selectedOption) {
      toast.error("请选择续期时间")
      return
    }

    setRenewLoading(true)
    await apiRequest('v1UsersHostsVmsUpdate', {
      host_id: hostId,
      id: vmId,
      life: selectedOption.seconds,
    }, [], (resp) => {
      if (resp.code === 0) {
        console.log('剩余到期时间：', resp.data?.life_time_seconds)
        setRemainingTime(resp.data?.life_time_seconds || 0)
        setIsSuccess(true)
        onSuccess?.()
      } else {
        toast.error(resp.message || "续期失败")
      }
    })
    setRenewLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>开发环境续期</DialogTitle>
        </DialogHeader>
        {isSuccess ? (
          <div className="text-md">
            续期成功，开发环境将在 <b>{formatRemainingTime(remainingTime)}</b>后回收
          </div>
        ) : (
          <Select value={renewLife} onValueChange={setRenewLife}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="请选择续期时长" />
            </SelectTrigger>
            <SelectContent>
              {renewLifeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          {isSuccess ? (
            <Button onClick={() => onOpenChange(false)}>
              好的
            </Button>
          ) : (
            <Button onClick={confirmRenewVM} disabled={renewLoading}>
              {renewLoading && <Spinner className="size-4" />}
              确认续期
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

