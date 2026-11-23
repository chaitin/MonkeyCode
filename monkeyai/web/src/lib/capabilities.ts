export type Capabilities = {
  allow_cloud_computer: boolean
  allow_custom_branding: boolean
}

export const NO_CAPABILITIES: Capabilities = {
  allow_cloud_computer: false,
  allow_custom_branding: false,
}

export function normalizeCapabilities(value: unknown): Capabilities {
  if (typeof value !== "object" || value === null) return NO_CAPABILITIES
  const fields = value as Partial<Capabilities>
  return {
    allow_cloud_computer: fields.allow_cloud_computer === true,
    allow_custom_branding: fields.allow_custom_branding === true,
  }
}
