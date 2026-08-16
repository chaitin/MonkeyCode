// 提问大纲:正文左缘一列小点(每个 UserItem 一点),悬停浮出条目面板,
// 点条目滚到对应气泡。数据 = 壳的 session_outline 全量目录(含未加载进
// 对话流的更早提问)+ 流内实时用户消息合并(刚发的提问不等轮末物化)。
// 点本身不响应点击:目标太小,误点代价是整屏跳走;跳转由 ChatView 执行
// (锚不在 DOM 时按 entry.offset 经 ensureLoaded 精确补页)。
// activeSeq 当前项:点列以不透明度差加重当前点,面板项 menu-active +
// aria-current,打开时当前项滚入视野(移植旧 outline.tsx)。形态差异:
// 旧「浮窗跟随指针高度」不做——dropdown 锚定已确定面板落点。
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n";
import type { OutlineItem } from "@/lib/ipc/controls";
import { ATT_LINE } from "@/lib/protocol/attLine";
import type { ChatItem } from "@/lib/protocol/types";
import type { ChatState } from "@/lib/protocol/types";
import { timelineDeltaOf } from "@/lib/protocol/reduce";
import { fmtClock } from "@/lib/util/fmt";

const MAX_LABEL = 60;
const MAX_RAIL_DOTS = 12;

export interface OutlineEntry {
  /** 与 UserItem.seq / DOM 的 data-user-seq 对表。 */
  seq: number;
  /** 该轮在 replay.jsonl 的字节偏移(翻页锚点);流内实时条目还没物化,
   * 无偏移(它们必然已在 DOM,无需补页)。 */
  offset?: number;
  /** 摘要正文(空 = 纯附件/空消息,渲染层给兜底文案)。 */
  label: string;
  /** 剥离的附件行数(label 为空时兜底展示「N 个附件」)。 */
  attCount: number;
  /** 当天 HH:MM,跨天带日期(fmtClock);无可靠时间为空。 */
  time: string;
}

/** 目录 + 流内实时用户消息 → 合并去重的大纲条目。
 * 目录是磁盘数据,刚发的提问要等轮末物化;凡带 seq 的流内用户条目且目录
 * 没有的补到尾部(必然是最新几条,天然有序)。撞 seq 只留首条:seq 是
 * 跳转锚,两条同 seq 只能定位到同一气泡。目录条目带真实翻页 offset,
 * 流内补的没有(undefined)。 */
