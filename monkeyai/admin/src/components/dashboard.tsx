import { useTranslation } from "react-i18next"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"

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
import {
  CONSOLE_PAGES,
  DEFAULT_CONSOLE_PATH,
  getConsolePage,
  LOGIN_PATH,
} from "@/lib/routes"

export function Dashboard() {
  const { t } = useTranslation()
  const { logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const currentPage = getConsolePage(location.pathname) ?? CONSOLE_PAGES[0]

  const handleLogout = async () => {
    await logout()
    navigate(LOGIN_PATH, { replace: true })
  }

  return (
    <SidebarProvider>
      <AppSidebar onLogout={handleLogout} />
      <SidebarInset>
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
                    render={<NavLink to={DEFAULT_CONSOLE_PATH} />}
                  >
                    MonkeyAI
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
