import { LanguagesIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ComponentProps } from "react"
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
import {
  changeLanguage,
  DEFAULT_LANGUAGE,
  LANGUAGE_OPTIONS,
  matchSupportedLanguage,
  type SupportedLanguage,
} from "@/i18n"

type LanguageToggleProps = Pick<
  ComponentProps<typeof Button>,
  "variant" | "size"
>

export function LanguageToggle({
  variant = "secondary",
  size = "icon",
}: LanguageToggleProps = {}) {
  const { t, i18n } = useTranslation()
  const currentLanguage =
    matchSupportedLanguage(i18n.resolvedLanguage ?? i18n.language) ??
    DEFAULT_LANGUAGE

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={variant}
            size={size}
            aria-label={t("language.change")}
          />
        }
      >
        <HugeiconsIcon icon={LanguagesIcon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup
          value={currentLanguage}
          onValueChange={(language: SupportedLanguage) => {
            void changeLanguage(language)
          }}
        >
          <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
          {LANGUAGE_OPTIONS.map((language) => (
            <DropdownMenuRadioItem
              key={language.value}
              value={language.value}
              closeOnClick
            >
              {language.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
