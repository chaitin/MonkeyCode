import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { useLocation } from "react-router-dom"

type Theme = "dark" | "light" | "system"
type AppliedTheme = "dark" | "light"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  resolvedTheme: AppliedTheme
  setPathname: (pathname: string) => void
  setTheme: (theme: Theme) => void
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined)

function isTheme(value: string | null): value is Theme {
  return value === "dark" || value === "light" || value === "system"
}

function getSystemTheme(): AppliedTheme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
  } catch {
    return "light"
  }
}

function getStoredTheme(storageKey: string, defaultTheme: Theme): Theme {
  try {
    const storedTheme = localStorage.getItem(storageKey)
    return isTheme(storedTheme) ? storedTheme : defaultTheme
  } catch {
    return defaultTheme
  }
}

function setStoredTheme(storageKey: string, theme: Theme) {
  try {
    localStorage.setItem(storageKey, theme)
  } catch {
    // Storage can be unavailable in restricted browsing contexts.
  }
}

function resolveTheme(theme: Theme, systemTheme: AppliedTheme, pathname: string): AppliedTheme {
  if (pathname === "/") return "light"
  return theme === "system" ? systemTheme : theme
}

function applyTheme(resolvedTheme: AppliedTheme) {
  const root = window.document.documentElement

  root.classList.remove("light", "dark")
  root.classList.add(resolvedTheme)
  root.style.colorScheme = resolvedTheme
}

// 用于在 Router 内部监听路径变化的组件
export function ThemePathListener() {
  const { setPathname } = useTheme()
  const location = useLocation()

  useEffect(() => {
    setPathname(location.pathname)
  }, [location.pathname, setPathname])

  return null
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => getStoredTheme(storageKey, defaultTheme)
  )
  const [systemTheme, setSystemTheme] = useState<AppliedTheme>(() => getSystemTheme())
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const resolvedTheme = resolveTheme(theme, systemTheme, pathname)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? "dark" : "light")

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange)
      return () => mediaQuery.removeEventListener("change", handleChange)
    }

    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  // 初始加载时的主题设置（路径检查由 ThemePathListener 处理）
  useEffect(() => {
    applyTheme(resolvedTheme)
  }, [resolvedTheme])

  const value = useMemo(() => ({
    theme,
    resolvedTheme,
    setPathname,
    setTheme: (theme: Theme) => {
      setStoredTheme(storageKey, theme)
      setTheme(theme)
    },
  }), [resolvedTheme, storageKey, theme])

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
