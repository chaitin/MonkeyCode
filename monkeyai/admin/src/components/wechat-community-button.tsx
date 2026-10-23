import { WechatIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useId, useRef, useState, type PointerEvent } from "react"
import { useTranslation } from "react-i18next"

import communityQRCode from "@/assets/wecom-community-qr.png"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"

export function WeChatCommunityButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerId = useId()
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    },
    []
  )

  function clearCloseTimer() {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  function updateOpen(next: boolean) {
    clearCloseTimer()
    setOpen(next)
  }

  function handlePointerEnter(event: PointerEvent) {
    if (event.pointerType !== "touch") updateOpen(true)
  }

  function handlePointerLeave(event: PointerEvent) {
    if (event.pointerType === "touch") return
    clearCloseTimer()
    // Keep the card open while crossing the gap above the frame.
    closeTimer.current = setTimeout(() => updateOpen(false), 200)
  }

  return (
    <Popover open={open} onOpenChange={updateOpen} triggerId={triggerId}>
      <PopoverTrigger
        id={triggerId}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        className="inline-flex h-8 w-full cursor-pointer items-center justify-center gap-1 rounded-md border border-sidebar-border bg-transparent px-2.5 text-sm text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <HugeiconsIcon
          icon={WechatIcon}
          className="size-4 shrink-0"
          strokeWidth={2}
          aria-hidden="true"
        />
        {t("navigation.wechatCommunity")}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        initialFocus={false}
        finalFocus={false}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        className="w-60 max-w-[calc(100vw-2rem)] gap-3 text-center"
      >
        <PopoverHeader>
          <PopoverTitle>{t("navigation.wechatCommunity")}</PopoverTitle>
          <PopoverDescription>
            {t("navigation.wechatCommunityHint")}
          </PopoverDescription>
        </PopoverHeader>
        <img
          src={communityQRCode}
          width={396}
          height={396}
          alt={t("navigation.wechatCommunityQRCode")}
          className="block h-auto w-full rounded-sm bg-white p-2"
        />
      </PopoverContent>
    </Popover>
  )
}
