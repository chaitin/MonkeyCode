import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { clearHostCommands } from "@/lib/host-command"
import { api } from "@/lib/api"
import { AuthContext, type AuthUser } from "@/lib/auth-context"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const [sessionFailed, setSessionFailed] = useState(false)
  const revision = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++revision.current
    setIsLoading(true)
    try {
      const session = await api<{
        authenticated: boolean
        user: AuthUser | null
      }>("/api/auth/v1/session")
      if (request !== revision.current) return
      setSessionFailed(false)
      setUser(session.authenticated ? session.user : null)
    } catch {
      if (request === revision.current) setSessionFailed(true)
    } finally {
      if (request === revision.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    return () => {
      revision.current++
    }
  }, [refresh])

  const acceptLogin = useCallback((authenticated: AuthUser) => {
    revision.current++
    setUser(authenticated)
    setSessionFailed(false)
    setIsLoading(false)
  }, [])

  const logout = useCallback(async () => {
    await api<void>("/api/auth/v1/logout", { method: "POST" })
    revision.current++
    setSessionFailed(false)
    setIsLoading(false)
    clearHostCommands()
    setUser(null)
  }, [])

  const updateUser = useCallback((updated: AuthUser) => {
    setUser((current) =>
      current?.id === updated.id ? { ...updated, role: current.role } : current
    )
  }, [])

  const value = useMemo(
    () => ({
      isAuthenticated: user !== null,
      isLoading,
      sessionFailed,
      acceptLogin,
      user,
      refresh,
      updateUser,
      logout,
    }),
    [acceptLogin, sessionFailed, isLoading, logout, refresh, updateUser, user]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
