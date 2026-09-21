import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Navigate, useLocation, useNavigate } from "react-router-dom"

import { useAppToast } from "@/components/animated-toast-provider"
import { LanguageToggle } from "@/components/language-toggle"
import { LoginForm, type LoginProvider } from "@/components/login-form"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { DEFAULT_CONSOLE_PATH } from "@/lib/routes"

type LoginBranding = {
  workspace_name: string
  product_name: string
}

const DEFAULT_LOGIN_BRANDING: LoginBranding = {
  workspace_name: "Monkey AI",
  product_name: "MonkeyAI",
}

const oauthErrorKeys: Record<string, string> = {
  admin_role_required: "login.oauthAdminRequired",
  user_disabled: "login.oauthAdminRequired",
}

export function LoginPage() {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const { isLoading, refresh, user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [oauthSubmitting, setOauthSubmitting] = useState("")
  const [providers, setProviders] = useState<LoginProvider[]>([])
  const [branding, setBranding] = useState(DEFAULT_LOGIN_BRANDING)
  const shownOauthError = useRef("")
  const destination =
    (location.state as { from?: string } | null)?.from ?? DEFAULT_CONSOLE_PATH
  const oauthError = new URLSearchParams(location.search).get("oauth_error")

  useEffect(() => {
    const controller = new AbortController()
    api<LoginBranding>("/api/auth/v1/branding", {
      signal: controller.signal,
    })
      .then((value) => {
        setBranding({
          workspace_name:
            value.workspace_name.trim() ||
            DEFAULT_LOGIN_BRANDING.workspace_name,
          product_name:
            value.product_name.trim() || DEFAULT_LOGIN_BRANDING.product_name,
        })
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    document.title = t("login.adminPanelDocumentTitle", {
      toolName: branding.product_name,
      teamName: branding.workspace_name,
    })
  }, [branding, t])

  useEffect(() => {
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
  }, [])

  useEffect(() => {
    if (!oauthError || shownOauthError.current === oauthError) return
    shownOauthError.current = oauthError
    showToast({
      status: "error",
      title: t(oauthErrorKeys[oauthError] ?? "login.oauthFailed"),
    })
  }, [oauthError, showToast, t])

  if (!isLoading && user?.role === "admin") {
    return <Navigate to={destination} replace />
  }

  const authenticated = async () => {
    await refresh()
    navigate(destination, { replace: true })
  }

  const startOAuthLogin = (provider: LoginProvider) => {
    setOauthSubmitting(provider.id)
    window.location.assign(
      `/api/auth/v1/oauth/${encodeURIComponent(provider.id)}/admin-start`
    )
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted p-4">
      <div className="relative w-full max-w-sm md:max-w-4xl">
        <div className="absolute end-0 bottom-full z-10 mb-2 flex items-center gap-1 [&>button:hover]:bg-foreground/5! [&>button[aria-expanded=true]]:bg-foreground/5!">
          <LanguageToggle variant="ghost" />
          <ThemeToggle variant="ghost" />
        </div>
        <LoginForm
          oauthSubmitting={oauthSubmitting}
          providers={providers}
          teamName={branding.workspace_name}
          toolName={branding.product_name}
          onOAuthLogin={startOAuthLogin}
          onAuthenticated={authenticated}
        />
      </div>
    </main>
  )
}
