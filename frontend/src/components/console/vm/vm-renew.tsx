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
import { useTranslation } from "react-i18next"

interface VmRenewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hostId: string | undefined
  vmId: string | undefined
  onSuccess?: () => void
}

function formatRemainingTime(seconds: number, t: ReturnType<typeof useTranslation>["t"]): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  if (hours > 0 && minutes > 0) {
    return t("consoleVm.renew.hoursMinutes", { hours, minutes })
  } else if (hours > 0) {
    return t("consoleVm.renew.hours", { hours })
  } else if (minutes > 0) {
    return t("consoleVm.renew.minutes", { minutes })
  } else {
    return t("consoleVm.renew.seconds", { seconds })
  }
}

const renewLifeOptions = [
  { hours: 1, value: `1h`, seconds: 1 * 60 * 60 },
  { hours: 2, value: `2h`, seconds: 2 * 60 * 60 },
  { hours: 3, value: `3h`, seconds: 3 * 60 * 60 }
]

export function VmRenewDialog({
  open,
  onOpenChange,
  hostId,
  vmId,
  onSuccess,
}: VmRenewDialogProps) {
  const { t } = useTranslation()
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
      toast.error(t("consoleVm.renew.missingVm"))
      onOpenChange(false)
      return
    }

    const selectedOption = renewLifeOptions.find(opt => opt.value === renewLife)
    if (!selectedOption) {
      toast.error(t("consoleVm.renew.selectDuration"))
      return
    }

    setRenewLoading(true)
    await apiRequest('v1UsersHostsVmsUpdate', {
      host_id: hostId,
      id: vmId,
      life: selectedOption.seconds,
    }, [], (resp) => {
      if (resp.code === 0) {
        setRemainingTime(resp.data?.life_time_seconds || 0)
        setIsSuccess(true)
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleVm.renew.failed"))
      }
    })
    setRenewLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("consoleVm.renew.title")}</DialogTitle>
        </DialogHeader>
        {isSuccess ? (
          <div className="text-md">
            {t("consoleVm.renew.successPrefix")} <b>{formatRemainingTime(remainingTime, t)}</b>{t("consoleVm.renew.successSuffix")}
          </div>
        ) : (
          <Select value={renewLife} onValueChange={setRenewLife}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("consoleVm.renew.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {renewLifeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t("consoleVm.renew.option", { hours: option.hours })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          {isSuccess ? (
            <Button onClick={() => onOpenChange(false)}>
              {t("consoleVm.common.ok")}
            </Button>
          ) : (
            <Button onClick={confirmRenewVM} disabled={renewLoading}>
              {renewLoading && <Spinner className="size-4" />}
              {t("consoleVm.renew.confirm")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
