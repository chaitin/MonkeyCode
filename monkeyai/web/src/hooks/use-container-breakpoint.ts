import { useCallback, useState, type Ref } from "react"

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") return ref(node)
  if (ref) ref.current = node
}

// Container queries are only used at two layout breakpoints. ResizeObserver is
// supported by Chrome 86 and avoids rewriting stylesheets or viewport guesses.
export function useContainerBreakpoint<T extends HTMLElement>(
  minWidth: number,
  forwardedRef?: Ref<T>
) {
  const [wide, setWide] = useState(false)
  const ref = useCallback(
    (node: T | null) => {
      if (!node) return
      const cleanupRef = assignRef(forwardedRef, node)
      const style = getComputedStyle(node)
      setWide(
        node.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight) >=
          minWidth
      )
      const observer = new ResizeObserver(([entry]) => {
        setWide(entry.contentRect.width >= minWidth)
      })
      observer.observe(node)
      return () => {
        observer.disconnect()
        if (typeof cleanupRef === "function") cleanupRef()
        else assignRef(forwardedRef, null)
      }
    },
    [minWidth, forwardedRef]
  )
  return { ref, wide }
}
