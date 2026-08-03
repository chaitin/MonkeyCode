/** 千位缩写(旧 UI fmtK 同款):1234→1.2k、2345678→2.3M;运行条 tokens 摘要用。 */
export const fmtK = (n: number): string =>
  n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);

/** 消息/大纲时间戳:当天只显 HH:MM,跨天补 MM-DD,跨年再补年——任务跑
 * 好几天时,不同天的同一时刻不能长得一模一样。无效时间戳返回空串。 */
export function fmtClock(ts?: number, now: Date = new Date()): string {
  if (ts === undefined || !Number.isFinite(ts)) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const hhmm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate())
    return hhmm;
  const md = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hhmm}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}-${md}`;
}
