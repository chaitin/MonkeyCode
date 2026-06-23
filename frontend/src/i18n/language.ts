import dayjs from "dayjs"

export type AppLanguage = "cn" | "en"

export const LANGUAGE_COOKIE_NAME = "language"

const LANGUAGE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

const languageSettings: Record<
  AppLanguage,
  {
    dayjsLocale: string
    htmlLang: string
  }
> = {
  cn: {
    dayjsLocale: "zh-cn",
    htmlLang: "zh-CN",
  },
  en: {
    dayjsLocale: "en",
    htmlLang: "en",
  },
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === "cn" || value === "en"
}

export function detectLanguageFromBrowser(language: string | null | undefined = ""): AppLanguage {
  return /^zh($|[-_])/i.test((language ?? "").trim()) ? "cn" : "en"
}

export function resolveInitialLanguage(
  cookieLanguage: string | null | undefined,
  browserLanguage: string | null | undefined = "",
): AppLanguage {
  if (isAppLanguage(cookieLanguage)) {
    return cookieLanguage
  }

  return detectLanguageFromBrowser(browserLanguage)
}

export function getHtmlLang(language: AppLanguage): string {
  return languageSettings[language].htmlLang
}

export function getDayjsLocale(language: AppLanguage): string {
  return languageSettings[language].dayjsLocale
}

export function buildLanguageCookie(
  language: AppLanguage,
  maxAgeSeconds = LANGUAGE_COOKIE_MAX_AGE_SECONDS,
): string {
  return `${LANGUAGE_COOKIE_NAME}=${language}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`
}

export function getCookieValue(cookie: string, name: string): string | undefined {
  const prefix = `${name}=`

  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length)
}

export function readLanguageCookie(cookie = getDocumentCookie()): string | undefined {
  return getCookieValue(cookie, LANGUAGE_COOKIE_NAME)
}

export function writeLanguageCookie(language: AppLanguage) {
  if (typeof document === "undefined") {
    return
  }

  document.cookie = buildLanguageCookie(language)
}

export function applyLanguage(language: AppLanguage) {
  writeLanguageCookie(language)
  dayjs.locale(getDayjsLocale(language))

  if (typeof document !== "undefined") {
    document.documentElement.lang = getHtmlLang(language)
  }
}

export function initLanguage(): AppLanguage {
  const language = resolveInitialLanguage(readLanguageCookie(), getBrowserLanguage())
  applyLanguage(language)
  return language
}

function getDocumentCookie(): string {
  if (typeof document === "undefined") {
    return ""
  }

  return document.cookie
}

function getBrowserLanguage(): string {
  if (typeof navigator === "undefined") {
    return ""
  }

  return navigator.language || ""
}
