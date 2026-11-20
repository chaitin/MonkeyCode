import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { api } from "@/lib/api"
import { LICENSE_STATUS_CHANGED } from "@/lib/license"
import {
  BrandingContext,
  DEFAULT_BRANDING,
  type Branding,
} from "@/lib/branding"

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState(DEFAULT_BRANDING)
  const [failedURL, setFailedURL] = useState("")
  const generation = useRef(0)
  const refreshBranding = useCallback(async (signal?: AbortSignal) => {
    const current = ++generation.current
    try {
      const value = await api<Partial<Branding>>("/api/auth/v1/branding", {
        signal,
      })
      if (signal?.aborted || current !== generation.current) return
      setFailedURL("")
      setBranding({
        workspace_name:
          value.workspace_name?.trim() || DEFAULT_BRANDING.workspace_name,
        product_name:
          value.product_name?.trim() || DEFAULT_BRANDING.product_name,
        logo_url: value.logo_url?.trim() || "",
        has_commercial_license: value.has_commercial_license === true,
      })
    } catch {
      if (!signal?.aborted && current === generation.current)
        setBranding(DEFAULT_BRANDING)
    }
  }, [])
  useEffect(() => {
    let controller: AbortController | undefined
    let disposed = false
    const load = () => {
      if (disposed) return
      controller?.abort()
      controller = new AbortController()
      void refreshBranding(controller.signal)
    }
    const refresh = () => {
      if (document.visibilityState === "visible") load()
    }
    void Promise.resolve().then(load)
    const timer = window.setInterval(refresh, 30_000)
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener(LICENSE_STATUS_CHANGED, load)
    window.addEventListener("monkeyai-license-changed", load)
    return () => {
      disposed = true
      controller?.abort()
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", refresh)
      window.removeEventListener(LICENSE_STATUS_CHANGED, load)
      window.removeEventListener("monkeyai-license-changed", load)
    }
  }, [refreshBranding])
  const logoURL = branding.logo_url !== failedURL ? branding.logo_url : ""
  const failLogo = useCallback(
    () => setFailedURL(branding.logo_url),
    [branding.logo_url]
  )
  useEffect(() => {
    if (!logoURL) return
    const image = new Image()
    image.onerror = failLogo
    image.src = logoURL
    return () => {
      image.onerror = null
    }
  }, [logoURL, failLogo])
  useEffect(() => {
    for (const rel of ["icon", "apple-touch-icon"]) {
      const link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
      if (link) {
        link.href = logoURL || "/monkeyai-logo.webp"
        if (rel === "icon") link.type = logoURL ? "image/png" : "image/webp"
      }
    }
  }, [logoURL])
  return (
    <BrandingContext.Provider
      value={{ branding, logoURL, refreshBranding, failLogo }}
    >
      {children}
    </BrandingContext.Provider>
  )
}
