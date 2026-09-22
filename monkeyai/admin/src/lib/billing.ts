export type Policy = {
  input_credits_per_million_tokens: string
  cached_input_credits_per_million_tokens: string
  output_credits_per_million_tokens: string
  quota_refresh_cycle: "daily" | "weekly" | "monthly"
  charging_mode: "local" | "remote"
  enabled: boolean
  pending_cycle?: string
  cycle_effective_at?: string
  revision: number
}
export type WalletInfo = {
  configured: boolean
  credentials_configured: boolean
  source?: "admin" | "environment"
  error?: string
  base_url?: string
  app_id?: number
  certificate_expires_at?: string
}
export type BillingSettings = {
  policy: Policy
  wallet: WalletInfo
  timezone: string
  next_refresh_at: string
}
export type QuotaGroup = {
  id: string
  parent_id: string | null
  name: string
  credits: string | null
  allow_inherit: boolean
}
export type QuotaUser = {
  id: string
  name: string
  email: string
  status: string
  group_ids: string[]
  credits: string | null
  effective_credits: string
  inherited_from: string
  external_user_id?: string
}
export type Quotas = {
  groups: QuotaGroup[]
  users: QuotaUser[]
  revision: number
  effective_at: string
}
export function userQuota(
  user: QuotaUser,
  groups: QuotaGroup[],
  changes: Record<string, string | null> = {}
) {
  const value = (type: string, id: string, saved: string | null) =>
    changes[`${type}:${id}`] !== undefined ? changes[`${type}:${id}`] : saved
  const inheritedFrom = (id: string): string => {
    let group = groups.find((group) => group.id === id)
    for (let depth = 0; group && depth <= 100; depth++) {
      const credits = value("group", group.id, group.credits)
      if (credits !== null) return credits
      const parent = group.parent_id
      group = groups.find((group) => group.id === parent)
    }
    return "15000"
  }
  const amount = (credits: string) => {
    const [whole, fraction = ""] = credits.split(".")
    return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))
  }
  const inherited = user.group_ids
    .map(inheritedFrom)
    .reduce(
      (highest, next) => (amount(next) > amount(highest) ? next : highest),
      "0"
    )
  const own = value("user", user.id, user.credits)
  return { own, inherited, effective: own ?? inherited }
}

export type Account = {
  version: string
  id: string
  user_id: string
  balance: string
  frozen: string
  available: string
  quota: string
  period_start_at: string
  period_end_at: string
}
export type AccountDetails = {
  account: Account
  history: Account[]
  wallet: WalletInfo
  external_user_id: string
  wallet_available?: string
  wallet_queried_at?: string
  wallet_error?: string
}
export type Entry = {
  id: string
  transaction_id: string | null
  user_id: string
  user_name: string
  user_email: string
  category: string
  entry_type: string
  item_name: string
  credit_delta: string
  balance_after: string
  mode: string
  occurred_at: string
  sequence: string
}
export type Transaction = {
  id: string
  user_name: string
  user_email: string
  category: string
  item_name: string
  mode: string
  status: string
  reserve: string
  amount: string | null
  raw_amount: string | null
  error_code: string
  attempts: number
  started_at: string
  session_id?: string
  request_id?: string
  pricing?: Record<string, string>
  usage?: {
    input_tokens: number
    cached_input_tokens: number
    output_tokens: number
    generated_images?: number
    known: boolean
    stream?: boolean
    result: string
    error_code?: string
    terminal_event?: string
    initial_error_code?: string
    reconciled?: boolean
  }
  entries?: Entry[]
  wallet_records?: {
    biz_id: string
    status: string
    error_code: string
    trace_id: string
  }[]
}
export const cycleNames: Record<string, string> = {
  daily: "每日",
  weekly: "每周",
  monthly: "每月",
}
export const stateNames: Record<string, string> = {
  created: "预扣中",
  reserved: "已预留",
  running: "执行中",
  settling: "待结算",
  settled: "已结算",
  released: "已释放",
  rejected: "已拒绝",
  unknown: "待核查",
}
export const entryNames: Record<string, string> = {
  charge: "扣费",
  grant: "发放",
  reset: "重置",
  refund: "退款",
  adjustment: "调整",
}
export type CreditRoundingMode = "half-up" | "ceil" | "floor" | "expand"

export function credits(
  value: string | null | undefined,
  locale = "zh-CN",
  fractionDigits?: number,
  roundingMode: CreditRoundingMode = "half-up"
) {
  if (value == null) return "—"
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) return value
  const formatter = new Intl.NumberFormat(locale)
  const decimal =
    formatter.formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? "."
  if (fractionDigits !== undefined) {
    const digits = Math.max(0, Math.trunc(fractionDigits))
    const scale = 10n ** BigInt(digits)
    const rawFraction = match[3] ?? ""
    const padded = rawFraction.padEnd(digits + 1, "0")
    let scaled =
      BigInt(match[2]) * scale +
      BigInt(digits > 0 ? padded.slice(0, digits) : "0")
    const discarded = padded
      .slice(digits)
      .split("")
      .some((digit) => digit !== "0")
    const increment =
      (roundingMode === "half-up" && padded[digits] >= "5") ||
      (roundingMode === "expand" && discarded) ||
      (roundingMode === "ceil" && match[1] !== "-" && discarded) ||
      (roundingMode === "floor" && match[1] === "-" && discarded)
    if (increment) scaled += 1n
    const whole = formatter.format(scaled / scale)
    const fraction =
      digits > 0 ? (scaled % scale).toString().padStart(digits, "0") : ""
    return `${match[1]}${whole}${fraction ? decimal + fraction : ""}`
  }
  const fraction = (match[3] ?? "").replace(/0+$/, "")
  return `${match[1]}${formatter.format(BigInt(match[2]))}${fraction ? decimal + fraction : ""}`
}
export const validCredits = (value: string, signed = false) =>
  (signed ? /^-?\d{1,12}(\.\d{1,6})?$/ : /^\d{1,12}(\.\d{1,6})?$/).test(value)
export function dateTime(value?: string) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "—"
}
