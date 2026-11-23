import {
  ArrowRight01Icon,
  LaptopIcon,
  Loading03Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, Navigate, useLocation } from "react-router-dom"

import { useAppToast } from "@/components/animated-toast-provider"
import { LanguageToggle } from "@/components/language-toggle"
import { LoginForm, type LoginProvider } from "@/components/login-form"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAuth } from "@/hooks/use-auth"
import { useBranding } from "@/hooks/use-branding"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { BrandLogo } from "@/components/brand-logo"
import { Card, CardContent, CardDescription } from "@/components/ui/card"

const oauthErrorKeys: Record<string, string> = {
  admin_role_required: "login.oauthAdminRequired",
  seats_exceeded: "login.seatsExceeded",
  seats_unavailable: "login.seatsUnavailable",
}

function subtitleName(name: string, language: string) {
  if (!language.startsWith("zh")) return name
  return name.trim().replace(/^[A-Za-z0-9]/, " $&").replace(/[A-Za-z0-9]$/, "$& ")
}

export function LoginPage() {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const { showToast } = useAppToast()
  const { isLoading, sessionFailed, refresh, acceptLogin, user } = useAuth()
  const location = useLocation()
  const [oauthSubmitting, setOauthSubmitting] = useState("")
  const [providers, setProviders] = useState<LoginProvider[]>([])
  const { branding } = useBranding()
  const shownOauthError = useRef("")
  const oauthError = new URLSearchParams(location.search).get("oauth_error")

  useEffect(() => {
    document.title = `${t("login.submit")} · ${branding.product_name}`
  }, [branding, t])

  useEffect(() => {
    if (isLoading || sessionFailed || user) return
    const controller = new AbortController()
    api<{ providers: LoginProvider[] }>("/api/auth/v1/providers", {
      signal: controller.signal,
    })
      .then(({ providers: configuredProviders }) => {
        setProviders(configuredProviders)
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") {
          setProviders([])
        }
      })
    return () => controller.abort()
  }, [isLoading, sessionFailed, user])

  useEffect(() => {
    if (!oauthError || shownOauthError.current === oauthError) return
    shownOauthError.current = oauthError
    showToast({
      status: "error",
      title: t(oauthErrorKeys[oauthError] ?? "login.oauthFailed"),
    })
  }, [oauthError, showToast, t])

  if (isLoading)
    return (
      <main className="flex min-h-screen items-center justify-center gap-2 text-sm font-normal" role="status">
        <HugeiconsIcon
          icon={Loading03Icon}
          aria-hidden="true"
          className="size-4 motion-safe:animate-spin"
        />
        {t("accountSettings.loadingProfile")}
      </main>
    )
  if (sessionFailed)
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p role="alert">{t("login.sessionFailed")}</p>
        <Button onClick={() => void refresh()}>
          {t("accountSettings.retry")}
        </Button>
      </main>
    )
  if (user?.role === "user") return <Navigate to="/client" replace />
  if (user)
    return (
      <main className="grid min-h-screen place-items-center bg-muted p-4">
        <Card className="w-full max-w-lg p-0">
          <CardContent className="gap-6 p-6 sm:p-8">
            <div className="flex flex-col items-center gap-2 text-center">
              <BrandLogo
                alt=""
                className="mb-2 size-14 rounded-2xl object-contain shadow-sm"
              />
              <CardDescription>{t("app.chooseAppHint")}</CardDescription>
            </div>
            <ItemGroup>
              {[
                {
                  path: "/client",
                  icon: LaptopIcon,
                  title: "app.workspaceTitle",
                  description: "app.workspaceDescription",
                  action: "app.openWorkspace",
                },
                {
                  path: "/admin/",
                  icon: UserGroupIcon,
                  title: "app.teamConsoleTitle",
                  description: "app.teamConsoleDescription",
                  action: "app.openTeamConsole",
                },
              ].map(({ path, icon, title, description, action }) => (
                <Item
                  key={path}
                  role="listitem"
                  variant="outline"
                  className="flex-nowrap"
                >
                  <ItemMedia variant="icon" aria-hidden="true">
                    <HugeiconsIcon icon={icon} />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{t(title)}</ItemTitle>
                    <ItemDescription className="line-clamp-none">
                      {t(description, {
                        productName: subtitleName(branding.product_name, language),
                        teamName: subtitleName(branding.workspace_name, language),
                      })}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="shrink-0">
                    <Button
                      size="sm"
                      nativeButton={false}
                      render={<Link to={path} />}
                      aria-label={t(action)}
                    >
                      {t("app.enterApp")}
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        data-icon="inline-end"
                        aria-hidden="true"
                        className="rtl:rotate-180"
                      />
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      </main>
    )

  const startOAuthLogin = (provider: LoginProvider) => {
    setOauthSubmitting(provider.id)
    window.location.assign(
      `/api/auth/v1/oauth/${encodeURIComponent(provider.id)}/web-start`
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted p-4">
      <div className="relative w-full max-w-sm md:max-w-4xl">
        <div className="absolute bottom-full end-0 z-10 mb-2 flex items-center gap-1 [&>button:hover]:!bg-foreground/5 [&>button[aria-expanded=true]]:!bg-foreground/5">
          <LanguageToggle variant="ghost" />
          <ThemeToggle variant="ghost" />
        </div>
        <LoginForm
          oauthSubmitting={oauthSubmitting}
          providers={providers}
          teamName={branding.workspace_name}
          toolName={branding.product_name}
          onOAuthLogin={startOAuthLogin}
          onAuthenticated={acceptLogin}
        />
      </div>
    </main>
  )
}
