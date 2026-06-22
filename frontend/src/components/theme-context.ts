import { createContext, useContext } from "react"

export type Theme = "dark" | "light" | "system"
export type AppliedTheme = "dark" | "light"

export type ThemeProviderState = {
  theme: Theme
  resolvedTheme: AppliedTheme
  setPathname: (pathname: string) => void
  setTheme: (theme: Theme) => void
}

export const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined)

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
