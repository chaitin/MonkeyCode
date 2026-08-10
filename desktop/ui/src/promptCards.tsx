// 需要用户拍板的卡片:工具审批(perm)与 AI 提问(ask)。
// 审批按钮行同时供工具卡内嵌(锚定态)复用,故与审批卡放在一处。
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { MONO } from "./fonts";
import { IconCheck } from "./icons";
import { localizedToolTitleText, toolDisplayName } from "./toolLabels";
import type { DesignSelectionAction, DesignSelectionResponse, LogItem } from "./types";

/** 审批答复回调(独立审批卡与工具卡内嵌按钮行共用签名) */
export type PermAnswerFn = (id: string, action: "allow" | "always" | "persist" | "deny") => void;

/** 审批按钮行:允许/本会话始终/此项目永久/拒绝 + 快捷键提示。
 * 从 PermCard 抽出与工具卡内嵌(锚定态)共用——同一套按钮样式与动作
 * 词汇只维护一份,两处渲染不漂移。 */
export function PermActions({ id, onAnswer }: { id: string; onAnswer: PermAnswerFn }) {
  const btn: CSSProperties = {
    height: 28,
    display: "flex",
    alignItems: "center",
    padding: "0 14px",
    background: "var(--card)",
    border: "1px solid var(--line)",
    color: "var(--t2)",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 12.5,
    fontWeight: 600,
    userSelect: "none",
    whiteSpace: "nowrap",
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <div
        className="hv-acc"
        onClick={() => onAnswer(id, "allow")}
        style={{ ...btn, background: "var(--acc)", borderColor: "var(--acc)", color: "var(--onAcc)" }}
      >
        允许
      </div>
      <div className="hv" onClick={() => onAnswer(id, "always")} style={btn}>
        本会话始终
      </div>
      <div className="hv" onClick={() => onAnswer(id, "persist")} style={btn}>
        此项目永久
      </div>
      <div
        className="hv-errbg"
        onClick={() => onAnswer(id, "deny")}
        style={{ ...btn, background: "transparent", border: "1px solid var(--errBd)", color: "var(--err)" }}
      >
        拒绝
      </div>
      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--t5)" }}>⏎ 允许 · esc 拒绝</span>
    </div>
  );
}

