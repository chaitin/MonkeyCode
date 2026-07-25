// 提问大纲:正文左缘一列小点(收起态),鼠标浮上去整条展开成浮窗,点浮窗里
// 的某一条就滚到那次提问。
//
// 数据来自壳的 session_outline —— **全量**,包含尚未加载进对话流的更早提问
// (条目自带那一轮在 replay.jsonl 的字节偏移,点到时由调用方先补历史再定位)。
// 点本身不响应点击:6px 的目标太小,误点代价是整屏跳走。
import { useEffect, useRef, useState } from "react";
import { ATT_LINE } from "./logView";
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

function hhmm(ts?: number): string {
  if (ts === undefined || !Number.isFinite(ts)) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 大纲条目文案:剥掉附件行(与用户气泡同一 ATT_LINE 约定)、压平空白、截断。
 * 纯附件消息没有正文,回退成附件计数,不能出现空条目。 */
export function outlineEntries(items: OutlineItem[]): OutlineEntry[] {
  return items.map((it) => {
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
    return { seq: it.seq, offset: it.offset, label, time: hhmm(it.timestamp) };
  });
}

/** 收起 = 一列点;悬停 = 大纲浮窗。两态一个组件,`onJump` 交给调用方定位。 */
export function OutlineNav({
  entries,
  activeSeq,
  onJump,
}: {
  entries: OutlineEntry[];
  /** 当前视口所在的那次提问(收起态点加粗、展开态条目高亮) */
  activeSeq?: number;
  onJump: (entry: OutlineEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  // 当前项始终可见:点多到轨道装不下、或提问多到浮窗要内滚时,
  // 打开就已经停在"我现在在哪"上,不用自己找
  useEffect(() => {
    const box = open ? panelRef.current : railRef.current;
    const target = box?.querySelector<HTMLElement>('[data-outline-current="true"]');
    if (!box || !target) return;
    const top = target.offsetTop - box.clientHeight / 2 + target.offsetHeight / 2;
    box.scrollTop = Math.max(0, top);
  }, [open, activeSeq, entries.length]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // 一条提问的会话不值得占一条轨道
  if (entries.length < 2) return null;

  const enter = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  // 延时收起:点列很窄,指针从点移向浮窗的路上会短暂离开,立即收会闪
  const leave = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 200);
  };

  return (
    <nav
      aria-label="提问大纲"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
      style={{
        position: "absolute",
        // 不贴窗口左缘:点列离边 10px,面板再往右(见 .mc-outline-panel)
        left: 10,
        top: 0,
        bottom: 0,
        width: 18,
        display: "flex",
        alignItems: "center",
        zIndex: 12,
      }}
    >
      <div
        ref={railRef}
        aria-hidden="true"
        className="mc-outline-rail"
        style={{ opacity: open ? 0 : 1, pointerEvents: open ? "none" : undefined }}
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
        <div ref={panelRef} className="pop mc-outline-panel">
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
