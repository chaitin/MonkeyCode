import {
  MoonSlowWindIcon,
  Sun03Icon,
  SunMoonIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ComponentProps } from "react"
import { useTranslation } from "react-i18next"

import { useTheme, type Theme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const themeOptions = [
  { value: "light", labelKey: "theme.light", icon: Sun03Icon },
  { value: "dark", labelKey: "theme.dark", icon: MoonSlowWindIcon },
  { value: "system", labelKey: "theme.system", icon: SunMoonIcon },
] satisfies Array<{
  value: Theme
  labelKey: "theme.light" | "theme.dark" | "theme.system"
  icon: typeof Sun03Icon
}>

type ThemeToggleProps = Pick<ComponentProps<typeof Button>, "variant" | "size">

export function ThemeToggle({
  variant = "secondary",
  size = "icon",
}: ThemeToggleProps = {}) {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const currentTheme =
    themeOptions.find((option) => option.value === theme) ?? themeOptions[2]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={variant}
            size={size}
            aria-label={t("theme.change", {
              theme: t(currentTheme.labelKey),
            })}
          />
        }
      >
        <HugeiconsIcon icon={currentTheme.icon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value: Theme) => setTheme(value)}
        >
          <DropdownMenuLabel>{t("theme.label")}</DropdownMenuLabel>
          {themeOptions.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              closeOnClick
            >
              <HugeiconsIcon icon={option.icon} strokeWidth={2} />
              {t(option.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
