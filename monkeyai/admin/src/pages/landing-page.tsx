import { useEffect, useState } from "react"
import {
  ArrowUpRight01Icon,
  Briefcase01Icon,
  ComputerProgramming01Icon,
  Download01Icon,
  PaintBoardIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Trans, useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { ClientDownloads } from "@/components/client-downloads"
import { EnterpriseFeatures } from "@/components/enterprise-features"
import { LanguageToggle } from "@/components/language-toggle"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { LOGIN_PATH } from "@/lib/routes"

const modes = [
  {
    id: "coding",
    icon: ComputerProgramming01Icon,
    descriptionKey: "landing.modeDescriptions.coding",
    cardClass:
      "border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/25",
    iconClass:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  },
  {
    id: "work",
    icon: Briefcase01Icon,
    descriptionKey: "landing.modeDescriptions.work",
    cardClass:
      "border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/25",
    iconClass:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  },
  {
    id: "design",
    icon: PaintBoardIcon,
    descriptionKey: "landing.modeDescriptions.design",
    cardClass:
      "border-violet-200 bg-violet-50/70 dark:border-violet-900/60 dark:bg-violet-950/25",
    iconClass:
      "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
  },
]

export function LandingPage() {
  const { t } = useTranslation()
  const [productName, setProductName] = useState("MonkeyAI")
  const [workspaceName, setWorkspaceName] = useState("Monkey AI")

  useEffect(() => {
    const controller = new AbortController()
    api<{ product_name: string; workspace_name: string }>(
      "/api/auth/v1/branding",
      {
        signal: controller.signal,
      }
    )
      .then((branding) => {
        setProductName(branding.product_name.trim() || "MonkeyAI")
        setWorkspaceName(branding.workspace_name.trim() || "Monkey AI")
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    document.title = t("landing.title", { productName })
  }, [productName, t])

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            aria-label={productName}
            className="flex min-w-0 items-center gap-2.5"
          >
            <span className="size-9 overflow-hidden">
              <img
                src="/logo-light.png"
                alt=""
                className="size-full object-cover dark:hidden"
              />
              <img
                src="/logo-dark.png"
                alt=""
                className="hidden size-full object-cover dark:block"
              />
            </span>
            <span className="hidden max-w-32 truncate font-heading text-base font-semibold tracking-tight min-[420px]:inline sm:max-w-48">
              {productName}
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1 sm:flex">
              <LanguageToggle variant="ghost" />
              <ThemeToggle variant="ghost" />
            </div>
            <Button render={<Link to={LOGIN_PATH} />}>
              {t("app.adminConsole")}
              <HugeiconsIcon icon={ArrowUpRight01Icon} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>

      <main className="relative isolate flex flex-1 items-center overflow-hidden px-6 py-16 sm:py-20 lg:py-28">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_25%_25%,var(--color-muted),transparent_55%)] opacity-60" />
        <div className="mx-auto grid w-full max-w-6xl gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-16">
          <div className="max-w-2xl">
            <h1 className="font-heading text-4xl leading-[1.18] font-semibold tracking-tight text-balance sm:text-5xl">
              {t("landing.positioning")}
            </h1>
            <p className="mt-7 max-w-xl border-s-2 border-foreground/70 ps-5 text-lg leading-8 sm:text-xl sm:leading-9">
              {t("landing.promise")}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" render={<a href="#downloads" />}>
                <HugeiconsIcon icon={Download01Icon} aria-hidden="true" />
                {t("landing.downloads.title")}
              </Button>
              <Button
                size="lg"
                variant="outline"
                render={<Link to={LOGIN_PATH} />}
              >
                {t("app.adminConsole")}
                <HugeiconsIcon icon={ArrowUpRight01Icon} aria-hidden="true" />
              </Button>
            </div>
          </div>
          <section className="rounded-2xl border bg-card p-6 sm:p-8">
            <h2 className="text-sm font-medium text-muted-foreground">
              {t("landing.modesLabel")}
            </h2>
            <ul className="mt-5 grid gap-2">
              {modes.map((mode) => (
                <li
                  key={mode.id}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 ${mode.cardClass}`}
                >
                  <span
                    className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${mode.iconClass}`}
                  >
                    <HugeiconsIcon
                      icon={mode.icon}
                      className="size-5"
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {t(`landing.modeNames.${mode.id}`)}
                    </p>
                    <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                      {t(mode.descriptionKey)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      <EnterpriseFeatures />
      <ClientDownloads />

      <footer className="border-t px-6 py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2 text-foreground">
            <span className="truncate">{productName}</span>
            <span
              className="size-[3px] shrink-0 rounded-full bg-muted-foreground"
              aria-hidden="true"
            />
            <span className="truncate">{workspaceName}</span>
          </span>
          <div className="ms-auto flex min-w-0 items-center gap-3">
            <span className="text-end">
              <Trans
                i18nKey="landing.poweredBy"
                components={{
                  repo: (
                    <a
                      href="https://github.com/chaitin/monkeycode"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    />
                  ),
                }}
              />
            </span>
            <div className="flex shrink-0 items-center gap-1 sm:hidden">
              <LanguageToggle variant="ghost" size="icon-sm" />
              <ThemeToggle variant="ghost" size="icon-sm" />
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
