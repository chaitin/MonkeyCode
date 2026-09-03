import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import { ar } from "@/i18n/locales/ar"
import { deDE } from "@/i18n/locales/de-DE"
import { enUS } from "@/i18n/locales/en-US"
import { es419 } from "@/i18n/locales/es-419"
import { frFR } from "@/i18n/locales/fr-FR"
import { jaJP } from "@/i18n/locales/ja-JP"
import { koKR } from "@/i18n/locales/ko-KR"
import { ruRU } from "@/i18n/locales/ru-RU"
import { zhCN } from "@/i18n/locales/zh-CN"
import { zhTW } from "@/i18n/locales/zh-TW"
import {
  DEFAULT_LANGUAGE,
  detectBrowserLanguage,
  getLanguageDirection,
  isSupportedLanguage,
  LANGUAGE_STORAGE_KEY,
  matchSupportedLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "@/i18n/language"

export {
  DEFAULT_LANGUAGE,
  detectBrowserLanguage,
  getLanguageDirection,
  isSupportedLanguage,
  LANGUAGE_OPTIONS,
  LANGUAGE_STORAGE_KEY,
  matchSupportedLanguage,
  type SupportedLanguage,
} from "@/i18n/language"

function readStoredLanguage(): SupportedLanguage | null {
  try {
    const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isSupportedLanguage(storedLanguage) ? storedLanguage : null
  } catch {
    return null
  }
}

const browserLanguages =
  navigator.languages.length > 0 ? navigator.languages : [navigator.language]
const initialLanguage =
  readStoredLanguage() ?? detectBrowserLanguage(browserLanguages)

void i18n.use(initReactI18next).init({
  resources: {
    "en-US": { translation: enUS },
    "zh-CN": { translation: zhCN },
    "ja-JP": { translation: jaJP },
    "zh-TW": { translation: zhTW },
    "ko-KR": { translation: koKR },
    "es-419": { translation: es419 },
    "fr-FR": { translation: frFR },
    "de-DE": { translation: deDE },
    "ru-RU": { translation: ruRU },
    ar: { translation: ar },
  },
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  load: "currentOnly",
  interpolation: {
    escapeValue: false,
  },
})

function applyDocumentLanguage(language: string) {
  const resolvedLanguage = matchSupportedLanguage(language) ?? DEFAULT_LANGUAGE

  document.documentElement.lang = resolvedLanguage
  document.documentElement.dir = getLanguageDirection(resolvedLanguage)
}

applyDocumentLanguage(initialLanguage)
i18n.on("languageChanged", applyDocumentLanguage)

export async function changeLanguage(language: SupportedLanguage) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // The language can still change when storage is unavailable.
  }
  await i18n.changeLanguage(language)
}

export default i18n
