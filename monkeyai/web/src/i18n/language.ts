export const DEFAULT_LANGUAGE = "en-US"
export const LANGUAGE_STORAGE_KEY = "monkeyai-admin-language"

export const LANGUAGE_OPTIONS = [
  { value: "en-US", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "ja-JP", label: "日本語" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "ko-KR", label: "한국어" },
  { value: "es-419", label: "Español" },
  { value: "fr-FR", label: "Français" },
  { value: "de-DE", label: "Deutsch" },
  { value: "ru-RU", label: "Русский" },
  { value: "ar", label: "العربية" },
] as const

export type SupportedLanguage = (typeof LANGUAGE_OPTIONS)[number]["value"]

export const SUPPORTED_LANGUAGES = LANGUAGE_OPTIONS.map(
  (language) => language.value
)

export function isSupportedLanguage(
  language: string | null
): language is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(language as SupportedLanguage)
}

export function matchSupportedLanguage(
  language: string
): SupportedLanguage | null {
  const normalized = language.trim().replaceAll("_", "-").toLowerCase()
  const exactMatch = LANGUAGE_OPTIONS.find(
    (option) => option.value.toLowerCase() === normalized
  )

  if (exactMatch) {
    return exactMatch.value
  }

  if (normalized === "zh" || normalized.startsWith("zh-")) {
    const usesTraditionalChinese = normalized
      .split("-")
      .some((part) => ["hant", "tw", "hk", "mo"].includes(part))

    return usesTraditionalChinese ? "zh-TW" : "zh-CN"
  }

  const languageMatches: ReadonlyArray<
    readonly [languageCode: string, supportedLanguage: SupportedLanguage]
  > = [
    ["en", "en-US"],
    ["ja", "ja-JP"],
    ["ko", "ko-KR"],
    ["es", "es-419"],
    ["fr", "fr-FR"],
    ["de", "de-DE"],
    ["ru", "ru-RU"],
    ["ar", "ar"],
  ]

  for (const [languageCode, supportedLanguage] of languageMatches) {
    if (
      normalized === languageCode ||
      normalized.startsWith(`${languageCode}-`)
    ) {
      return supportedLanguage
    }
  }

  return null
}

export function detectBrowserLanguage(
  languages: readonly string[]
): SupportedLanguage {
  for (const language of languages) {
    const match = matchSupportedLanguage(language)
    if (match) {
      return match
    }
  }

  return DEFAULT_LANGUAGE
}

export function getLanguageDirection(language: string): "ltr" | "rtl" {
  return matchSupportedLanguage(language) === "ar" ? "rtl" : "ltr"
}
