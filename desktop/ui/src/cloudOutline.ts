// 云端任务的提问大纲:数据源是 REST 提问索引(users/tasks/user-inputs,
// 倒序游标分页)+ 已归约对话流里的实时用户消息,渲染复用本地的 OutlineNav。
//
// 与本地的差别只在"锚":本地用壳编的帧 seq 对表,云端没有稳定 seq
// (仅 ClickHouse 存储带,Loki 没有),REST 索引与帧流之间唯一都有的键是
// 时间戳——REST 是纳秒、帧流是毫秒,且纳秒超出 JS 安全整数会有精度漂移。
// 对齐 Web(task-user-input-index-model)的方案:统一取整到 10ms 边界,
// 以「10ms 单位的整数」当 seq 喂给现成的大纲组件与 data-mc-seq 定位链。
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { mcTaskUserInputs } from "./cloudapi";
import {
  OUTLINE_JUMP_INSET,
  mergeLiveOutline,
  outlineActiveSeq,
  outlineEntries,
  type OutlineEntry,
} from "./outline";
import type { CloudUserInputItem, Frame, LogItem } from "./types";
import type { OutlineItem } from "./useSession";

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

/** user-input 帧盖章:seq 改写为时间戳锚(在 useCloudTask 的归约边界调用,
 * REST 回放与 WS 实时两路都会经过)。覆盖原 chunk seq 是刻意的:那是另一套
 * 坐标(轮次号/帧水位),混用两套锚,索引条目和气泡就对不上号。 */
export function withCloudOutlineAnchors(frames: Frame[]): Frame[] {
  return frames.map((f) => {
    if (f.type !== "user-input") return f;
    const anchor = cloudOutlineAnchor(f.timestamp);
    return anchor === undefined ? f : { ...f, seq: anchor };
  });
}

/** 帧集里是否已有该锚的 user-input(大纲跳转的补页终止条件):读内存帧集
 * 而非 DOM,prepend 后立即可判,不依赖 React 提交时序。 */
export function framesHaveAnchor(frames: Frame[], anchorSeq: number): boolean {
  return frames.some((f) => f.type === "user-input" && cloudOutlineAnchor(f.timestamp) === anchorSeq);
}

/** REST 索引页(倒序)→ 正序 OutlineItem。没有时间戳的条目丢弃:
 * 没锚就定位不了,留着只会是点不动的死条目。offset 云端无意义,恒 0。 */
export function cloudOutlineItems(items: CloudUserInputItem[]): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const it of items) {
    const anchor = cloudOutlineAnchor(it.timestamp);
    if (anchor === undefined) continue;
    // 锚是 10ms 单位,×10 回到毫秒(大纲时间列只精确到分,截断无感)
    out.push({ seq: anchor, offset: 0, text: it.content ?? "", timestamp: anchor * 10 });
  }
  return out.reverse();
}

/** 全量拉取的护栏:5 页 × 100 条;超过的更早提问只能靠"加载更早"逐轮补。 */
const MAX_INDEX_PAGES = 5;

/** 拉全量提问索引(挂载时一次;运行中新增的提问由实时合并兜住),
 * 与对话流合并成大纲条目。索引拿不到不影响任务本身,静默降级为
 * 只有实时条目。 */
