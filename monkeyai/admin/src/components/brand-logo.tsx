import type { ComponentProps, ReactNode } from "react"
import { useBranding } from "@/hooks/use-branding"

export function BrandLogo({
  fallback,
  ...props
}: Omit<ComponentProps<"img">, "src" | "onError"> & { fallback?: ReactNode }) {
  const { logoURL, failLogo } = useBranding()
  if (!logoURL && fallback) return fallback
  return (
    <img
      {...props}
      src={logoURL || "/monkeyai-logo.webp"}
      onError={logoURL ? failLogo : undefined}
    />
  )
}
