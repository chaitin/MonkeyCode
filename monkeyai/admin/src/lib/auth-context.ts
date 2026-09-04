import { createContext } from "react"

export type AuthContextValue = {
  isAuthenticated: boolean
  isLoading: boolean
  user: AuthUser | null
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

export type AuthUser = {
  id: string
  name: string
  email: string
  avatar_url?: string
  role: "admin" | "user"
  status: "active" | "disabled"
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined
)
