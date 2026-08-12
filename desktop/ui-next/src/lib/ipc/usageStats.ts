// 本地会话 token 用量统计(壳侧 usage 事件记账,按天/会话/模型聚合)。
// 浏览器模式无此能力:列表类返回空聚合(静态事实)。
import { inDesktopShell, invoke } from "./ipc";

export interface UsageStats {
  totals: Bucket;
  /** 按天汇总,倒序 */
  days: (DayRow & Bucket)[];
  /** 按模型汇总,用量倒序 */
  models: ModelRow[];
  /** 按会话汇总,用量倒序;子代理会话带 parent 可归并到父任务 */
  sessions: SessionRow[];
}

export interface Bucket {
  input_tokens: number;
  output_tokens: number;
  calls: number;
}

export interface DayRow extends Bucket {
  date: string;
}

export interface ModelRow extends Bucket {
  model: string;
}

export interface SessionRow extends Bucket {
  session_id: string;
  title: string;
  /** 子代理会话的父会话 id;顶层任务为 null */
  parent: string | null;
  days: (DayRow & Bucket)[];
  models: ModelRow[];
}

/** 壳内失败会抛(引擎重启时降级成空聚合会把面板洗成"全零")。 */
export async function usageStats(): Promise<UsageStats> {
  if (!inDesktopShell()) {
    return { totals: { input_tokens: 0, output_tokens: 0, calls: 0 }, days: [], models: [], sessions: [] };
  }
  return invoke<UsageStats>("usage_stats");
}
