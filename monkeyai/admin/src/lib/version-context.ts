import { createContext } from "react"

export type Release = {
  version: string
  upgrade_url: string
  change_logs: string
}

type VersionInfo = {
  current: string | null
  release: Release | null
  upgradeURL: string | null
}

export const VersionContext = createContext<VersionInfo>({
  current: null,
  release: null,
  upgradeURL: null,
})

export function isNewerVersion(latest: string, current: string): boolean {
  const pattern = /^v(\d{6})(\d{2,})$/
  const next = pattern.exec(latest)
  const previous = pattern.exec(current)
  if (!next || !previous) return false
  if (next[1] !== previous[1]) return next[1] > previous[1]
  return BigInt(next[2]) > BigInt(previous[2])
}

export function secureUpgradeURL(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}