export function PermCard({
  item,
  onAnswer,
}: {
  item: Extract<LogItem, { kind: "perm" }>;
  onAnswer: PermAnswerFn;
}) {
  // 已允许/已拒绝的审批卡直接消失(用户拍板):决策后紧跟的工具卡(或
  // 拒绝后的轮次收尾)本身就说明了结果,残留任何形态都嫌多。例外:
  // 拒绝/过期之外的异常终态不多见,同样静默——状态机仍在 reduce 里
  // 完整落盘,journal 回放只是不渲染,不丢审计数据。
  if (item.state !== "open") {
    return null;
  }
  const title = localizedToolTitleText(item.title);
  return (
    <div
      style={{
        border: "1px solid var(--warnBd)",
        borderRadius: 12,
        background: "var(--warnBg)",
        padding: "13px 15px",
        maxWidth: 560,
        animation: "mcin .25s ease",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--warn)", whiteSpace: "nowrap" }}>
        需要确认 · {item.tool ? toolDisplayName(item.tool) : "执行操作"}
      </div>
      <div
        style={{
          margin: "9px 0 11px",
          padding: "8px 12px",
          background: "var(--card)",
          border: "1px solid var(--line2)",
          borderRadius: 8,
          font: "12.5px " + MONO,
          color: "var(--t1)",
          wordBreak: "break-all",
        }}
      >
        <span title={item.title}>{title}</span>
      </div>
      <PermActions id={item.id} onAnswer={onAnswer} />
    </div>
  );
}

const DESIGN_ACTION_LABEL: Record<DesignSelectionAction, string> = {
  select: "已选择",
  next: "已请求换一批",
  direct: "已选择直接开发",
  cancel: "已取消选择",
};

type DesignPreviewState =
  | { status: "idle" | "loading" }
  | { status: "rendering" | "ready"; source: string; token: number }
  | { status: "error" };

export const DESIGN_PREVIEW_DESKTOP = { width: 1440, height: 900 } as const;
export const DESIGN_PREVIEW_TIMEOUT_MS = 10_000;

export interface DesignPreviewLayout {
  scale: number;
  left: number;
  top: number;
}

/** Fit a real desktop layout into the thumbnail without changing its responsive breakpoint. */
export function designPreviewLayout(width: number, height: number): DesignPreviewLayout {
  if (!(width > 0) || !(height > 0)) return { scale: 0, left: 0, top: 0 };
  const scale = Math.min(width / DESIGN_PREVIEW_DESKTOP.width, height / DESIGN_PREVIEW_DESKTOP.height);
  return {
    scale,
    left: (width - DESIGN_PREVIEW_DESKTOP.width * scale) / 2,
    top: (height - DESIGN_PREVIEW_DESKTOP.height * scale) / 2,
  };
}

export const DESIGN_PREVIEW_FALLBACK_SCALE = 0.1;

export function visibleDesignPreviewLayout(layout: DesignPreviewLayout): DesignPreviewLayout {
  return layout.scale > 0 ? layout : { scale: DESIGN_PREVIEW_FALLBACK_SCALE, left: 0, top: 0 };
}

export async function loadDesignPreviewSource(
  loader: (path: string) => Promise<string>,
  path: string,
  type: "html" | "image",
): Promise<string> {
  const content = await loader(path);
  if (!content || (type === "html" && !content.trim())) throw new Error("preview unavailable");
  return content;
}

export async function loadDesignPreviewSourceWithRetry(
  loader: (path: string) => Promise<string>,
  path: string,
  type: "html" | "image",
  attempts = 8,
  delayMs = 250,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await loadDesignPreviewSource(loader, path, type);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(delayMs);
    }
  }
  throw lastError;
}

/** 候选进入视口附近才读取/挂载预览。iframe 不接受指针事件，选择仍由外层
 * button 处理；opaque sandbox + 壳注入 CSP 双层限制动态模板。 */
