import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { apiRequest } from "@/utils/requestUtils"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

type WechatMpBindDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WechatMpBindDialog({ open, onOpenChange }: WechatMpBindDialogProps) {
  const { t } = useTranslation()
  const [qrcodeUrl, setQrcodeUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const effectiveOpen = !IS_OFFLINE_EDITION && open

  const fetchQrcode = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      await apiRequest("v1UsersWechatMpBindQrcodeCreate", {}, [], (resp) => {
        if (resp.code === 0 && resp.data?.qrcode_url) {
          setQrcodeUrl(resp.data.qrcode_url)
          return
        }

        const message = resp.message || t("consoleWechatMp.fetchFailed")
        setError(message)
        toast.error(message)
      }, () => {
        setError(t("consoleWechatMp.fetchFailed"))
      })
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!effectiveOpen || qrcodeUrl || loading) {
      return
    }

    fetchQrcode()
  }, [effectiveOpen, fetchQrcode, loading, qrcodeUrl])

  return (
    <Dialog open={effectiveOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("consoleWechatMp.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div className="flex size-52 items-center justify-center rounded-lg border bg-background p-1">
            {loading ? (
              <Spinner className="size-6 text-muted-foreground" />
            ) : qrcodeUrl ? (
              <img
                src={qrcodeUrl}
                alt={t("consoleWechatMp.qrcodeAlt")}
                className="size-full rounded-sm object-contain"
              />
            ) : (
              <div className="px-4 text-center text-sm text-muted-foreground">
                {error || t("consoleWechatMp.qrcodeUnavailable")}
              </div>
            )}
          </div>
          <Alert className="py-2">
            <AlertTitle className="text-xs">
              {t("consoleWechatMp.scanTitle")}
            </AlertTitle>
            <AlertDescription className="text-xs">
              {t("consoleWechatMp.scanDescription")}
            </AlertDescription>
          </Alert>
          <Alert variant="destructive" className="py-2">
            <AlertDescription className="text-xs">
              {t("consoleWechatMp.privateWarning")}
            </AlertDescription>
          </Alert>
        </div>

      </DialogContent>
    </Dialog>
  )
}
