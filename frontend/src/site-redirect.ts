const CN_SITE_HOST = "monkeycode-ai.com"
const GLOBAL_SITE_HOST = "monkeycode-ai.net"
const LANGUAGE_CHAIN_LIMIT = 2

type SiteLocation = Pick<Location, "hostname" | "pathname" | "search" | "hash">

export function getSiteRedirectUrl(
  location: SiteLocation | null = getCurrentLocation(),
  languages: readonly string[] = getBrowserLanguages(),
): string | null {
  if (!location) {
    return null
  }

  const { hostname, pathname, search, hash } = location
  if (hostname !== CN_SITE_HOST && hostname !== GLOBAL_SITE_HOST) {
    return null
  }

  const targetHost = languagesContainChinese(languages) ? CN_SITE_HOST : GLOBAL_SITE_HOST
  if (hostname === targetHost) {
    return null
  }

  return `https://${targetHost}${pathname}${search}${hash}`
}

export function languagesContainChinese(languages: readonly string[]): boolean {
  return languages
    .slice(0, LANGUAGE_CHAIN_LIMIT)
    .some((language) => /^zh($|[-_])/i.test(language.trim()))
}

function getCurrentLocation(): SiteLocation | null {
  if (typeof window === "undefined") {
    return null
  }

  return window.location
}

function getBrowserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") {
    return []
  }

  if (navigator.languages.length > 0) {
    return navigator.languages
  }

  return navigator.language ? [navigator.language] : []
}
