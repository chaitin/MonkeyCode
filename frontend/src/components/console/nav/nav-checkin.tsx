import * as React from "react"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { useCommonData } from "@/components/console/data-provider"
import { Spinner } from "@/components/ui/spinner"
import { captchaChallenge } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { Gift } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

export default function NavCheckin() {
  const { t } = useTranslation()
  const { checkedInToday, reloadCheckinStatus, reloadWallet } = useCommonData()
  const [submitting, setSubmitting] = React.useState(false)

  const handleCheckin = async () => {
    if (submitting) {
      return
    }

    setSubmitting(true)

    const captchaToken = await captchaChallenge()
    if (!captchaToken) {
      toast.error(t("consoleShell.rewards.toast.captchaFailed"))
      setSubmitting(false)
      return
    }

    await apiRequest(
      "v1UsersWalletCheckinCreate",
      { captcha_token: captchaToken },
      [],
      (resp) => {
        if (resp.code === 0) {
          reloadWallet()
          reloadCheckinStatus()
          toast.success(t("consoleShell.rewards.checkin.success"))
          return
        }

        toast.error(resp.message || t("consoleShell.rewards.checkin.failed"))
      },
      () => {
        toast.error(t("consoleShell.rewards.checkin.failed"))
      },
    )

    setSubmitting(false)
  }

  if (checkedInToday !== false) {
    return null
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={t("consoleShell.rewards.checkin.label")}
          disabled={submitting}
          onClick={handleCheckin}
          className="border border-amber-300/70 bg-amber-100 text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(245,158,11,0.18)] transition-colors hover:border-amber-400 hover:bg-amber-200 hover:text-amber-950 active:border-amber-500 active:bg-[#fcd76a] dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:border-amber-400 dark:hover:bg-amber-500/20 dark:active:border-amber-300 dark:active:bg-amber-500/26"
        >
          {submitting ? (
            <Spinner className="size-4 text-amber-700 dark:text-amber-300" />
          ) : (
            <Gift className="size-4 text-amber-700 dark:text-amber-300" />
          )}
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate font-medium">{submitting ? t("consoleShell.rewards.checkin.submitting") : t("consoleShell.rewards.checkin.label")}</span>
            <span className="ml-auto rounded-full border border-amber-300/80 bg-white/80 px-2 py-0.5 text-[11px] font-semibold leading-none text-amber-700 shadow-sm dark:border-amber-400/40 dark:bg-amber-100/10 dark:text-amber-200">
              +100
            </span>
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
