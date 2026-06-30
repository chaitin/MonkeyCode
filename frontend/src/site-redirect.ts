export type SiteRegion = "cn" | "global"

const CN_SITE_HOST = "monkeycode-ai.com"
const GLOBAL_SITE_HOST = "monkeycode-ai.net"
const LOCAL_SITE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"])
const LANGUAGE_CHAIN_LIMIT = 2

type SiteLocation = Pick<Location, "hostname" | "pathname" | "search" | "hash">

export type SiteRedirectPrompt = {
  currentHost: string
  currentRegion: SiteRegion
  targetHost: string
  targetRegion: SiteRegion
  targetUrl: string
  detectedLanguages: string[]
}

export function getSiteRedirectUrl(
  location: SiteLocation | null = getCurrentLocation(),
  languages: readonly string[] = getBrowserLanguages(),
): string | null {
  return getSiteRedirectPrompt(location, languages)?.targetUrl || null
}

export function getSiteRedirectPrompt(
  location: SiteLocation | null = getCurrentLocation(),
  languages: readonly string[] = getBrowserLanguages(),
): SiteRedirectPrompt | null {
  if (!location) {
    return null
  }

  const { hostname, pathname, search, hash } = location
  if (!isSupportedSiteHost(hostname)) {
    return null
  }

  const detectedRegion: SiteRegion = languagesContainChinese(languages) ? "cn" : "global"
  const isLocalHost = isLocalSiteHost(hostname)
  const currentRegion = isLocalHost ? detectedRegion : getSiteRegion(hostname)
  const targetRegion = isLocalHost ? getOppositeSiteRegion(currentRegion) : detectedRegion
  const targetHost = getSiteHost(targetRegion)
  if (!isLocalHost && hostname === targetHost) {
    return null
  }

  return {
    currentHost: hostname,
    currentRegion,
    targetHost,
    targetRegion,
    targetUrl: `https://${targetHost}${pathname}${search}${hash}`,
    detectedLanguages: normalizeBrowserLanguages(languages),
  }
}

export function languagesContainChinese(languages: readonly string[]): boolean {
  return normalizeBrowserLanguages(languages)
    .slice(0, LANGUAGE_CHAIN_LIMIT)
    .some((language) => /^zh($|[-_])/i.test(language.trim()))
}

function normalizeBrowserLanguages(languages: readonly string[]): string[] {
  return languages
    .map((language) => language.trim())
    .filter(Boolean)
}

function getSiteRegion(hostname: string): SiteRegion {
  return hostname === CN_SITE_HOST ? "cn" : "global"
}

function getSiteHost(region: SiteRegion): string {
  return region === "cn" ? CN_SITE_HOST : GLOBAL_SITE_HOST
}

function isSupportedSiteHost(hostname: string): boolean {
  return hostname === CN_SITE_HOST || hostname === GLOBAL_SITE_HOST || isLocalSiteHost(hostname)
}

function isLocalSiteHost(hostname: string): boolean {
  return LOCAL_SITE_HOSTS.has(hostname)
}

function getOppositeSiteRegion(region: SiteRegion): SiteRegion {
  return region === "cn" ? "global" : "cn"
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
