import { useEffect, useId, useRef, useState, type PointerEvent } from "react"
import { MessageCircle } from "lucide-react"
import { Popover } from "radix-ui"
import { Button } from "@/components/ui/button"

export function WeChatCommunityButton() {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()

  function clearCloseTimer() {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  useEffect(() => () => clearCloseTimer(), [])

  function updateOpen(next: boolean) {
    clearCloseTimer()
    setOpen(next)
  }

  function handlePointerEnter(event: PointerEvent) {
    if (event.pointerType !== "touch") updateOpen(true)
  }

  function handlePointerLeave(event: PointerEvent) {
    if (event.pointerType === "touch" || document.activeElement === trigger.current) return
    clearCloseTimer()
    // Allow the pointer to cross the gap between the button and the card.
    closeTimer.current = setTimeout(() => updateOpen(false), 160)
  }

  return (
    <Popover.Root open={open} onOpenChange={updateOpen}>
      <Popover.Trigger asChild>
        <Button ref={trigger} variant="outline" size="lg" className="studio-community-trigger"
          onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
          <MessageCircle aria-hidden="true" />微信交流群
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="studio-community-card" side="bottom" align="center" sideOffset={12} collisionPadding={16}
          aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`}
          onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}>
          <h3 id={`${id}-title`} className="studio-community-title">微信交流群</h3>
          <img src={`${import.meta.env.BASE_URL}wecom-community-qr.png`} width="200" height="200" alt="微信交流群二维码" />
          <p id={`${id}-hint`} className="studio-community-hint">微信扫码，加入交流群</p>
          <Popover.Arrow className="studio-community-arrow" width={12} height={6} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
