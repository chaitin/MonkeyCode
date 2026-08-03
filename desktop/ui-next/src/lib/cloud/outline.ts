// 云端任务提问大纲的锚定层(纯函数 + 一次性全量拉取)。
//
// 数据源:REST 提问索引(mc_task_user_inputs,倒序游标分页)+ 已回放对话流
// 里的用户消息;渲染与合并复用本地的 OutlineNav/outlineEntriesOf。与本地的
// 差别只在"锚":本地用壳编的帧 seq 对表,云端没有稳定 seq(仅 ClickHouse
// 存储带,Loki 没有),REST 索引与帧流之间唯一都有的键是时间戳——REST 是
// 纳秒、帧流是毫秒,纳秒超出 JS 安全整数还有精度漂移。对齐 Web
// (task-user-input-index-model)的方案:统一取整到 10ms 边界,以「10ms 单位
// 的整数」当大纲条目的 seq。
//
// 与旧 UI(cloudOutline.ts)的关键差异:锚**不回写进帧**。新归约链
// (reduce.ts::reduceBatch)按 seq 水位去重,把 user-input 的 seq 改成
// ~1.7e11 的时间锚会抬死水位、误杀后续所有真 seq 帧;所以锚只活在大纲
// 合并与跳转定位这一层,对话流状态原封不动。
import { mcTaskUserInputs, type CloudUserInputItem } from "@/lib/ipc/cloudtasks";
import type { OutlineItem } from "@/lib/ipc/controls";
import type { ChatItem } from "@/lib/protocol/types";

/** 任意精度时间戳 → 10ms 单位锚(REST 纳秒/帧流毫秒都能对上)。
 * 毫秒路径直接整除,不绕道纳秒:ms×1e6 会超出 Number 安全整数,
 * 乘完再除的舍入可能把锚推过 10ms 边界,两边就对不上了。 */
export function cloudOutlineAnchor(ts?: number): number | undefined {
  if (ts === undefined || !Number.isFinite(ts) || ts <= 0) return undefined;
  if (ts >= 1e17) return Math.floor(ts / 1e7); // ns
  if (ts >= 1e14) return Math.floor(ts / 1e4); // µs
  if (ts >= 1e11) return Math.floor(ts / 10); // ms
  return Math.floor(ts * 100); // s
}

/** REST 索引页(倒序)→ 正序 OutlineItem(seq=锚)。没有时间戳的条目丢弃:
 * 没锚就定位不了,留着只会是点不动的死条目。offset 云端无意义,恒 0;
 * timestamp ×10 回到毫秒(大纲时间列只精确到分,10ms 截断无感)。 */
export function cloudOutlineItems(items: CloudUserInputItem[]): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const it of items) {
    const anchor = cloudOutlineAnchor(it.timestamp);
    if (anchor === undefined) continue;
    out.push({ seq: anchor, offset: 0, text: it.content ?? "", timestamp: anchor * 10 });
  }
  return out.reverse();
}

/** 对话流投影:用户消息的 seq 换成时间锚(与 REST 索引同一坐标),喂给
 * outlineEntriesOf 做合并去重。只用于大纲计算,**不得**回喂渲染/归约
 * (缘由见文件头);无时间戳的用户消息剥掉 seq——原 seq 是另一套坐标
 * (轮次号/帧水位),混着当锚会和索引条目对不上号。 */
export function withCloudAnchors(items: readonly ChatItem[]): ChatItem[] {
  return items.map((it) => {
    if (it.kind !== "user") return it;
    const anchor = cloudOutlineAnchor(it.timestamp);
    if (anchor === undefined) {
      const { seq: _seq, ...rest } = it;
      return rest;
    }
    return { ...it, seq: anchor };
  });
}

/** 该锚对应的用户消息在对话流里的下标(-1 = 尚未加载,需补页)。
 * 读内存 items 而非 DOM:prepend 提交后立即可判,不赌渲染时序。 */
export function cloudAnchorIndex(items: readonly ChatItem[], anchor: number): number {
  return items.findIndex((it) => it.kind === "user" && cloudOutlineAnchor(it.timestamp) === anchor);
}

/** 全量拉取的护栏:5 页 × 100 条;超过的更早提问只能靠补页循环逐轮补。 */
export const MAX_INDEX_PAGES = 5;

/** 拉全量提问索引(倒序游标翻到头/护栏止)→ 正序 OutlineItem。
 * 失败向上抛,由调用方决定降级形态(大纲缺席可接受,但必须留痕)。 */
export async function fetchCloudOutline(
  id: string,
  fetchPage: typeof mcTaskUserInputs = mcTaskUserInputs,
): Promise<OutlineItem[]> {
  const all: CloudUserInputItem[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_INDEX_PAGES; page++) {
    const r = await fetchPage(id, cursor);
    all.push(...(r.items ?? []));
    if (!r.has_more || !r.next_cursor) break;
    cursor = r.next_cursor;
  }
  return cloudOutlineItems(all);
}
