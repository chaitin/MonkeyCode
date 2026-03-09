import { apiRequest } from "@/utils/requestUtils"
import { createContext, useContext, useEffect, useState } from "react"

type AuthProviderProps = {
  children: React.ReactNode
}

type AuthProviderState = {
  isLoggedIn: boolean
  isLoading: boolean
  checkAuth: () => void
}

const initialState: AuthProviderState = {
  isLoggedIn: false,
  isLoading: true,
  checkAuth: () => null,
}

const AuthProviderContext = createContext<AuthProviderState>(initialState)

export function AuthProvider({ children }: AuthProviderProps) {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const checkAuth = async () => {
    setIsLoading(true)
    await apiRequest('v1UsersStatusList', {}, [], 
      () => {
        setIsLoggedIn(true)
      },
      () => {
        setIsLoggedIn(false)
      }
    )
    setIsLoading(false)
  }

  useEffect(() => {
    checkAuth()
  }, [])

  const value = {
    isLoggedIn,
    isLoading,
    checkAuth,
  }

  return (
    <AuthProviderContext.Provider value={value}>
      {children}
    </AuthProviderContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthProviderContext)

  if (context === undefined)
    throw new Error("useAuth must be used within an AuthProvider")

  return context
}

