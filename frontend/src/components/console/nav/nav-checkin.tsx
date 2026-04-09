import * as React from "react"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { useCommonData } from "@/components/console/data-provider"
import { Spinner } from "@/components/ui/spinner"
import { captchaChallenge } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { Gift } from "lucide-react"
import { toast } from "sonner"

export default function NavCheckin() {
  const { reloadWallet } = useCommonData()
  const [visible, setVisible] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    apiRequest(
      "v1UsersWalletCheckinList",
      {},
      [],
      (resp) => {
        setVisible(resp.data?.checked_in !== true)
      },
      () => {
        setVisible(false)
      },
    )
  }, [])

  const handleCheckin = async () => {
    if (submitting) {
      return
    }

    setSubmitting(true)

    const captchaToken = await captchaChallenge()
    if (!captchaToken) {
      toast.error("验证码验证失败")
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
          setVisible(false)
          toast.success("签到成功，已领取 100 积分")
          return
        }

        toast.error(resp.message || "签到失败，请重试")
      },
      () => {
        toast.error("签到失败，请重试")
      },
    )

    setSubmitting(false)
  }

  if (!visible) {
    return null
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip="签到领积分"
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
            <span className="truncate font-medium">{submitting ? "签到中..." : "签到领积分"}</span>
            <span className="ml-auto rounded-full border border-amber-300/80 bg-white/80 px-2 py-0.5 text-[11px] font-semibold leading-none text-amber-700 shadow-sm dark:border-amber-400/40 dark:bg-amber-100/10 dark:text-amber-200">
              +100
            </span>
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
