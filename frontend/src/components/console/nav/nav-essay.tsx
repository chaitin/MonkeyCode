import { FilePenLine } from "lucide-react"
import * as React from "react"

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import {
  markPointsActivityOpened,
  POINTS_ACTIVITY_STORAGE_KEYS,
  shouldHidePointsActivity,
} from "./points-activity-visibility"

const ESSAY_ACTIVITY_URL = "https://monkeycode.docs.baizhi.cloud/node/019d8bcf-5bcc-7b38-afcf-6b9d180a0096"

export default function NavEssay() {
  const [hidden, setHidden] = React.useState(() => shouldHidePointsActivity(POINTS_ACTIVITY_STORAGE_KEYS.essay))

  const handleOpenEssayActivity = () => {
    markPointsActivityOpened(POINTS_ACTIVITY_STORAGE_KEYS.essay)
    setHidden(true)
    window.open(ESSAY_ACTIVITY_URL, "_blank", "noopener,noreferrer")
  }

  if (hidden) {
    return null
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip="参与征文拿积分"
          onClick={handleOpenEssayActivity}
          className="border border-amber-300/70 bg-amber-100 text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(245,158,11,0.18)] transition-colors hover:border-amber-400 hover:bg-amber-200 hover:text-amber-950 active:border-amber-500 active:bg-[#fcd76a] dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:border-amber-400 dark:hover:bg-amber-500/20 dark:active:border-amber-300 dark:active:bg-amber-500/26"
        >
          <FilePenLine className="size-4 text-amber-700 dark:text-amber-300" />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate font-medium">参与征文拿积分</span>
            <span className="ml-auto rounded-full border border-amber-300/80 bg-white/80 px-2 py-0.5 text-[11px] font-semibold leading-none text-amber-700 shadow-sm dark:border-amber-400/40 dark:bg-amber-100/10 dark:text-amber-200">
              +100000
            </span>
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
