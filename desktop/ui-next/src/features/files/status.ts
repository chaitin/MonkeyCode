// 改动状态 → 展示元数据(i18n 键 + badge 语义色)。本地 git 只产 A/M/D,
// 云端超集(R/RM/??)预留同表;badge 颜色类必须是完整字面量(Tailwind
// 静态扫描 + 类名禁拼接,拼进 className 的是整段字面量)。
import type { MessageKey } from "@/lib/i18n";

export interface StatusMeta {
  labelKey: MessageKey;
  /** 完整的 daisyUI badge 颜色类(badge-success / badge-warning / …) */
  badgeClass: string;
}

const STATUS_META: Record<string, StatusMeta> = {
  A: { labelKey: "files.status.added", badgeClass: "badge-success" },
  "??": { labelKey: "files.status.added", badgeClass: "badge-success" },
  M: { labelKey: "files.status.modified", badgeClass: "badge-warning" },
  D: { labelKey: "files.status.deleted", badgeClass: "badge-error" },
  RM: { labelKey: "files.status.deleted", badgeClass: "badge-error" },
  R: { labelKey: "files.status.renamed", badgeClass: "badge-info" },
};

export const statusMeta = (status: string): StatusMeta | undefined => STATUS_META[status];

export const basename = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/** 文件尺寸短格式(树的文件行右侧)。 */
export function fmtSize(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
