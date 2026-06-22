import { Moon, Sun, SunMoon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTheme } from "@/components/theme-context"
import { useTranslation } from "react-i18next"

export function ModeToggle() {
  const { t } = useTranslation()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const Icon = theme === "system" ? SunMoon : resolvedTheme === "dark" ? Moon : Sun

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm">
          <Icon className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">{t("common.theme.toggle")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun />
          {t("common.theme.light")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon />
          {t("common.theme.dark")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <SunMoon />
          {t("common.theme.system")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
