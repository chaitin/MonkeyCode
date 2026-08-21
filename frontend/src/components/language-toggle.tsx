import { Languages } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { setAppLanguage } from "@/i18n"
import { isAppLanguage, type AppLanguage } from "@/i18n/language"

export function LanguageToggle() {
  const { i18n, t } = useTranslation()
  const currentLanguage: AppLanguage = isAppLanguage(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : "en"

  const changeLanguage = (language: string) => {
    if (isAppLanguage(language) && language !== currentLanguage) {
      void setAppLanguage(language)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={t("common.language.switch")}
          className="min-w-9"
        >
          <Languages aria-hidden="true" />
          <span className="hidden sm:inline">
            {t(`common.language.${currentLanguage}`)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>{t("common.language.switch")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={currentLanguage}
          onValueChange={changeLanguage}
        >
          <DropdownMenuRadioItem value="cn">
            {t("common.language.cn")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en">
            {t("common.language.en")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
