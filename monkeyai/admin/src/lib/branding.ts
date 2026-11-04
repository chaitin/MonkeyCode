import { createContext } from "react"

export type Branding = {
  workspace_name: string
  product_name: string
  logo_url: string
  has_commercial_license: boolean
}

export const DEFAULT_BRANDING: Branding = {
  workspace_name: "Monkey AI",
  product_name: "MonkeyAI",
  logo_url: "",
  has_commercial_license: false,
}

export const BrandingContext = createContext<{
  branding: Branding
  logoURL: string
  refreshBranding: () => Promise<void>
  failLogo: () => void
}>({
  branding: DEFAULT_BRANDING,
  logoURL: "",
  refreshBranding: async () => {},
  failLogo: () => {},
})
