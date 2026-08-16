// 块级消息时间(块上方,用户/助手/思考/工具四类统一):HH:MM 悬停所在块
// (group 祖先)才显影——常驻是干扰信息(用户定案 2026-08-05 二次)。
// 恒占位只切透明度(§6.2 铁律不插布局);⚠️ 绝不挂 focus-within:点开
// 详情后焦点留在块内,时间/耗时会粘住不退(已踩过)。
// dateTime/title 保留完整时刻。跨天消息经 fmtClock 带上日期,任务跑几天
// 时不同天的同一时刻不再同貌(用户报障 2026-08-10)。
import { fmtClock } from "@/lib/util/fmt";

export function MessageTime({ timestamp, className = "" }: { timestamp?: number; className?: string }) {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const label = fmtClock(timestamp);
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toLocaleString()}
      className={`text-2xs text-base-content/40 tabular-nums opacity-0 transition-opacity select-none group-hover:opacity-100 ${className}`}
    >
      {label}
    </time>
  );
}
