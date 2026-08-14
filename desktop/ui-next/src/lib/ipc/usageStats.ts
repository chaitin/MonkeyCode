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

/** 行尾/头部展示用的 token 用量(子代理已归并进父任务)。 */
export interface TokenUsage {
  input: number;
  output: number;
  calls: number;
  models: { model: string; input_tokens: number; output_tokens: number; calls: number }[];
}

interface UsageAgg {
  input: number;
  output: number;
  calls: number;
  models: Map<string, { input: number; output: number; calls: number }>;
}

function addAgg(m: Map<string, UsageAgg>, sid: string, s: SessionRow) {
  let agg = m.get(sid);
  if (!agg) {
    agg = { input: 0, output: 0, calls: 0, models: new Map() };
    m.set(sid, agg);
  }
  agg.input += s.input_tokens;
  agg.output += s.output_tokens;
  agg.calls += s.calls;
  for (const md of s.models) {
    const cur = agg.models.get(md.model);
    agg.models.set(md.model, {
      input: (cur?.input ?? 0) + md.input_tokens,
      output: (cur?.output ?? 0) + md.output_tokens,
      calls: (cur?.calls ?? 0) + md.calls,
    });
  }
}

const aggToUsage = (a: UsageAgg): TokenUsage => ({
  input: a.input,
  output: a.output,
  calls: a.calls,
  models: a.models.size
    ? [...a.models.entries()].map(([model, v]) => ({ model, input_tokens: v.input, output_tokens: v.output, calls: v.calls }))
    : [],
});

/** 把 usage_stats 快照聚合为「会话 id → 用量」;子代理(parent 非空)归并进父任务。 */
export function buildSessionUsageMap(sessions: UsageStats["sessions"]): Map<string, TokenUsage> {
  const m = new Map<string, UsageAgg>();
  for (const s of sessions) {
    addAgg(m, s.session_id, s);
    if (s.parent) addAgg(m, s.parent, s);
  }
  const out = new Map<string, TokenUsage>();
  for (const [sid, agg] of m) out.set(sid, aggToUsage(agg));
  return out;
}

/** 把一组会话 id 的用量合并成一个合计(文件夹级展示用)。 */
export function sumUsage(ids: Iterable<string>, map: ReadonlyMap<string, TokenUsage>): TokenUsage | null {
  const agg: UsageAgg = { input: 0, output: 0, calls: 0, models: new Map() };
  let any = false;
  for (const id of ids) {
    const u = map.get(id);
    if (!u) continue;
    any = true;
    agg.input += u.input;
    agg.output += u.output;
    agg.calls += u.calls;
    for (const md of u.models) {
      const cur = agg.models.get(md.model);
      agg.models.set(md.model, {
        input: (cur?.input ?? 0) + md.input_tokens,
        output: (cur?.output ?? 0) + md.output_tokens,
        calls: (cur?.calls ?? 0) + md.calls,
      });
    }
  }
  return any ? aggToUsage(agg) : null;
}
