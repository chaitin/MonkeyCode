// 设计稿的 SVG 图标集(路径数据逐一取自设计稿,线宽/圆角保持一致)。
// 统一约定:size 为正方形边长,color 为描边/填充色,默认取次级文字色。
import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  color?: string;
  style?: CSSProperties;
}

const base: CSSProperties = { flex: "none", display: "block" };

/** 刷新(顺时针圆弧箭头) */
export function IconRefresh({ size = 11, color = "var(--t4)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <path
        d="M11.8 7a4.8 4.8 0 1 1-1.4-3.4M11.8 1.6v2.6H9.2"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 文件夹 */
export function IconFolder({ size = 13, color = "var(--t3)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <path
        d="M1.5 4a1.5 1.5 0 0 1 1.5-1.5h2.6l1.3 1.5H11A1.5 1.5 0 0 1 12.5 5.5v5A1.5 1.5 0 0 1 11 12H3a1.5 1.5 0 0 1-1.5-1.5V4z"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 文件(改动列表的文档图标,右上折角) */
export function IconFile({ size = 13, color = "var(--t4)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <path
        d="M3.5 2.8A1.3 1.3 0 0 1 4.8 1.5h3.4l2.3 2.3v7.4a1.3 1.3 0 0 1-1.3 1.3H4.8a1.3 1.3 0 0 1-1.3-1.3V2.8z"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8 1.7v2.5h2.4" stroke={color} strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

/** 铅笔(重命名) */
export function IconPencil({ size = 12, color = "var(--t3)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <path
        d="M2.3 9.7 9.2 2.8a1.25 1.25 0 0 1 1.77 0l.23.23a1.25 1.25 0 0 1 0 1.77L4.3 11.7l-2.6.6.6-2.6z"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 云(云端任务) */
export function IconCloud({ size = 14, color = "var(--t5)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ ...base, ...style }}>
      <path
        d="M4.5 12.5a3 3 0 0 1-.4-5.97 4 4 0 0 1 7.8-.03 2.75 2.75 0 0 1-.4 6H4.5z"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 显示器(本地会话) */
export function IconMonitor({ size = 14, color = "var(--t5)", strokeWidth = 1.2, style }: IconProps & { strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ ...base, ...style }}>
      <rect x="2" y="3.5" width="12" height="7.5" rx="1.4" stroke={color} strokeWidth={strokeWidth} />
      <path d="M5.5 13.5h5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}

/** 对话气泡 */
export function IconChat({ size = 14, color = "var(--t5)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ ...base, ...style }}>
      <path
        d="M3.2 3h9.6A1.7 1.7 0 0 1 14.5 4.7v5.1a1.7 1.7 0 0 1-1.7 1.7H7l-3.7 2v-2H3.2a1.7 1.7 0 0 1-1.7-1.7V4.7A1.7 1.7 0 0 1 3.2 3z"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M4.5 6.2h7M4.5 8.5h4.8" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/** 搜索 */
export function IconSearch({ size = 13, color = "var(--t5)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ ...base, ...style }}>
      <circle cx="7" cy="7" r="4.5" stroke={color} strokeWidth="1.25" />
      <path d="m10.4 10.4 3.2 3.2" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

/** 地球(浏览器) */
export function IconGlobe({ size = 14, color = "var(--t5)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ ...base, ...style }}>
      <circle cx="8" cy="8" r="6" stroke={color} strokeWidth="1.2" />
      <ellipse cx="8" cy="8" rx="2.6" ry="6" stroke={color} strokeWidth="1.1" />
      <path d="M2.3 6h11.4M2.3 10h11.4" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/** 加号 */
export function IconPlus({ size = 11, color = "var(--t4)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" style={{ ...base, ...style }}>
      <path d="M6 2v8M2 6h8" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** 右向 chevron(经 style transform rotate 表达展开态) */
export function IconChevronRight({ size = 10, color = "var(--t5)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" style={{ ...base, ...style }}>
      <path d="M3.5 2L7 5 3.5 8" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 下向 chevron(下拉指示) */
export function IconChevronDown({ size = 8, color = "var(--t6)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" style={{ ...base, ...style }}>
      <path d="M2 3.5 5 6.5 8 3.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** ⋯ 三点 */
export function IconDots({ size = 12, color = "var(--t3)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <circle cx="3" cy="7" r="1.1" fill={color} />
      <circle cx="7" cy="7" r="1.1" fill={color} />
      <circle cx="11" cy="7" r="1.1" fill={color} />
    </svg>
  );
}

/** 归档盒 */
export function IconArchive({ size = 12, color = "var(--t3)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <rect x="2" y="2.5" width="10" height="3" rx="1" stroke={color} strokeWidth="1.2" />
      <path d="M3 5.5v4A1.5 1.5 0 0 0 4.5 11h5A1.5 1.5 0 0 0 11 9.5v-4M5.5 7.5h3" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** 垃圾桶 */
export function IconTrash({ size = 12, color = "var(--err)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <path
        d="M2.5 3.5h9M5.5 3.5v-1h3v1M4 3.5l.5 7A1.5 1.5 0 0 0 6 12h2a1.5 1.5 0 0 0 1.5-1.5l.5-7"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 设置齿轮 */
export function IconGear({ size = 15, color = "var(--t3)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ ...base, ...style }}>
      <path
        d="M6.8 1.8h2.4l.3 1.6c.5.2 1 .4 1.4.8l1.6-.6 1.2 2-1.3 1.1c.05.25.1.55.1.85s-.05.6-.1.85l1.3 1.1-1.2 2-1.6-.6c-.4.35-.9.6-1.4.8l-.3 1.6H6.8l-.3-1.6c-.5-.2-1-.45-1.4-.8l-1.6.6-1.2-2 1.3-1.1A4.6 4.6 0 0 1 3.5 8c0-.3.03-.6.1-.85L2.3 6l1.2-2 1.6.6c.4-.35.9-.6 1.4-.8l.3-2z"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.9" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

/** 分支(改动) */
export function IconBranch({ size = 12, color = "var(--t3)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <path d="M4 2.5v6.2a2 2 0 1 0 1.3.05V4.8" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="4.6" cy="10.7" r="1.6" stroke={color} strokeWidth="1.2" />
      <circle cx="9.4" cy="3.3" r="1.6" stroke={color} strokeWidth="1.2" />
      <path d="M9.4 4.9v2.3a2 2 0 0 1-2 2h-.7" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** 时钟(排队) */
export function IconClock({ size = 13, color = "var(--t5)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.2" />
      <path d="M7 4v3.2l2.2 1.3" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 关闭 × */
export function IconX({ size = 9, color = "var(--t5)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" style={{ ...base, ...style }}>
      <path d="M2 2l6 6M8 2L2 8" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** 下载(托盘 + 下箭头) */
export function IconDownload({ size = 12, color = "var(--t3)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <path
        d="M2.5 9.8v1.4a1.3 1.3 0 0 0 1.3 1.3h6.4a1.3 1.3 0 0 0 1.3-1.3V9.8M7 2.4v6.8M4.2 6.4 7 9.2l2.8-2.8"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 上传(托盘 + 上箭头) */
export function IconUpload({ size = 12, color = "var(--t3)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <path
        d="M2.5 9.8v1.4a1.3 1.3 0 0 0 1.3 1.3h6.4a1.3 1.3 0 0 0 1.3-1.3V9.8M7 9.2V2.4M4.2 5.2 7 2.4l2.8 2.8"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 回形针(添加附件) */
export function IconPaperclip({ size = 13, color = "var(--t3)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <path
        d="M11.6 6.4 7.2 10.8a2.9 2.9 0 0 1-4.1-4.1L7.9 2a1.93 1.93 0 0 1 2.73 2.73L6.2 9.2a.97.97 0 0 1-1.37-1.37L8.9 3.8"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 斜杠指令(方框里的 /) */
export function IconSlash({ size = 13, color = "var(--t3)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <rect x="1.4" y="1.4" width="11.2" height="11.2" rx="3" stroke={color} strokeWidth="1.2" />
      <path d="M8.6 4.1 5.4 9.9" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** 发送(上箭头) */
export function IconSend({ size = 13, color = "var(--onAcc)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <path d="M7 11.5V2.8M3.2 6.3 7 2.5l3.8 3.8" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 盾牌(权限模式) */
export function IconShield({ size = 11, color = "var(--t3)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" style={{ ...base, ...style }}>
      <path d="M6 1.2 10 2.8v3c0 2.4-1.7 4.2-4 5-2.3-.8-4-2.6-4-5v-3L6 1.2z" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/** 对勾 */
export function IconCheck({ size = 10, color = "var(--ok)", strokeWidth = 1.5, style }: IconProps & { strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" style={{ ...base, ...style }}>
      <path d="M1.5 5.5 4 8l4.5-6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 任务待处理(空心圆角方框) */
export function IconTaskPending({ size = 12, color = "var(--t5)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <rect x="2" y="2" width="10" height="10" rx="2.2" stroke={color} strokeWidth="1.3" />
    </svg>
  );
}

/** 任务执行中(进度环) */
export function IconTaskRunning({ size = 12, color = "var(--accTx)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <circle cx="7" cy="7" r="5" stroke={color} strokeWidth="1.3" opacity=".25" />
      <path d="M7 2a5 5 0 0 1 5 5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="7" cy="2" r="1" fill={color} />
    </svg>
  );
}

/** 任务已完成(圆角方框勾选) */
export function IconTaskDone({ size = 12, color = "var(--ok)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <rect x="2" y="2" width="10" height="10" rx="2.2" stroke={color} strokeWidth="1.3" />
      <path d="m4.3 7.1 1.8 1.8 3.7-4" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 任务被依赖阻塞(圆圈斜杠) */
export function IconTaskBlocked({ size = 12, color = "var(--t4)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <circle cx="7" cy="7" r="5" stroke={color} strokeWidth="1.3" />
      <path d="m3.5 10.5 7-7" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** 思考火花 */
export function IconSpark({ size = 12, color = "var(--accTx)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" style={{ ...base, ...style }}>
      <path d="M6 1c.4 2.6 1.4 3.6 4 4-2.6.4-3.6 1.4-4 4-.4-2.6-1.4-3.6-4-4 2.6-.4 3.6-1.4 4-4z" fill={color} />
    </svg>
  );
}

/** 停止(实心圆角方块) */
export function IconStop({ size = 8, color = "var(--err)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" style={{ ...base, ...style }}>
      <rect width="8" height="8" rx="1.5" fill={color} />
    </svg>
  );
}

/** 感叹号圆圈(提示) */
export function IconInfo({ size = 13, color = "var(--warn)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ ...base, ...style }}>
      <circle cx="7" cy="7" r="5.8" stroke={color} strokeWidth="1.2" />
      <path d="M7 4.2v3.3M7 9.6v.4" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** 返回(左向 chevron) */
export function IconBack({ size = 10, color = "var(--t1)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" style={{ ...base, ...style }}>
      <path d="M6.5 2 3 5l3.5 3" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 以下三个与移动端 Icons(24 视框、1.7 描边)同路径,保证两端同一形状。

/** 皇冠(会员等级) */
export function IconCrown({ size = 13, color = "var(--accTx)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ ...base, ...style }}>
      <path d="M12 6l4 6l5-4l-2 10h-14l-2-10l5 4z" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 日历(每日签到) */
export function IconCalendar({ size = 13, color = "var(--t3)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ ...base, ...style }}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 复制(叠放的两个方框) */
export function IconCopy({ size = 12, color = "var(--t3)", style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ ...base, ...style }}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.2" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
      <path
        d="M5.5 15.5H5A1.5 1.5 0 0 1 3.5 14V5A1.5 1.5 0 0 1 5 3.5h9A1.5 1.5 0 0 1 15.5 5v.5"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
