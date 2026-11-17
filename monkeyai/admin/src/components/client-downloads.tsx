import { useEffect, useState } from "react"
import {
  AndroidIcon,
  AppleIcon,
  ArrowDown01Icon,
  ComputerIcon,
  LaptopIcon,
  TerminalIcon,
  WindowsNewIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const platforms = [
  { key: "android", icon: AndroidIcon, variants: ["android"] },
  { key: "ios", icon: AppleIcon, variants: ["ios"] },
  { key: "windows", icon: WindowsNewIcon, variants: ["windows"] },
  {
    key: "linux",
    icon: TerminalIcon,
    variants: ["linux_x64"],
  },
  { key: "macos", icon: LaptopIcon, variants: ["macos_arm64"] },
  { key: "kylin", icon: ComputerIcon, variants: [] },
  { key: "uos", icon: ComputerIcon, variants: ["linux_x64"] },
  { key: "harmonyMobile", icon: ComputerIcon, variants: ["harmony"] },
  { key: "harmonyDesktop", icon: ComputerIcon, variants: ["harmony_desktop"] },
] as const

const clientGroups = [
  {
    key: "desktopClients",
    platforms: ["windows", "macos", "linux", "kylin", "uos", "harmonyDesktop"],
  },
  {
    key: "mobileClients",
    platforms: ["android", "ios", "harmonyMobile"],
  },
] as const

type DownloadKey =
  | (typeof platforms)[number]["variants"][number]
  | "linux_x64_deb"
  | "linux_arm64"
  | "linux_arm64_deb"
  | "macos_x64"
  | "windows7"
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
        <div className="mt-10 grid gap-4">
          {clientGroups.map((group) => (
            <section
              key={group.key}
              aria-labelledby={group.key}
              className="rounded-2xl border bg-card p-5 sm:p-6"
            >
              <h3 id={group.key} className="font-heading text-base font-medium">
                {t(`landing.downloads.${group.key}`)}
              </h3>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {group.platforms
                  .map((key) =>
                    platforms.find((platform) => platform.key === key)!
                  )
                  .map((platform) => (
                    <div key={platform.key} className="contents">
                      {platform.key === "kylin" ||
                      platform.key === "harmonyMobile" ||
                      platform.key === "harmonyDesktop" ? (
                        <Dialog>
                          <DialogTrigger
                            render={
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-full"
                              />
                            }
                          >
                            <HugeiconsIcon
                              icon={platform.icon}
                              aria-hidden="true"
                            />
                            {t(`landing.downloads.${platform.key}`)}
                          </DialogTrigger>
                          <DialogContent closeLabel={t("common.close")}>
                            <DialogHeader>
                              <DialogTitle>
                                {t(
                                  platform.key === "kylin"
                                    ? "landing.downloads.kylinStore"
                                    : `landing.downloads.${platform.key}`
                                )}
                              </DialogTitle>
                              <DialogDescription>
                                {t(
                                  platform.key === "kylin"
                                    ? "landing.downloads.kylinStoreDescription"
                                    : "landing.downloads.harmonyListingDescription"
                                )}
                              </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                              <DialogClose render={<Button />}>
                                {t("common.close")}
                              </DialogClose>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      ) : (
                        platform.variants.map((variant) => {
                          if (
                            platform.key === "windows" ||
                            platform.key === "macos" ||
                            platform.key === "linux"
                          ) {
                            const options: {
                              label: string
                              key: DownloadKey
                            }[] =
                              platform.key === "windows"
                                ? [
                                    {
                                      label: t(
                                        "landing.downloads.windowsStandard"
                                      ),
                                      key: "windows",
                                    },
                                    {
                                      label: t("landing.downloads.windows7"),
                                      key: "windows7",
                                    },
                                  ]
                                : platform.key === "macos"
                                  ? [
                                      {
                                        label: t(
                                          "landing.downloads.appleSilicon"
                                        ),
                                        key: "macos_arm64",
                                      },
                                      {
                                        label: t("landing.downloads.intel"),
                                        key: "macos_x64",
                                      },
                                    ]
                                  : [
                                      {
                                        label: "X86_64 · AppImage",
                                        key: "linux_x64",
                                      },
                                      {
                                        label: "X86_64 · DEB",
                                        key: "linux_x64_deb",
                                      },
                                      {
                                        label: "ARM64 · AppImage",
                                        key: "linux_arm64",
                                      },
                                      {
                                        label: "ARM64 · DEB",
                                        key: "linux_arm64_deb",
                                      },
                                    ]
                            return (
                              <DropdownMenu key={variant}>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="rounded-full"
                                    />
                                  }
                                >
                                  <HugeiconsIcon
                                    icon={platform.icon}
                                    aria-hidden="true"
                                  />
                                  {t(`landing.downloads.${platform.key}`)}
                                  <HugeiconsIcon
                                    icon={ArrowDown01Icon}
                                    aria-hidden="true"
                                  />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-max min-w-40">
                                  {options.map((format) => {
                                    const url = downloadUrl(links[format.key])
                                    return url ? (
                                      <DropdownMenuItem
                                        key={format.key}
                                        nativeButton={false}
                                        render={
                                          <a
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          />
                                        }
                                      >
                                        {format.label}
                                      </DropdownMenuItem>
                                    ) : (
                                      <DropdownMenuItem
                                        key={format.key}
                                        disabled
                                      >
                                        {format.label} ·{" "}
                                        {t("landing.downloads.unavailable")}
                                      </DropdownMenuItem>
                                    )
                                  })}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )
                          }
                          const url = downloadUrl(links[variant])
                          const label = t(`landing.downloads.${platform.key}`)
                          return url ? (
                            <Button
                              key={variant}
                              nativeButton={false}
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
                              <HugeiconsIcon
                                icon={platform.icon}
                                aria-hidden="true"
                              />
                              {label}
                            </Button>
                          ) : (
                            <Button
                              key={variant}
                              variant="outline"
                              size="sm"
                              className="rounded-full"
                              disabled
                            >
                              <HugeiconsIcon
                                icon={platform.icon}
                                aria-hidden="true"
                              />
                              {label}
                            </Button>
                          )
                        })
                      )}
                    </div>
                  ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  )
}
