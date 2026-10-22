import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { CircleAlert, CircleCheck } from "lucide-react"
import { Portal, Toast } from "radix-ui"
import "@/styles/copy-feedback.css"

type CopyResult = { id: number; success: boolean; message: string }

export function useClipboardFeedback() {
  const [result, setResult] = useState<CopyResult | null>(null)
  const [open, setOpen] = useState(false)
  const sequence = useRef(0)
  useEffect(() => () => { sequence.current++ }, [])

  const dismiss = useCallback(() => {
    sequence.current++
    setOpen(false)
  }, [])

  const copyText = useCallback(async (value: string, label: string, field: HTMLElement) => {
    const id = ++sequence.current
    const range = document.createRange()
    range.selectNodeContents(field)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    let success: boolean
    try {
      await navigator.clipboard.writeText(value)
      success = true
    } catch {
      success = false
    }
    if (id === sequence.current) {
      setResult({ id, success, message: success ? `${label}已复制` : "复制失败，请手动选择并复制。" })
      setOpen(true)
    }
    return success
  }, [])

  return { result, open, setOpen, copyText, dismiss }
}

type Props = {
  feedback: ReturnType<typeof useClipboardFeedback>
  children: ReactNode
}

export function ClipboardFeedback({ feedback, children }: Props) {
  return (
    <Toast.Provider duration={3000} label="复制通知">
      {children}
      {feedback.result && (
        <Toast.Root key={feedback.result.id} open={feedback.open} onOpenChange={feedback.setOpen}
          className="experience-toast" data-result={feedback.result.success ? "success" : "error"}>
          {feedback.result.success ? <CircleCheck aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
          <Toast.Title>{feedback.result.message}</Toast.Title>
        </Toast.Root>
      )}
      <Portal.Root>
        <Toast.Viewport className="experience-toast-viewport" label="复制通知" />
      </Portal.Root>
    </Toast.Provider>
  )
}
