import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"

import { useAppToast } from "@/components/animated-toast-provider"
import { AppSidebar } from "@/components/app-sidebar"
import { LanguageToggle } from "@/components/language-toggle"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import {
  CONSOLE_PAGES,
  DEFAULT_CONSOLE_PATH,
  getConsolePage,
  LOGIN_PATH,
} from "@/lib/routes"

export function Dashboard() {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const { logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const currentPage = getConsolePage(location.pathname) ?? CONSOLE_PAGES[0]
  const [productName, setProductName] = useState("MonkeyAI")

  useEffect(() => {
    const controller = new AbortController()
    api<{ product_name: string }>("/api/auth/v1/branding", {
      signal: controller.signal,
    })
      .then((branding) => {
        setProductName(branding.product_name.trim() || "MonkeyAI")
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  const handleLogout = async () => {
    try {
      await logout()
      navigate(LOGIN_PATH, { replace: true })
    } catch (error) {
      showToast({
        status: "error",
        title: error instanceof Error ? error.message : "退出登录失败",
      })
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar onLogout={handleLogout} productName={productName} />
      <SidebarInset className="min-w-0">
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex min-w-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ms-1" />
            <Separator
              orientation="vertical"
              className="me-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink
                    className="block max-w-40 truncate lg:max-w-52"
                    render={<NavLink to={DEFAULT_CONSOLE_PATH} />}
                    title={productName}
                  >
                    {productName}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink
                    render={<NavLink to={currentPage.sectionPath} />}
                  >
                    {t(currentPage.sectionKey)}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{t(currentPage.titleKey)}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="ms-auto flex shrink-0 items-center gap-2 px-4">
            <LanguageToggle variant="ghost" size="icon-sm" />
            <ThemeToggle variant="ghost" size="icon-sm" />
          </div>
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
