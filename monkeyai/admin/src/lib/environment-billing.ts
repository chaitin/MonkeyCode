import type { EnvironmentBillingConfig, Resources } from "./environments"

const scale = 1_000_000n
const maxAmount = 1_000_000_000_000n * scale

function amount(value: string) {
  if (!/^\d{1,13}(?:\.\d{1,6})?$/.test(value))
    throw new Error("invalid_credits")
  const [whole, fraction = ""] = value.split(".")
  const result = BigInt(whole) * scale + BigInt(fraction.padEnd(6, "0"))
  if (result > maxAmount) throw new Error("invalid_credits")
  return result
}

function decimal(value: bigint) {
  const fraction = (value % scale)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
  return `${value / scale}${fraction ? `.${fraction}` : ""}`
}

export function environmentCreditPrice(value: string) {
  return decimal(amount(value.trim()))
}

export function environmentHourlyCredits(
  resource: Pick<Resources, "cpu_millis" | "memory_bytes">,
  pricing: Pick<
    EnvironmentBillingConfig,
    "cpu_credits_per_core_hour" | "memory_credits_per_gib_hour"
  >
) {
  if (
    !Number.isSafeInteger(resource.cpu_millis) ||
    resource.cpu_millis < 0 ||
    !Number.isSafeInteger(resource.memory_bytes) ||
    resource.memory_bytes < 0
  )
    throw new Error("invalid_resource")
  const gib = 1_073_741_824n
  const numerator =
    amount(pricing.cpu_credits_per_core_hour) *
      BigInt(resource.cpu_millis) *
      gib +
    amount(pricing.memory_credits_per_gib_hour) *
      BigInt(resource.memory_bytes) *
      1000n
  const denominator = 1000n * gib
  const result = (numerator + denominator / 2n) / denominator
  if (result > maxAmount) throw new Error("invalid_credits")
  return decimal(result)
}
