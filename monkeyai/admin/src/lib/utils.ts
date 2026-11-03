import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const creatorNameSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
})

export function getCreatorInitial(creator: string) {
  const segments = creatorNameSegmenter.segment(creator.trim().toUpperCase())
  return segments[Symbol.iterator]().next().value?.segment ?? ""
}
