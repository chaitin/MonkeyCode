import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Navigate, useLocation, useNavigate } from "react-router-dom"

import { LanguageToggle } from "@/components/language-toggle"
import { LoginForm, type LoginProvider } from "@/components/login-form"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { DEFAULT_CONSOLE_PATH } from "@/lib/routes"

const oauthErrorKeys: Record<string, string> = {
  admin_role_required: "login.oauthAdminRequired",
  user_disabled: "login.oauthAdminRequired",
}

export function LoginPage() {
  const { t } = useTranslation()
  const { isLoading, refresh, user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [oauthSubmitting, setOauthSubmitting] = useState("")
  const [providers, setProviders] = useState<LoginProvider[]>([])
  const [error, setError] = useState("")
  const destination =
    (location.state as { from?: string } | null)?.from ?? DEFAULT_CONSOLE_PATH
  const oauthError = new URLSearchParams(location.search).get("oauth_error")
  const visibleError =
    error ||
    (oauthError ? t(oauthErrorKeys[oauthError] ?? "login.oauthFailed") : "")

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

  if (!isLoading && user?.role === "admin") {
    return <Navigate to={destination} replace />
  }

  const authenticated = async () => {
    await refresh()
    navigate(destination, { replace: true })
  }

  const startOAuthLogin = (provider: LoginProvider) => {
    setOauthSubmitting(provider.id)
    setError("")
    window.location.assign(
      `/api/auth/v1/oauth/${encodeURIComponent(provider.id)}/admin-start`
    )
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted p-4">
      <div className="absolute end-4 top-4 flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm md:max-w-4xl">
        <LoginForm
          error={visibleError}
          oauthSubmitting={oauthSubmitting}
          providers={providers}
          onOAuthLogin={startOAuthLogin}
          onAuthenticated={authenticated}
        />
      </div>
    </main>
  )
}
