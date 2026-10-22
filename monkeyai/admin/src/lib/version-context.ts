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
