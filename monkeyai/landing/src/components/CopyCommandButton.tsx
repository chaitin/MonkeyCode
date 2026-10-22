import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { ClipboardFeedback, useClipboardFeedback } from "@/components/ClipboardFeedback"
import { Button } from "@/components/ui/button"
import { ActionSwapCascadeIcon, ActionSwapCascadeText } from "@/components/motion/action-swap-cascade"

export function CopyCommandButton({ command }: { command: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copying = useRef(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<"idle" | "copied" | "error">("idle")
  const feedback = useClipboardFeedback()
  const { copyText } = feedback

  const copy = useCallback(async () => {
    if (copying.current) return
    const code = ref.current?.closest("[data-install-terminal]")?.querySelector<HTMLElement>("[data-install-command]")
    if (!code) return
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }
    copying.current = true
    setBusy(true)
    try {
      const success = await copyText(command, "部署命令", code)
      if (!ref.current) return
      setState(success ? "copied" : "error")
      if (success) {
        resetTimer.current = setTimeout(() => {
          setState("idle")
          resetTimer.current = null
        }, 5000)
      }
    } finally {
      copying.current = false
      if (ref.current) setBusy(false)
    }
  }, [command, copyText])

  useEffect(() => {
    setReady(true)
    const code = ref.current?.closest("[data-install-terminal]")?.querySelector<HTMLElement>("[data-install-command]")
    const onClick = () => { void copy() }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      if (!event.repeat) void copy()
    }
    code?.addEventListener("click", onClick)
    code?.addEventListener("keydown", onKeyDown)
    return () => {
      code?.removeEventListener("click", onClick)
      code?.removeEventListener("keydown", onKeyDown)
      if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    }
  }, [copy])

  return (
    <ClipboardFeedback feedback={feedback}>
      <div ref={ref} data-copy-controls hidden={!ready}>
        <Button variant="ghost" size="sm" disabled={busy} aria-busy={busy} onClick={() => { void copy() }}
          data-copy-command data-copy-state={state === "copied" ? "copied" : "idle"}
          aria-label={state === "copied" ? "已复制安装命令" : state === "error" ? "重新复制安装命令" : "复制一键安装命令"}>
          <ActionSwapCascadeIcon value={state} className="size-5">
            {state === "copied" ? <Check data-copy-check /> : <Copy data-copy-icon />}
          </ActionSwapCascadeIcon>
          <ActionSwapCascadeText value={state}>
            {state === "copied" ? "已复制" : state === "error" ? "重新复制" : "复制命令"}
          </ActionSwapCascadeText>
        </Button>
      </div>
    </ClipboardFeedback>
  )
}
