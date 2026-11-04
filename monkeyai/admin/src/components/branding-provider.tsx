import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { api } from "@/lib/api"
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
      /* Keep working defaults when public branding is unavailable. */
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return refreshBranding(controller.signal)
    })
    return () => controller.abort()
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