export function outlineEntriesOf(outline: OutlineItem[], items: readonly ChatItem[]): OutlineEntry[] {
  const merged: Array<{ seq: number; text: string; timestamp?: number; offset?: number }> = [...outline];
  const seen = new Set(outline.map((o) => o.seq));
  for (const it of items) {
    if (it.kind !== "user" || it.seq === undefined || seen.has(it.seq)) continue;
    seen.add(it.seq);
    merged.push({ seq: it.seq, text: it.text, ...(it.timestamp !== undefined ? { timestamp: it.timestamp } : {}) });
  }
  const out: OutlineEntry[] = [];
  const emitted = new Set<number>();
  for (const it of merged) {
    if (emitted.has(it.seq)) continue;
    emitted.add(it.seq);
    const body: string[] = [];
    let attCount = 0;
    for (const line of it.text.split("\n")) {
      if (ATT_LINE.test(line)) attCount += 1;
      else body.push(line);
    }
    const text = body.join(" ").replace(/\s+/g, " ").trim();
    const label = text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL)}…` : text;
    out.push({
      seq: it.seq,
      label,
      attCount,
      time: fmtClock(it.timestamp),
      ...(it.offset !== undefined ? { offset: it.offset } : {}),
    });
  }
  return out;
}

/** agent/thought 流式尾部更新不可能改变提问目录，直接复用上次结果；只有
 * user 行增删改或目录接口返回新值时才重新扫描。 */
type ItemProjector = (items: readonly ChatItem[]) => readonly ChatItem[];
const outlineProjectionCache = new WeakMap<
  ChatState,
  { outline: OutlineItem[]; projector?: ItemProjector; entries: OutlineEntry[] }
>();

function outlineEntriesIncremental(
  outline: OutlineItem[],
  state: ChatState,
  projector?: ItemProjector,
): OutlineEntry[] {
  const hit = outlineProjectionCache.get(state);
  if (hit?.outline === outline && hit.projector === projector) return hit.entries;
  const delta = timelineDeltaOf(state);
  const previous = delta ? outlineProjectionCache.get(delta.from) : undefined;
  if (previous?.outline === outline && previous.projector === projector && delta) {
    let affectsUsers = delta.kind === "prepend" || delta.kind === "reset";
    for (const index of delta.changed) {
      if (delta.from.items[index]?.kind === "user" || state.items[index]?.kind === "user") affectsUsers = true;
    }
    if (delta.kind === "append") {
      for (let index = delta.from.items.length; index < state.items.length; index++) {
        if (state.items[index]?.kind === "user") affectsUsers = true;
      }
    }
    if (!affectsUsers) {
      const next = { outline, ...(projector ? { projector } : {}), entries: previous.entries };
      outlineProjectionCache.set(state, next);
      return next.entries;
    }
  }
  const entries = outlineEntriesOf(outline, projector ? projector(state.items) : state.items);
  outlineProjectionCache.set(state, { outline, ...(projector ? { projector } : {}), entries });
  return entries;
}

export function useOutlineEntries(
  outline: OutlineItem[],
  state: ChatState,
  projector?: ItemProjector,
): OutlineEntry[] {
  return useMemo(() => outlineEntriesIncremental(outline, state, projector), [outline, state, projector]);
}

/** 点列常驻 + 悬停浮出面板(daisyUI dropdown 外壳,受控 dropdown-open)。
 * dropdown-right 让面板紧贴点列右缘、无空隙,指针点列↔面板不离开容器,
 * 容器级 mouseenter/leave 即可管开合(mouseleave 把绝对定位子面板算在内),
 * 旧 200ms 延时收起随空隙一起退役。
 *
 * memo:流式帧仍会高频更新 ChatView；长会话的大纲上千条，不拦的话每批
 * 都全量重建点列+面板。前提是调用方三个 props 全稳定:entries 已增量缓存,
 * activeSeq 是 state,onJump 必须 useCallback/ref 包稳(见 ChatView)。 */
export const OutlineNav = memo(function OutlineNav({
  entries,
  activeSeq,
  onJump,
}: {
  entries: OutlineEntry[];
  /** 当前视口所在的那次提问(点列加重 + 面板内高亮),ChatView 滚动跟踪。 */
  activeSeq?: number;
  onJump: (seq: number, offset?: number) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLUListElement>(null);

  // 当前项始终可见:提问多到面板要内滚时,打开就已经停在「我现在在哪」上
  // (移植旧 outline.tsx 的居中滚动;jsdom 几何全 0 时是无害空转)
  useEffect(() => {
    const box = panelRef.current;
    const target = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!open || !box || !target) return;
    box.scrollTop = Math.max(0, target.offsetTop - box.clientHeight / 2 + target.offsetHeight / 2);
  }, [open, activeSeq, entries.length]);

  // 一条提问的会话不值得占一条轨道
  if (entries.length < 2) return null;

  const labelOf = (e: OutlineEntry) =>
    e.label ||
    (e.attCount > 0 ? t("chat.outline.attachments", { count: e.attCount }) : t("chat.outline.emptyMsg"));

  const activeIndex = entries.findIndex((e) => e.seq === activeSeq);
  const railCenter = activeIndex >= 0 ? activeIndex : entries.length - 1;
  const railStart = Math.min(
    Math.max(0, railCenter - Math.floor(MAX_RAIL_DOTS / 2)),
    entries.length - Math.min(entries.length, MAX_RAIL_DOTS),
  );
  const railEntries = entries.slice(railStart, railStart + MAX_RAIL_DOTS);

  return (
    <nav
      aria-label={t("chat.outline.label")}
      className="pointer-events-none absolute inset-y-0 left-1 z-10 flex w-5 items-center"
    >
      {/* dropdown 外壳保持 overflow visible，避免裁剪绝对定位面板。外壳明确
          继承 nav（即消息区域）的高度，因此点列与面板都可用 max-h-full 严格
          受消息区域约束，不再拿 viewport 高度估算。 */}
      <div
        className={`dropdown dropdown-right dropdown-center pointer-events-auto flex h-full items-center ${open ? "dropdown-open" : ""}`}
        onMouseLeave={() => setOpen(false)}
      >
        <div
          data-outline-rail
          className="mc-no-scrollbar flex max-h-full flex-col items-center gap-1.5 overflow-x-hidden overflow-y-auto px-1.5 py-2"
        >
          {railEntries.map((e) => (
            // 当前点满不透明度、其余压暗:只用透明度差表达「在哪」,不换色
            <span
              key={e.seq}
              data-outline-dot={e.seq}
              aria-hidden
              className={`status shrink-0${e.seq === activeSeq ? "" : " opacity-40"}`}
              onMouseEnter={() => setOpen(true)}
            />
          ))}
        </div>
        {open && (
          <ul
            ref={panelRef}
            className="dropdown-content menu max-h-full w-64 flex-nowrap [&_li]:flex-nowrap overflow-x-hidden overflow-y-auto rounded-box bg-base-100 p-2 shadow-sm"
          >
            {entries.map((e) => (
              <li key={e.seq}>
                <button
                  type="button"
                  aria-current={e.seq === activeSeq ? "true" : undefined}
                  className={`flex items-baseline gap-2 ${e.seq === activeSeq ? "menu-active" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    onJump(e.seq, e.offset);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-left text-xs">{labelOf(e)}</span>
                  {e.time && <span className="shrink-0 text-2xs opacity-50">{e.time}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
});
