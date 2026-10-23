import { useCallback, useMemo, useState, type FocusEvent } from "react"
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"

type PinReason = "focus" | "menu" | "drag"

export function useVirtualRows({
  keys,
  scrollElement,
  estimateSize,
  gap,
}: {
  keys: readonly string[]
  scrollElement: HTMLDivElement | null
  estimateSize: number
  gap: number
}) {
  "use no memo"

  const [pins, setPins] = useState<Partial<Record<PinReason, string | null>>>(
    {}
  )
  const indexes = useMemo(
    () => new Map(keys.map((key, index) => [key, index])),
    [keys]
  )
  const pin = useCallback((reason: PinReason, key: string, active: boolean) => {
    setPins((current) => {
      const next = active
        ? key
        : current[reason] === key
          ? null
          : current[reason]
      return current[reason] === next ? current : { ...current, [reason]: next }
    })
  }, [])
  const pinnedIndexes = useMemo(
    () =>
      Object.values(pins)
        .map((key) => (key ? indexes.get(key) : undefined))
        .filter((index): index is number => index !== undefined),
    [indexes, pins]
  )
  // The mutable instance stays in this non-memoized hook; callers receive snapshots.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: keys.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimateSize,
    getItemKey: useCallback((index: number) => keys[index], [keys]),
    gap,
    overscan: 6,
    rangeExtractor: useCallback(
      (range) =>
        [...new Set([...defaultRangeExtractor(range), ...pinnedIndexes])].sort(
          (a, b) => a - b
        ),
      [pinnedIndexes]
    ),
  })
  const onFocusCapture = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-virtual-key]"
      )
      if (row?.dataset.virtualKey) pin("focus", row.dataset.virtualKey, true)
    },
    [pin]
  )
  const onBlurCapture = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-virtual-key]"
      )
      if (row?.dataset.virtualKey) pin("focus", row.dataset.virtualKey, false)
    },
    [pin]
  )
  // Read the mutable virtualizer here; callers receive current render snapshots.
  return {
    items: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    measureElement: virtualizer.measureElement,
    scrollToOffset: virtualizer.scrollToOffset,
    pin,
    onFocusCapture,
    onBlurCapture,
  }
}
