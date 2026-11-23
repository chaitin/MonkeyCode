import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const creatorNameSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null

export function getCreatorInitial(creator: string) {
  const name = creator.trim().toUpperCase()
  if (!creatorNameSegmenter) return Array.from(name)[0] ?? ""
  const segments = creatorNameSegmenter.segment(name)
  return segments[Symbol.iterator]().next().value?.segment ?? ""
}