export function DesignTemplatePreview({
  title,
  type,
  path,
  uploadUrl,
  loadHtml,
}: {
  title: string;
  type: "html" | "image";
  path: string;
  uploadUrl?: (path: string) => Promise<string>;
  loadHtml?: (path: string) => Promise<string>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const requestToken = useRef(0);
  const [mounted, setMounted] = useState(false);
  const [preview, setPreview] = useState<DesignPreviewState>({ status: "idle" });
  const [layout, setLayout] = useState<DesignPreviewLayout>({ scale: 0, left: 0, top: 0 });

  useEffect(() => {
    const node = host.current;
    if (!node || mounted) return;
    if (typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const node = host.current;
    if (!node) return;
    const measure = () => {
      const next = designPreviewLayout(node.clientWidth, node.clientHeight);
      setLayout((current) => current.scale === next.scale && current.left === next.left && current.top === next.top ? current : next);
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const loader = type === "html" ? loadHtml : uploadUrl;
    if (!loader) {
      setPreview({ status: "error" });
      return;
    }
    let alive = true;
    const token = ++requestToken.current;
    setPreview({ status: "loading" });
    timeout.current = setTimeout(() => {
      if (!alive || requestToken.current !== token) return;
      alive = false;
      setPreview({ status: "error" });
    }, DESIGN_PREVIEW_TIMEOUT_MS);
    Promise.resolve()
      .then(() => loadDesignPreviewSourceWithRetry(loader, path, type))
      .then(
        (source) => {
          if (!alive || requestToken.current !== token) return;
          setPreview({ status: "rendering", source, token });
        },
        () => {
          if (!alive || requestToken.current !== token) return;
          clearTimeout(timeout.current);
          alive = false;
          setPreview({ status: "error" });
        },
      );
    return () => {
      alive = false;
      clearTimeout(timeout.current);
    };
  }, [loadHtml, mounted, path, type, uploadUrl]);

  const markReady = (token: number) => {
    setPreview((current) => {
      if (current.status !== "rendering" || current.token !== token) return current;
      clearTimeout(timeout.current);
      return { ...current, status: "ready" };
    });
  };
  const markUnavailable = (token: number) => {
    setPreview((current) => {
      if (current.status !== "rendering" || current.token !== token) return current;
      clearTimeout(timeout.current);
      return { status: "error" };
    });
  };
  const pending = preview.status === "idle" || preview.status === "loading" || preview.status === "rendering";
  const visibleLayout = visibleDesignPreviewLayout(layout);

  return (
    <div ref={host} data-preview-type={type} data-preview-state={preview.status} style={{ position: "relative", width: "100%", aspectRatio: "16 / 10", overflow: "hidden", background: "var(--hov)", pointerEvents: "none" }}>
      {mounted && type === "image" && (preview.status === "rendering" || preview.status === "ready") && (
        <img src={preview.source} alt={title} onLoad={() => markReady(preview.token)} onError={() => markUnavailable(preview.token)} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
      )}
      {mounted && type === "html" && (preview.status === "rendering" || preview.status === "ready") && (
        <iframe
          title={`${title} 动态预览`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          src={preview.source}
          onLoad={() => markReady(preview.token)}
          onError={() => markUnavailable(preview.token)}
          tabIndex={-1}
          width={DESIGN_PREVIEW_DESKTOP.width}
          height={DESIGN_PREVIEW_DESKTOP.height}
          data-desktop-viewport={`${DESIGN_PREVIEW_DESKTOP.width}x${DESIGN_PREVIEW_DESKTOP.height}`}
          style={{
            position: "absolute",
            left: visibleLayout.left / visibleLayout.scale,
            top: visibleLayout.top / visibleLayout.scale,
            display: "block",
            width: DESIGN_PREVIEW_DESKTOP.width,
            height: DESIGN_PREVIEW_DESKTOP.height,
            border: 0,
            background: "white",
            opacity: preview.status === "ready" ? 1 : 0,
            pointerEvents: "none",
            zoom: visibleLayout.scale,
          }}
        />
      )}
      {mounted && pending && (
        <span aria-label="正在载入模板预览" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t5)", fontSize: 11.5 }}>
          正在载入预览…
        </span>
      )}
      {mounted && preview.status === "error" && (
        <span role="status" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t5)", fontSize: 11.5 }}>
          预览不可用
        </span>
      )}
    </div>
  );
}

/** Phase 1 专用设计模板选择卡。图片沿用会话 uploads 回读能力，不把本地路径
 * 直接交给 webview。业务提交 Promise 成功前保持开放态，并以 submitting
 * 锁住全部操作，防止重复响应同一个 request。 */
export function DesignTemplateSelectionCard({
  item,
  uploadUrl,
  loadHtml,
  onRespond,
}: {
  item: Extract<LogItem, { kind: "design-template-selection" }>;
  uploadUrl?: (path: string) => Promise<string>;
  loadHtml?: (path: string) => Promise<string>;
  onRespond?: (response: DesignSelectionResponse) => Promise<boolean>;
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [refinement, setRefinement] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (item.state !== "open") {
    const selected = item.items.find((candidate) => candidate.id === item.selectedId);
    const label = item.state === "responded"
      ? DESIGN_ACTION_LABEL[item.action ?? "cancel"]
      : item.state === "cancelled" ? "选择请求已取消" : "选择请求已过期";
    return (
      <div style={{ display: "flex", justifyContent: "center", gap: 7, color: "var(--t5)", fontSize: 11.5 }}>
        <IconCheck size={11} color="var(--t5)" />
        <span>{label}{selected ? ` · ${selected.title}` : ""}{item.reason ? ` · ${item.reason}` : ""}</span>
      </div>
    );
  }

  const submit = async (action: DesignSelectionAction) => {
    if (submitting || !onRespond || !item.allowedActions[action] || (action === "select" && !selectedId)) return;
    const text = refinement.trim();
    const response: DesignSelectionResponse = {
      request_id: item.requestId,
      action,
      ...(action === "select" && selectedId ? { selected_id: selectedId } : {}),
      ...(text ? { refinement_text: text } : {}),
    };
    setSubmitting(true);
    try {
      await onRespond(response);
    } finally {
      setSubmitting(false);
    }
  };
  const interactive = !!onRespond && !submitting;
  const selectable = interactive && item.allowedActions.select;
  const buttonStyle: CSSProperties = {
    height: 30,
    border: "1px solid var(--line)",
    borderRadius: 8,
    padding: "0 13px",
    background: "var(--card)",
    color: "var(--t2)",
    fontSize: 12,
    fontWeight: 650,
    cursor: interactive ? "pointer" : "default",
    opacity: submitting ? 0.6 : 1,
  };

  return (
    <div style={{ width: "100%", maxWidth: 680, border: "1px solid var(--cardBd)", borderRadius: 13, background: "var(--card)", boxShadow: "var(--cardSh)", padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 750, color: "var(--t1)" }}>{item.title || "选择设计"}</div>
      {item.description && <div style={{ marginTop: 4, color: "var(--t4)", fontSize: 12.5, lineHeight: 1.5 }}>{item.description}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 13 }}>
        {item.items.map((candidate) => {
          const active = selectedId === candidate.id;
          return (
            <button
              key={candidate.id}
              type="button"
              disabled={!selectable}
              aria-pressed={active}
              onClick={() => setSelectedId(candidate.id)}
              style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start", padding: 0, overflow: "hidden", textAlign: "left", border: `1.5px solid ${active ? "var(--acc)" : "var(--line)"}`, borderRadius: 10, background: active ? "var(--accBgSoft)" : "var(--card)", cursor: selectable ? "pointer" : "default", appearance: "none", WebkitAppearance: "none" }}
            >
              {candidate.recommended && <span style={{ position: "absolute", zIndex: 1, top: 7, right: 7, borderRadius: 999, padding: "2px 7px", background: "var(--acc)", color: "var(--onAcc)", fontSize: 10, fontWeight: 700 }}>推荐</span>}
              {(() => {
                const preview = candidate.preview ?? (candidate.image ? { type: "image" as const, path: candidate.image } : undefined);
                return preview
                  ? <DesignTemplatePreview title={candidate.title} type={preview.type} path={preview.path} uploadUrl={uploadUrl} loadHtml={loadHtml} />
                  : <div style={{ width: "100%", aspectRatio: "4 / 3", background: "var(--hov)", pointerEvents: "none" }} />;
              })()}
              <span style={{ display: "block", padding: "9px 10px" }}>
                <span style={{ display: "block", color: "var(--t1)", fontSize: 12.5, fontWeight: 700 }}>{candidate.title}</span>
                {candidate.description && <span style={{ display: "block", marginTop: 3, color: "var(--t5)", fontSize: 11, lineHeight: 1.4 }}>{candidate.description}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {item.allowedActions.next && item.refinement?.enabled && (
        <input
          value={refinement}
          disabled={!interactive}
          onChange={(event) => setRefinement(event.target.value)}
          placeholder={item.refinement.placeholder || "补充你的设计条件（可选）"}
          style={{ boxSizing: "border-box", width: "100%", marginTop: 12, border: "1px solid var(--inputBd)", borderRadius: 8, background: "var(--inputBg)", color: "var(--t1)", padding: "8px 10px", fontSize: 12.5, outline: "none" }}
        />
      )}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line2)" }}>
        {item.allowedActions.cancel && <button type="button" disabled={!interactive} onClick={() => void submit("cancel")} style={buttonStyle}>取消</button>}
        {item.allowedActions.direct && <button type="button" disabled={!interactive} onClick={() => void submit("direct")} style={buttonStyle}>直接开发</button>}
        {item.allowedActions.next && <button type="button" disabled={!interactive} onClick={() => void submit("next")} style={buttonStyle}>换一批</button>}
        {item.allowedActions.select && <button type="button" disabled={!interactive || !selectedId} onClick={() => void submit("select")} style={{ ...buttonStyle, borderColor: "var(--acc)", background: selectedId ? "var(--acc)" : "var(--hov)", color: selectedId ? "var(--onAcc)" : "var(--t5)", cursor: interactive && selectedId ? "pointer" : "default" }}>{submitting ? "提交中…" : "选择"}</button>}
      </div>
    </div>
  );
}

/** 自定义答案在选中集合里的占位键(对齐 mobile askAnswers.ts) */
const CUSTOM_ANSWER_KEY = "__monkeycode_custom_answer__";

/** 单选圆点/多选勾:问答选项统一使用明确的选择控件,不再只靠整行变色。 */
function AskChoiceMark({ active, multi }: { active: boolean; multi: boolean }) {
  return (
    <span
      style={{
        width: 17,
        height: 17,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1.5px solid ${active ? "var(--acc)" : "var(--inputBd)"}`,
        borderRadius: multi ? 5 : "50%",
        background: active ? "var(--acc)" : "var(--card)",
        flex: "none",
      }}
    >
      {active && (multi ? <IconCheck size={10} color="var(--onAcc)" /> : <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--onAcc)" }} />)}
    </span>
  );
}

/** AI 提问卡:每题单选/多选 + 可选自定义输入;全部作答后可提交。
 * 已答/过期态只读展示答案。onAnswer 缺省(只读回放场景)则不可交互。 */
export function AskCard({
  item,
  onAnswer,
}: {
  item: Extract<LogItem, { kind: "ask" }>;
  onAnswer?: (askId: string, answers: Record<string, string | string[]>) => void;
}) {
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [customOpen, setCustomOpen] = useState<Record<number, boolean>>({});

  // 提问过期只留一条弱状态;已回答则按“用户消息”收成右侧气泡。
  // 问与答完整换行保留,不做原先易读性很差的单行截断。
  if (item.state !== "open") {
    if (item.state === "expired") {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, color: "var(--t6)", fontSize: 11.5 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--t7)" }} />
          提问已过期 · 未回答
        </div>
      );
    }
    const hasAnswers = item.questions.some((q) => q.answer !== undefined);
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div
          style={{
            width: "fit-content",
            minWidth: 240,
            maxWidth: "70%",
            padding: "10px 14px",
            border: "1px solid var(--accBd)",
            borderRadius: "12px 12px 3px 12px",
            background: "var(--userBg)",
            animation: "mcin .2s ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8, color: hasAnswers ? "var(--accTx)" : "var(--t5)", fontSize: 10.5, fontWeight: 700 }}>
            {hasAnswers && <IconCheck size={11} color="var(--accTx)" />}
            {hasAnswers ? "已回答" : "未回答"}
          </div>
          {item.questions.map((q, qi) => {
            const ans = Array.isArray(q.answer) ? q.answer.join("、") : q.answer;
            return (
              <div key={qi} style={{ paddingTop: qi ? 9 : 0, marginTop: qi ? 9 : 0, borderTop: qi ? "1px solid var(--line2)" : "none" }}>
                <div style={{ marginBottom: 3, color: "var(--t5)", fontSize: 11.5, lineHeight: 1.45 }}>
                  {q.header && <span style={{ marginRight: 5, color: "var(--t4)", fontWeight: 600 }}>{q.header} ·</span>}
                  {q.question}
                </div>
                <div style={{ color: ans ? "var(--t1)" : "var(--t5)", fontSize: 13, fontWeight: ans ? 600 : 400, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {ans || "未回答"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const toggle = (qi: number, choice: string, multi: boolean) => {
    setSelected((prev) => {
      const cur = new Set(prev[qi] ?? []);
      if (cur.has(choice)) cur.delete(choice);
      else {
        if (!multi) cur.clear();
        cur.add(choice);
      }
      return { ...prev, [qi]: cur };
    });
  };

  const chooseOption = (qi: number, choice: string, multi: boolean) => {
    // 单选切回预设项时,自定义文本也必须清掉;否则会出现“有输入但没
    // 勾选其他”的矛盾状态。多选的各项彼此独立,不动自定义内容。
    if (!multi) {
      setCustom((prev) => ({ ...prev, [qi]: "" }));
      setCustomOpen((prev) => ({ ...prev, [qi]: false }));
    }
    toggle(qi, choice, multi);
  };

  const updateCustomAnswer = (qi: number, value: string, multi: boolean) => {
    setCustom((prev) => ({ ...prev, [qi]: value }));
    setSelected((prev) => {
      const cur = new Set(prev[qi] ?? []);
      if (value.trim()) {
        if (!multi) cur.clear();
        cur.add(CUSTOM_ANSWER_KEY);
      } else {
        cur.delete(CUSTOM_ANSWER_KEY);
      }
      return { ...prev, [qi]: cur };
    });
  };

  // 全部题目已作答(自定义项须有内容)才能提交;答案 {问题: 值},多选为数组
  const buildAnswers = (): Record<string, string | string[]> | null => {
    const answers: Record<string, string | string[]> = {};
    for (let qi = 0; qi < item.questions.length; qi++) {
      const q = item.questions[qi];
      const choices = selected[qi];
      if (!choices || choices.size === 0) return null;
      const values: string[] = [];
      for (const c of choices) {
        if (c === CUSTOM_ANSWER_KEY) {
          const v = (custom[qi] ?? "").trim();
          if (!v) return null;
          values.push(v);
        } else {
          values.push(c);
        }
      }
      answers[q.question] = q.multiSelect ? values : values[0];
    }
    return answers;
  };

  const open = item.state === "open" && !!onAnswer;
  const ready = open && buildAnswers() !== null;

  const optBtn = (active: boolean): CSSProperties => ({
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 11px",
    borderRadius: 9,
    border: `1px solid ${active ? "var(--accBd2)" : "var(--line)"}`,
    background: active ? "var(--accBgSoft)" : "var(--card)",
    cursor: open ? "pointer" : "default",
    userSelect: "none",
    textAlign: "left",
    outline: "none",
  });

  return (
    <div
      style={{
        width: "100%",
        border: "1px solid var(--cardBd)",
        borderRadius: 12,
        background: "var(--card)",
        boxShadow: "var(--cardSh)",
        padding: "14px 15px",
        maxWidth: 560,
        animation: "mcin .25s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span
          style={{
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            background: "var(--accBg)",
            color: "var(--accTx)",
            fontSize: 13,
            fontWeight: 800,
            flex: "none",
          }}
        >
          ?
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--t1)", fontSize: 12.5, fontWeight: 700 }}>需要你的回答</div>
          <div style={{ marginTop: 1, color: "var(--t5)", fontSize: 10.5 }}>
            {item.questions.length > 1
              ? `共 ${item.questions.length} 个问题`
              : item.questions[0]?.multiSelect
                ? "可以选择多个答案"
                : item.questions[0]?.custom
                  ? "请选择或填写答案"
                  : "请选择一个选项"}
          </div>
        </div>
      </div>
      {item.questions.map((q, qi) => {
        return (
          <div key={qi} style={{ marginTop: 13, paddingTop: qi ? 13 : 0, borderTop: qi ? "1px solid var(--line2)" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              {q.header && (
                <span style={{ flex: "none", fontSize: 10.5, fontWeight: 700, color: "var(--accTx)", background: "var(--accBg)", borderRadius: 6, padding: "2px 6px" }}>
                  {q.header}
                </span>
              )}
              <span style={{ fontSize: 13, fontWeight: 650, color: "var(--t1)", lineHeight: 1.5 }}>{q.question}</span>
              {q.multiSelect && <span style={{ marginLeft: "auto", color: "var(--t6)", fontSize: 10.5, whiteSpace: "nowrap" }}>可多选</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {q.options.map((o) => {
                const active = selected[qi]?.has(o.label) ?? false;
                return (
                  <button
                    key={o.label}
                    type="button"
                    disabled={!open}
                    className={open ? "mc-ask-option" : undefined}
                    onClick={() => chooseOption(qi, o.label, q.multiSelect)}
                    style={optBtn(active)}
                  >
                    <AskChoiceMark active={active} multi={q.multiSelect} />
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t1)" }}>{o.label}</span>
                      {o.description && <span style={{ fontSize: 11.5, color: "var(--t5)", lineHeight: 1.45 }}>{o.description}</span>}
                    </span>
                  </button>
                );
              })}
              {q.custom && (() => {
                const active = selected[qi]?.has(CUSTOM_ANSWER_KEY) ?? false;
                const expanded = customOpen[qi] || active;
                return (
                  <div
                    role="button"
                    aria-pressed={active}
                    tabIndex={open ? 0 : -1}
                    className={open ? "mc-ask-option" : undefined}
                    onClick={() => open && setCustomOpen((prev) => ({ ...prev, [qi]: true }))}
                    onKeyDown={(e) => {
                      if (open && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        setCustomOpen((prev) => ({ ...prev, [qi]: true }));
                      }
                    }}
                    style={{ ...optBtn(active), alignItems: expanded ? "flex-start" : "center" }}
                  >
                    <AskChoiceMark active={active} multi={q.multiSelect} />
                    <span style={{ display: "flex", flex: 1, flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t1)" }}>其他</span>
                        {active && (
                          <span
                            className="hv-t1"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateCustomAnswer(qi, "", q.multiSelect);
                              setCustomOpen((prev) => ({ ...prev, [qi]: false }));
                            }}
                            style={{ color: "var(--t5)", fontSize: 11, fontWeight: 400 }}
                          >
                            清空
                          </span>
                        )}
                      </span>
                      {!expanded && <span style={{ color: "var(--t5)", fontSize: 11.5 }}>输入自己的答案</span>}
                      {expanded && (
                        <input
                          autoFocus
                          className="mc-ask-input"
                          value={custom[qi] ?? ""}
                          onChange={(e) => updateCustomAnswer(qi, e.target.value, q.multiSelect)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Escape" && !(custom[qi] ?? "").trim()) {
                              setCustomOpen((prev) => ({ ...prev, [qi]: false }));
                            }
                          }}
                          placeholder="输入你的回答"
                          style={{
                            width: "100%",
                            marginTop: 5,
                            border: "1px solid var(--inputBd)",
                            borderRadius: 7,
                            padding: "7px 9px",
                            fontSize: 12.5,
                            background: "var(--inputBg)",
                            color: "var(--t1)",
                            outline: "none",
                          }}
                        />
                      )}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })}
      {open && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ color: ready ? "var(--accTx)" : "var(--t5)", fontSize: 11.5 }}>
            {ready ? "已完成选择" : "请回答全部问题"}
          </span>
          <button
            type="button"
            disabled={!ready}
            className={ready ? "hv-acc" : undefined}
            onClick={() => {
              const answers = buildAnswers();
              if (answers && onAnswer) onAnswer(item.askId, answers);
            }}
            style={{
              height: 28,
              display: "flex",
              alignItems: "center",
              padding: "0 17px",
              background: ready ? "var(--acc)" : "var(--hov)",
              border: "none",
              color: ready ? "var(--onAcc)" : "var(--t5)",
              borderRadius: 8,
              cursor: ready ? "pointer" : "default",
              fontSize: 12.5,
              fontWeight: 700,
              userSelect: "none",
            }}
          >
            提交回答
          </button>
        </div>
      )}
    </div>
  );
}
