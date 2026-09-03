import { useCallback, useMemo, useState, type ReactNode } from "react"

import { AuthContext } from "@/lib/auth-context"

const AUTH_STORAGE_KEY = "monkeyai-admin-authenticated"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => localStorage.getItem(AUTH_STORAGE_KEY) === "true"
  )

  const login = useCallback(() => {
    localStorage.setItem(AUTH_STORAGE_KEY, "true")
    setIsAuthenticated(true)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    setIsAuthenticated(false)
  }, [])

  const value = useMemo(
    () => ({ isAuthenticated, login, logout }),
    [isAuthenticated, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
