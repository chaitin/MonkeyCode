// 提问大纲:正文左缘一列小点(收起态),鼠标浮上去整条展开成浮窗,点浮窗里
// 的某一条就滚到那次提问。
//
// 数据来自壳的 session_outline —— **全量**,包含尚未加载进对话流的更早提问
// (条目自带那一轮在 replay.jsonl 的字节偏移,点到时由调用方先补历史再定位)。
// 点本身不响应点击:6px 的目标太小,误点代价是整屏跳走。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ATT_LINE } from "./logView";
import type { LogItem } from "./types";
import type { OutlineItem } from "./useSession";

export interface OutlineEntry {
  /** 与 LogItem.user.seq 对表,用于定位 DOM 与高亮当前项 */
  seq: number;
  /** 该轮在 replay.jsonl 的字节偏移(翻页锚点) */
  offset: number;
  label: string;
  time: string;
}

const MAX_LABEL = 60;

/** 大纲跳转后，目标气泡与日志视口顶部之间保留的呼吸空间。当前项判定必须
 * 使用同一条线，否则目标停在这条线时仍会把上一问标绿。 */
export const OUTLINE_JUMP_INSET = 12;

export function outlineActiveSeq(
  items: Iterable<{ top: number; seq?: number }>,
  viewportTop: number,
): number | undefined {
  let seq: number | undefined;
  for (const item of items) {
    // 给布局的亚像素取整留 1px 余量，避免恰好对齐时来回跳。
    if (item.top - viewportTop > OUTLINE_JUMP_INSET + 1) break;
    if (item.seq !== undefined && Number.isFinite(item.seq)) seq = item.seq;
  }
  return seq;
}

/** 大纲目录 + 对话流里的实时用户消息 → 合并视图。
 *
 * 目录(壳的 session_outline / 云端 user-inputs 索引)是磁盘/服务端数据,
 * 刚发出的提问要等落盘/轮末物化才进得去——帧落盘还是异步写线程,回显到达
 * 时读盘未必看得见。最新一条只能从已归约的对话流里拿:凡带 seq 的用户
 * 条目且目录里没有的,按流内顺序补到尾部(它们必然是最新的几条,天然有序)。
 * 同 seq 以目录为准:目录条目带真实翻页偏移,流内补的只有 0。 */
export function mergeLiveOutline(items: OutlineItem[], logItems: LogItem[]): OutlineItem[] {
  const seen = new Set(items.map((it) => it.seq));
  const tail: OutlineItem[] = [];
  for (const it of logItems) {
    if (it.kind !== "user" || it.seq === undefined || seen.has(it.seq)) continue;
    seen.add(it.seq);
    tail.push({ seq: it.seq, offset: 0, text: it.text, ...(it.timestamp !== undefined ? { timestamp: it.timestamp } : {}) });
  }
  return tail.length ? [...items, ...tail] : items;
}

