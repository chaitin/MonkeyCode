import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ActionSwapCascadeIcon, ActionSwapCascadeText } from "@/components/motion/action-swap-cascade"

export function CopyCommandButton({ command }: { command: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<"idle" | "copied" | "error">("idle")
  useEffect(() => {
    setReady(true)
    return () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    }
  }, [])

  async function copy() {
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }
    const terminal = ref.current?.closest("[data-install-terminal]")
    const status = terminal?.querySelector<HTMLElement>("[data-copy-status]")
    setBusy(true)
    try {
      await navigator.clipboard.writeText(command)
      if (!ref.current) return
      setState("copied")
      resetTimer.current = setTimeout(() => {
        setState("idle")
        resetTimer.current = null
      }, 5000)
      if (status) {
        status.hidden = true
        status.textContent = ""
      }
    } catch {
      const code = terminal?.querySelector("[data-install-command]")
      if (code) {
        const selection = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(code)
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
      setState("error")
      if (status) {
        status.hidden = false
        status.textContent = "自动复制未成功，请手动复制上方安装命令。"
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} data-copy-controls hidden={!ready}>
      <Button variant="ghost" size="sm" disabled={busy} aria-busy={busy} onClick={copy}
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
  )
}
