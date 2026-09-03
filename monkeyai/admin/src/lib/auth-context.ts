import { createContext } from "react"

export type AuthContextValue = {
  isAuthenticated: boolean
  login: () => void
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined
)
