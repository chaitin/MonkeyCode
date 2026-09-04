import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { api } from "@/lib/api"
import { AuthContext, type AuthUser } from "@/lib/auth-context"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const session = await api<{
        authenticated: boolean
        user: AuthUser | null
      }>("/api/auth/v1/session")
      setUser(session.authenticated ? session.user : null)
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    api<{
      authenticated: boolean
      user: AuthUser | null
    }>("/api/auth/v1/session")
      .then((session) => setUser(session.authenticated ? session.user : null))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false))
  }, [])

  const logout = useCallback(async () => {
    await api<void>("/api/auth/v1/logout", { method: "POST" })
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({
      isAuthenticated: user !== null,
      isLoading,
      user,
      refresh,
      logout,
    }),
    [isLoading, logout, refresh, user]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