export function useCloudOutline(id: string, items: LogItem[]): OutlineEntry[] {
  const [rest, setRest] = useState<OutlineItem[]>([]);
  useEffect(() => {
    setRest([]);
    let alive = true;
    void (async () => {
      const all: CloudUserInputItem[] = [];
      let cursor = "";
      for (let page = 0; page < MAX_INDEX_PAGES; page++) {
        const r = await mcTaskUserInputs(id, cursor);
        all.push(...(r.items ?? []));
        if (!r.has_more || !r.next_cursor) break;
        cursor = r.next_cursor;
      }
      if (alive) setRest(cloudOutlineItems(all));
    })().catch((e: unknown) => {
      // 大纲缺席可接受(降级为只有实时条目),但失败必须留痕:上次命令没进
      // capabilities 白名单,invoke 被拒就是被这里的静默吞掉才难查的
      console.warn("[cloud-outline] 提问索引拉取失败:", e);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return useMemo(() => outlineEntries(mergeLiveOutline(rest, items)), [rest, items]);
}

/** 大纲交互对视图的依赖面(CloudTaskHandle 的窄投影,避免反向依赖)。 */
export interface CloudOutlineNavHost {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 把历史翻到某锚已加载(补页循环在 hook 内,游标经 ref 推进) */
  ensureLoaded(anchorSeq: number): Promise<boolean>;
  unpin(): void;
}

/** 云端视图的大纲交互:当前项跟踪(滚动/帧批 rAF 节流重算,同 ChatView)
 * 与跳转。目标气泡不在 DOM 时先 ensureLoaded 补齐历史(useCloudTask 内
 * 大步长翻页),再重试定位——重试吸收 React 提交延迟,与本地 jumpWithRetry
 * 同款。 */
export function useCloudOutlineNav(id: string, items: LogItem[], host: CloudOutlineNavHost) {
  const entries = useCloudOutline(id, items);
  const [activeSeq, setActiveSeq] = useState<number | undefined>(undefined);
  const raf = useRef(0);
  // host 每次渲染都是新对象:跳转跨 await,经 ref 取最新
  const hostRef = useRef(host);
  hostRef.current = host;

  const updateActive = () => {
    const el = hostRef.current.scrollRef.current;
    const col = el?.firstElementChild;
    if (!el || !col) return;
    const elTop = el.getBoundingClientRect().top;
    const seq = outlineActiveSeq(
      Array.from(col.children, (kid) => {
        const raw = (kid as HTMLElement).dataset?.mcSeq;
        return { top: kid.getBoundingClientRect().top, seq: raw ? Number(raw) : undefined };
      }),
      elTop,
    );
    setActiveSeq((prev) => (prev === seq ? prev : seq));
  };
  const scheduleActive = () => {
    if (raf.current) return;
    raf.current = window.requestAnimationFrame(() => {
      raf.current = 0;
      updateActive();
    });
  };
  useEffect(scheduleActive, [items]);
  // 取消后必须把 id 清零:节流以「非零 = 已排队」判断,残留旧 id 会让它
  // 永远短路(StrictMode 双挂载即触发;与 ChatView 同一坑)
  useEffect(
    () => () => {
      window.cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );

  const jumpToSeq = (seq: number): boolean => {
    const el = hostRef.current.scrollRef.current;
    const col = el?.firstElementChild;
    const node = col?.querySelector<HTMLElement>(`[data-mc-seq="${seq}"]`);
    if (!el || !node) return false;
    // 云端流为跟看场景:先解除贴底,否则下一批帧立刻拽回底部
    hostRef.current.unpin();
    el.scrollTop += node.getBoundingClientRect().top - el.getBoundingClientRect().top - OUTLINE_JUMP_INSET;
    node.classList.remove("mc-jump-flash");
    void node.offsetWidth; // 重启动画
    node.classList.add("mc-jump-flash");
    window.setTimeout(() => node.classList.remove("mc-jump-flash"), 1000);
    return true;
  };

  // 帧已在内存但 React 可能还没提交到 DOM:重试吸收提交延迟(同 ChatView)
  const jumpWithRetry = (seq: number, tries = 12) => {
    if (jumpToSeq(seq)) return;
    if (tries <= 0) {
      // 走到这只剩坏数据(无时间戳的旧帧对不上锚):留痕即可,不打扰用户
      console.warn("[cloud-outline] 跳转目标未定位到:", seq);
      return;
    }
    window.setTimeout(() => jumpWithRetry(seq, tries - 1), 32);
  };

  const onJump = (e: OutlineEntry) =>
    void (async () => {
      if (jumpToSeq(e.seq)) return;
      await hostRef.current.ensureLoaded(e.seq);
      jumpWithRetry(e.seq);
    })();

  return { entries, activeSeq, onJump, onScrollTick: scheduleActive };
}
