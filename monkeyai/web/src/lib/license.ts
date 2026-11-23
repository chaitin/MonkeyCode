export type LicenseInfo = {
  state: "missing" | "valid" | "expired" | "invalid"
  product_type?: string
  client_name?: string
  client_id?: string
  custom_product_name?: string
  machine_ids?: string[]
  max_members?: number
  not_valid_before?: number
  not_valid_after?: number
}

export const LICENSE_STATUS_CHANGED = "monkeyai:license-status-changed"

export function publishLicenseStatus(info: LicenseInfo) {
  window.dispatchEvent(
    new CustomEvent<LicenseInfo>(LICENSE_STATUS_CHANGED, { detail: info })
  )
}