function hhmm(ts?: number): string {
  if (ts === undefined || !Number.isFinite(ts)) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 大纲条目文案:剥掉附件行(与用户气泡同一 ATT_LINE 约定)、压平空白、截断。
 * 纯附件消息没有正文,回退成附件计数,不能出现空条目。
 *
 * 撞 seq 的条目只留首条:seq 是跳转与高亮的锚,重复意味着历史帧撞号
 * (旧版壳在恢复期间收输入会重编帧号),两条同 seq 只能定位到同一气泡,
 * 留着第二条只会两点同亮、点了跳错。 */
export function outlineEntries(items: OutlineItem[]): OutlineEntry[] {
  const seen = new Set<number>();
  const out: OutlineEntry[] = [];
  for (const it of items) {
    if (seen.has(it.seq)) continue;
    seen.add(it.seq);
    const body: string[] = [];
    let atts = 0;
    for (const line of it.text.split("\n")) {
      if (ATT_LINE.test(line)) atts += 1;
      else body.push(line);
    }
    const text = body.join(" ").replace(/\s+/g, " ").trim();
    const label = text
      ? text.length > MAX_LABEL
        ? text.slice(0, MAX_LABEL) + "…"
        : text
      : atts > 0
        ? `📎 ${atts} 个附件`
        : "(空消息)";
    out.push({ seq: it.seq, offset: it.offset, label, time: hhmm(it.timestamp) });
  }
  return out;
}

/** 一列小点常驻,鼠标落到点上时在右侧浮出大纲;点条目跳转。
 *
 * 两条不变式,破了就会闪:
 * ① **点列任何时候都可命中**——展开时把它藏起来(opacity/pointer-events)会
 *    让指针脚下的元素凭空消失,浏览器立刻重判命中 → mouseleave → 关闭 →
 *    点列回来 → 再触发,来回死循环。
 * ② **浮窗浮在点列右侧,不盖住它**——盖住就等于把触发源换成了浮窗自己,
 *    指针只要不在浮窗矩形内(比如浮窗短、指针在下方的点上)就同样断链。
 * 指针从点移到浮窗要跨一小段空白,靠 200ms 延时收起兜住。 */
export function OutlineNav({
  entries,
  activeSeq,
  onJump,
}: {
  entries: OutlineEntry[];
  /** 当前视口所在的那次提问(点加粗 + 浮窗内高亮) */
  activeSeq?: number;
  onJump: (entry: OutlineEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  /** 浮窗纵向落点:以指针进入时的高度为中心,再夹在可视区内 */
  const [top, setTop] = useState(0);
  const pointerY = useRef(0);
  const closeTimer = useRef(0);
  const navRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  // 浮窗跟着指针高度走(而不是钉在顶部或中间):否则鼠标在下方的点上,
  // 浮窗却在老远的地方弹出来
  useLayoutEffect(() => {
    const nav = navRef.current;
    const panel = panelRef.current;
    if (!open || !nav || !panel) return;
    const limit = Math.max(8, nav.clientHeight - panel.offsetHeight - 8);
    const next = Math.round(Math.min(Math.max(pointerY.current - panel.offsetHeight / 2, 8), limit));
    if (next !== top) setTop(next);
  }, [open, top, entries.length]);

  // 当前项始终可见:提问多到浮窗要内滚时,打开就已经停在"我现在在哪"上
  useEffect(() => {
    const box = open ? panelRef.current : railRef.current;
    const target = box?.querySelector<HTMLElement>('[data-outline-current="true"]');
    if (!box || !target) return;
    box.scrollTop = Math.max(0, target.offsetTop - box.clientHeight / 2 + target.offsetHeight / 2);
  }, [open, activeSeq, entries.length]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // 一条提问的会话不值得占一条轨道
  if (entries.length < 2) return null;

  const enter = (e?: { clientY: number }) => {
    window.clearTimeout(closeTimer.current);
    const box = navRef.current?.getBoundingClientRect();
    if (e && box && !open) pointerY.current = e.clientY - box.top;
    setOpen(true);
  };
  const leave = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 200);
  };

  return (
    <nav
      ref={navRef}
      aria-label="提问大纲"
      style={{
        position: "absolute",
        // 不贴窗口左缘;浮窗在点列右侧(见 .mc-outline-panel)。
        // top/bottom 贴满的是 ChatView 根(高度恒定),不是日志视口——
        // 参照物会变的话,居中的点列会随任务面板长高而上移。
        left: 10,
        top: 0,
        bottom: 0,
        width: 18,
        display: "flex",
        alignItems: "center",
        zIndex: 12,
        // 满高定位框不能吃事件:否则鼠标在正文左缘任意高度划过都会展开,
        // 顺带还挡住正文最左一条的选中与点击。触发只归点列与浮窗自己。
        pointerEvents: "none",
      }}
    >
      <div
        ref={railRef}
        aria-hidden="true"
        className="mc-outline-rail"
        onMouseEnter={enter}
        onMouseLeave={leave}
        style={{ pointerEvents: "auto" }}
      >
        {entries.map((e) => (
          <span
            key={e.seq}
            className="mc-outline-dot"
            data-outline-current={e.seq === activeSeq ? "true" : undefined}
          />
        ))}
      </div>
      {open && (
        <div
          ref={panelRef}
          className="pop mc-outline-panel"
          onMouseEnter={() => enter()}
          onMouseLeave={leave}
          onKeyDown={(ev) => {
            if (ev.key === "Escape") setOpen(false);
          }}
          style={{ top, pointerEvents: "auto" }}
        >
          {entries.map((e) => (
            <button
              key={e.seq}
              className="hv menu-item"
              aria-current={e.seq === activeSeq ? "true" : undefined}
              data-outline-current={e.seq === activeSeq ? "true" : undefined}
              onClick={() => {
                setOpen(false);
                onJump(e);
              }}
              style={{
                width: "100%",
                minWidth: 0,
                padding: "6px 9px",
                gap: 8,
                color: e.seq === activeSeq ? "var(--accTx)" : "var(--t2)",
                fontWeight: e.seq === activeSeq ? 600 : 400,
              }}
            >
              <span className="ellipsis" style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                {e.label}
              </span>
              {e.time && (
                <span style={{ flex: "none", fontSize: 10.5, color: "var(--t5)" }}>{e.time}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
