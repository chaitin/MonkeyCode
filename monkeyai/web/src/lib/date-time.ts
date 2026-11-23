export const TABLE_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number, string, string][] =
  [
    ["year", 365 * 86_400_000, "年", "年"],
    ["month", 30 * 86_400_000, "个月", "個月"],
    ["day", 86_400_000, "天", "天"],
    ["hour", 3_600_000, "小时", "小時"],
    ["minute", 60_000, "分钟", "分鐘"],
  ]

export function formatLastActivity(
  value: string,
  now: number,
  locale: string,
  formatter: Intl.RelativeTimeFormat
) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return "—"

  const elapsed = Math.max(0, now - timestamp)
  const isChinese = locale.startsWith("zh")
  const isTraditional = locale.toLowerCase().startsWith("zh-tw")
  if (elapsed < 60_000)
    return isChinese
      ? isTraditional
        ? "剛剛"
        : "刚刚"
      : formatter.format(0, "second")

  const [unit, duration, simplified, traditional] = RELATIVE_UNITS.find(
    ([, duration]) => elapsed >= duration
  ) ?? ["minute", 60_000, "分钟", "分鐘"]
  const count = Math.max(1, Math.floor(elapsed / duration))
  if (isChinese) {
    return `${count} ${isTraditional ? traditional : simplified}前`
  }
  return formatter.format(-count, unit)
}
