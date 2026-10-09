import { useEffect, useState } from "react"
import {
  AndroidIcon,
  AppleIcon,
  ComputerIcon,
  Download01Icon,
  LaptopIcon,
  TerminalIcon,
  WindowsNewIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"

const platforms = [
  { key: "android", icon: AndroidIcon, variants: ["android"] },
  { key: "ios", icon: AppleIcon, variants: ["ios"] },
  { key: "windows", icon: WindowsNewIcon, variants: ["windows"] },
  { key: "linux", icon: TerminalIcon, variants: ["linux_arm64", "linux_x64"] },
  { key: "macos", icon: LaptopIcon, variants: ["macos_arm64", "macos_x64"] },
  { key: "harmonyDesktop", icon: ComputerIcon, variants: ["harmony_desktop"] },
] as const

type DownloadKey = (typeof platforms)[number]["variants"][number]
type DownloadLinks = Partial<Record<DownloadKey, string>>

function downloadUrl(value: unknown) {
  if (typeof value !== "string") return null
  const url = value.trim()
  if (url.startsWith("/") && !url.startsWith("//")) return url
  if (!/^https?:\/\//i.test(url)) return null
  try {
    return new URL(url).href
  } catch {
    return null
  }
}

export function ClientDownloads() {
  const { t } = useTranslation()
  const [links, setLinks] = useState<DownloadLinks>({})

  useEffect(() => {
    const controller = new AbortController()
    fetch("/downloads.json", { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Download configuration unavailable")
        return response.json() as Promise<DownloadLinks>
      })
      .then((value) => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          setLinks(value)
        }
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  return (
    <section
      id="downloads"
      className="scroll-mt-16 border-t bg-muted/30 px-6 py-16 sm:py-20"
    >
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("landing.downloads.title")}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("landing.downloads.description")}
          </p>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {platforms.map((platform) => (
            <div
              key={platform.key}
              className="flex min-h-40 flex-col rounded-2xl border bg-card p-5"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
                  <HugeiconsIcon
                    icon={platform.icon}
                    className="size-5"
                    aria-hidden="true"
                  />
                </span>
                <h3 className="font-heading text-base font-medium">
                  {t(`landing.downloads.${platform.key}`)}
                </h3>
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
                {platform.variants.map((variant) => {
                  const url = downloadUrl(links[variant])
                  const label =
                    variant === "linux_arm64"
                      ? "ARM64"
                      : variant === "linux_x64"
                        ? "x64"
                        : variant === "macos_arm64"
                          ? t("landing.downloads.appleSilicon")
                          : variant === "macos_x64"
                            ? t("landing.downloads.intel")
                            : t("landing.downloads.download")
                  return url ? (
                    <Button
                      key={variant}
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      render={
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                    >
                      <HugeiconsIcon icon={Download01Icon} aria-hidden="true" />
                      {label}
                    </Button>
                  ) : (
                    <span
                      key={variant}
                      className="rounded-full border border-dashed px-3 py-2 text-xs text-muted-foreground"
                    >
                      {platform.variants.length > 1 ? `${label} · ` : ""}
                      {t("landing.downloads.unavailable")}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
