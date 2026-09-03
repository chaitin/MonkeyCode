import { Navigate, useLocation, useNavigate } from "react-router-dom"

import { LanguageToggle } from "@/components/language-toggle"
import { LoginForm } from "@/components/login-form"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAuth } from "@/hooks/use-auth"
import { DEFAULT_CONSOLE_PATH } from "@/lib/routes"

export function LoginPage() {
  const { isAuthenticated, login } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  if (isAuthenticated) {
    return <Navigate to={DEFAULT_CONSOLE_PATH} replace />
  }

  const destination =
    (location.state as { from?: string } | null)?.from ?? DEFAULT_CONSOLE_PATH

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted p-4">
      <div className="absolute end-4 top-4 flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm md:max-w-4xl">
        <LoginForm
          onLogin={() => {
            login()
            navigate(destination, { replace: true })
          }}
        />
      </div>
    </main>
  )
}
