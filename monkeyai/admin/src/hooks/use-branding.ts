import { useContext } from "react"
import { BrandingContext } from "@/lib/branding"

export function useBranding() {
  return useContext(BrandingContext)
}
