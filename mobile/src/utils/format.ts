import type { ProjectTask } from '@/api/types';
import { modelLabel } from '@/config';

/** token 数格式化：1234 -> 1.2k */
export function formatTokens(n?: number): string {
  if (!n || n <= 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 任务展示名：优先总结标题(summary)，其次 title，再次 content 首行。 */
export function taskDisplayName(task?: ProjectTask | null, fallback = '未命名任务'): string {
  if (!task) return fallback;
  const summary = task.summary?.trim();
  if (summary) return summary;
  const title = task.title?.trim();
  if (title) return title;
  const content = task.content?.trim();
  if (content) return content.split('\n')[0].slice(0, 60);
  return fallback;
}

/** Unix 秒时间戳 -> 相对时间（中文）。非正数（含 Go 零值时间 -62135596800）视为无效。 */
export function fromNow(unixSeconds?: number): string {
  if (!unixSeconds || unixSeconds <= 0) return '';
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - unixSeconds);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400 / 30)} 个月前`;
  return `${Math.floor(diff / 86400 / 365)} 年前`;
}

/** Unix 秒时间戳 -> YYYY-MM-DD HH:mm */
export function formatDateTime(unixSeconds?: number): string {
  if (!unixSeconds) return '';
  const d = new Date(unixSeconds * 1000);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 取模型展示名（与选择器一致：内置名翻译为 基础/专业/旗舰模型）。 */
export function modelDisplayName(model?: { model?: string; remark?: string }): string {
  return modelLabel(model);
}

/** 任务卡片时间：已完成用 completed_at（>0 时），否则用创建时间。 */
export function taskTime(task?: ProjectTask | null): string {
  if (!task) return '';
  const done = task.completed_at;
  return fromNow(done && done > 0 ? done : task.created_at);
}
