// 展示型组件:消息、思考、工具卡片、计划卡、审批卡、diff 等。
// 样式值取自「MonkeyCode 桌面应用设计」(浅色绿调),逐一对应,不另行发挥。
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { marked } from "marked";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { openExternal } from "./host";
import {
  IconCheck,
  IconChevronRight,
  IconDots,
  IconFolder,
  IconSpark,
  IconTaskBlocked,
  IconTaskDone,
  IconTaskPending,
  IconTaskRunning,
  IconTrash,
} from "./icons";
import { resolveMarkdownResource } from "./markdownPaths";
import { permAnchors } from "./reduce";
import { toolDetailFor } from "./toolDetails";
import { localizedToolTitleText, presentToolCall, toolDisplayName, type ToolTargetKind } from "./toolLabels";
import type { LogItem, PlanEntry } from "./types";

marked.setOptions({ gfm: true, breaks: true });

// 代码块包一层容器并附复制按钮;按钮点击走 .md 容器的事件代理
// (innerHTML 注入的 DOM 挂不了 React handler)
const baseRenderer = new marked.Renderer();
marked.use({
  renderer: {
    code(token) {
      return `<div class="mdcode">${baseRenderer.code(token)}<button class="mdcopy" type="button">复制</button></div>`;
    },
    table(token) {
      const table = baseRenderer.table.call(this, token);
      return `<div class="md-table-scroll" role="region" aria-label="可横向滚动的表格" tabindex="0">${table}</div>`;
    },
    tablecell(token) {
      const tag = token.header ? "th" : "td";
      const align = token.align ? ` align="${token.align}"` : "";
      const content = this.parser.parseInline(token.tokens);
      return `<${tag}${align}><div class="md-table-cell">${content}</div></${tag}>\n`;
    },
  },
});

/** 复制到剪贴板:异步 API 不可用/被拒时回退 execCommand(Win7 WebView2 无 clipboard API) */
function copyText(text: string) {
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(fallback);
  } else {
    fallback();
  }
}

// 等宽栈:JetBrains Mono 经 webfont 随应用加载(latin 子集),中文回退 HarmonyOS Sans SC;
// 其后仍显式列出各平台字体,Windows 上不能只留 monospace 泛型——
// Win7 WebView2 对泛型的解析不可靠(显示乱码),中文回退也会掉进宋体位图
export const MONO = '"JetBrains Mono","HarmonyOS Sans SC",ui-monospace,Menlo,Consolas,"Courier New","Microsoft YaHei",monospace';

/** 正文里的链接一律不走 webview 导航(WKWebView 里点 <a> 会把应用页面跳走):
 * http(s) 交系统浏览器/新标签页,其余协议直接拦下。 */
function onMarkdownClick(e: ReactMouseEvent<HTMLDivElement>, onLocalLink?: (path: string) => void) {
  const target = e.target as HTMLElement;
  const copy = target.closest<HTMLButtonElement>("button.mdcopy");
  if (copy) {
    copyText(copy.parentElement?.querySelector("pre")?.textContent ?? "");
    copy.textContent = "已复制";
    copy.classList.add("ok");
    window.setTimeout(() => {
      copy.textContent = "复制";
      copy.classList.remove("ok");
    }, 1500);
    return;
  }
  const a = target.closest("a");
  if (!a) return;
  e.preventDefault();
  const local = a.dataset.mcLocalHref;
  if (local) {
    onLocalLink?.(local);
    return;
  }
  const href = a.getAttribute("href") || "";
  if (/^https?:/i.test(href)) openExternal(href);
}

/** 在 inert template 中先标记本地资源,再交给 DOMPurify 净化。
 * file: 等地址会被净化器移除,所以顺序不能反过来。 */
function markdownHtml(text: string): string {
  const template = document.createElement("template");
  template.innerHTML = marked.parse(text, { async: false }) as string;
  for (const img of template.content.querySelectorAll<HTMLImageElement>("img[src]")) {
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    const source = resolveMarkdownResource(img.getAttribute("src") || "");
    if (source.kind === "local") {
      img.dataset.mcLocalSrc = source.path;
      img.removeAttribute("src");
    } else if (source.kind === "url") {
      img.setAttribute("src", source.src);
    }
  }
  for (const a of template.content.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const source = resolveMarkdownResource(a.getAttribute("href") || "");
    if (source.kind === "local") {
      a.dataset.mcLocalHref = source.path;
      a.setAttribute("href", "#");
    } else if (source.kind === "url") {
      a.setAttribute("href", source.src);
    }
  }
  return DOMPurify.sanitize(template.innerHTML);
}

/** agent 正文按 Markdown 渲染(净化后注入);流式期间随批次重渲染 */
export function Markdown({
  text,
  localImageUrl,
  onLocalLink,
}: {
  text: string;
  localImageUrl?: (path: string) => Promise<string>;
  onLocalLink?: (path: string) => void;
}) {
  const html = useMemo(() => markdownHtml(text), [text]);
  const root = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, string>());
  useEffect(() => {
    if (!localImageUrl || !root.current) return;
    let alive = true;
    for (const img of root.current.querySelectorAll<HTMLImageElement>("img[data-mc-local-src]")) {
      const path = img.dataset.mcLocalSrc;
      if (!path) continue;
      const cached = cache.current.get(path);
      if (cached) {
        img.src = cached;
        continue;
      }
      img.setAttribute("aria-busy", "true");
      localImageUrl(path).then(
        (url) => {
          if (!alive) return;
          cache.current.set(path, url);
          img.src = url;
          img.removeAttribute("aria-busy");
        },
        (e) => {
          if (!alive) return;
          img.removeAttribute("aria-busy");
          img.dataset.mcLocalError = "true";
          img.title = `本地图片加载失败: ${e instanceof Error ? e.message : String(e)}`;
        },
      );
    }
    return () => {
      alive = false;
    };
    // localImageUrl 随 SessionHandle 渲染生成新闭包;同一条消息只按 HTML 变化重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);
  return <div ref={root} className="md" onClick={(e) => onMarkdownClick(e, onLocalLink)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 单行内联 markdown(子代理 feed 行:加粗/行内代码等,不产生块级元素,
 * 保持单行 ellipsis 布局)。 */
function MarkdownInline({ text, style }: { text: string; style?: CSSProperties }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parseInline(text, { async: false }) as string), [text]);
  return <span className="ellipsis mdi" style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 思考块:单行折叠(✦ 思考 + 摘要省略),点击在下方展开完整文本的缩进块。
 * 全文不放进标题 flex 行:多行文本会把居中的图标顶到段落中部,标签与内容挤作一团。 */
function ThoughtView({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: "92%" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: "var(--t4)",
          cursor: "pointer",
          userSelect: "none",
          lineHeight: 1.6,
          minWidth: 0,
        }}
      >
        <IconSpark />
        <span style={{ fontWeight: 600, color: "var(--t3)", flex: "none" }}>思考</span>
        {!open && (
          <span className="ellipsis" style={{ flex: 1, minWidth: 0 }}>
            {text.trim().replace(/\s+/g, " ")}
          </span>
        )}
        {open && <span style={{ flex: 1 }} />}
        <IconChevronRight
          size={9}
          color="var(--t6)"
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}
        />
      </div>
      {open && (
        <div
          style={{
            marginLeft: 5,
            borderLeft: "2px solid var(--line)",
            padding: "2px 0 2px 13px",
            fontSize: 12,
            color: "var(--t4)",
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            animation: "mcin .2s ease",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

/** 实时任务面板:钉在 composer 上方,不进对话流。收起 = 一行摘要
 * (进度 + 当前项),展开 = 限高滚动的勾选列表;整卡随 todo_update 更新。 */
export function TaskPanel({ entries }: { entries: PlanEntry[] }) {
  const [open, setOpen] = useState(false);
  const done = entries.filter((e) => e.status === "completed").length;
  const current = entries.find((e) => e.status === "in_progress") ?? entries.find((e) => e.status === "pending");
  // 依赖提示(上游 todo_update 携带 id/depends_on 时):id → 序号与标题,
  // blocked 缺省按"有未完成依赖"本地推导
  const byId = new Map(entries.map((e, i) => [e.id ?? "", { idx: i + 1, e }]));
  const unfinishedDeps = (e: PlanEntry) =>
    (e.depends_on ?? []).filter((d) => byId.get(d)?.e.status !== "completed");
  const isBlocked = (e: PlanEntry) =>
    e.status !== "completed" && (e.blocked ?? unfinishedDeps(e).length > 0);
  const depHint = (e: PlanEntry) => {
    const deps = unfinishedDeps(e);
    if (!deps.length) return null;
    const names = deps.map((d) => byId.get(d)).filter(Boolean).map((x) => `#${x!.idx}`);
    return names.length ? `等 ${names.join(" ")}` : null;
  };
  const statusIcon = (status: string, blocked: boolean, size = 12) => {
    if (blocked) return <IconTaskBlocked size={size} />;
    if (status === "completed") return <IconTaskDone size={size} />;
    if (status === "in_progress") return <IconTaskRunning size={size} />;
    return <IconTaskPending size={size} />;
  };
  // 有任何依赖关系时全员编号,"等 #N" 才有落点
  const numbered = entries.some((e) => e.depends_on?.length);
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", borderRadius: 11, boxShadow: "none", animation: "mcin .18s ease" }}>
      <button
        className="hv2"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "7px 12px", border: "none", background: "transparent",
          cursor: "pointer", font: "inherit", fontSize: 12, textAlign: "left",
        }}
      >
        {statusIcon(done === entries.length && entries.length > 0 ? "completed" : "in_progress", false, 13)}
        <span style={{ fontWeight: 600 }}>
          任务 {done}/{entries.length}
        </span>
        {!open && current && (
          <span className="ellipsis" style={{ color: "var(--t4)", flex: 1, minWidth: 0 }}>
            · {current.status === "in_progress" ? "正在" : "接下来"}：{current.content}
          </span>
        )}
        <IconChevronRight
          size={9}
          color="var(--t5)"
          style={{ marginLeft: "auto", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}
        />
      </button>
      {open && (
        <div style={{ maxHeight: 176, overflowY: "auto", padding: "0 12px 9px", display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
          {entries.map((e, i) => {
            const blocked = isBlocked(e);
            const hint = depHint(e);
            return (
              <div
                key={i}
                style={{
                  color: e.status === "completed" ? "var(--t5)" : blocked ? "var(--t4)" : e.status === "in_progress" ? "var(--acc)" : "var(--t2)",
                  textDecoration: e.status === "completed" ? "line-through" : "none",
                }}
                title={hint ? `依赖未完成: ${hint}` : undefined}
              >
                <span style={{ display: "inline-flex", width: 18, verticalAlign: -2 }}>
                  {statusIcon(e.status, blocked)}
                </span>
                {numbered && <span style={{ color: "var(--t5)", marginRight: 5, fontSize: 11 }}>#{i + 1}</span>}
                {e.content}
                {hint && <span style={{ color: "var(--t5)", fontSize: 11, marginLeft: 6 }}>· {hint}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 状态标记:执行中空心绿点呼吸(设计稿 agents 的 dot),结束 ✓/✗——
 * 与子代理进度行 stepMark 同一套语言,终态只靠描边颜色区分读不出来 */
function StatusDot({ status }: { status: "run" | "ok" | "fail" }) {
  if (status === "ok") return <IconCheck size={11} />;
  if (status === "fail") return <span style={{ color: "var(--err)", fontSize: 11, flex: "none" }}>✗</span>;
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        flex: "none",
        border: "1.5px solid var(--acc)",
        background: "var(--accBd)",
        animation: "mcpulse 1.4s infinite",
      }}
    />
  );
}

function stepMark(status: "run" | "ok" | "fail") {
  if (status === "ok") return <IconCheck size={10} />;
  if (status === "fail") return <span style={{ color: "var(--err)", fontSize: 10, flex: "none" }}>✗</span>;
  return <span style={{ color: "var(--t5)", fontSize: 10, flex: "none", animation: "mcpulse 1.2s infinite" }}>◌</span>;
}

/** 进度滚动窗口:固定只展示最后几条,旧条目自然滚出(完整过程走"查看子会话")。 */
const FEED_WINDOW = 5;

/** 标题里的工作区绝对路径收敛为相对路径(历史会话标题已落盘,只能渲染时处理) */
function stripWorkdir(text: string, workdir?: string): string {
  if (!workdir) return text;
  const slashDir = workdir.replace(/\\/g, "/").replace(/\/$/, "");
  const backslashDir = workdir.replace(/\//g, "\\").replace(/\\$/, "");
  return text.split(slashDir + "/").join("").split(backslashDir + "\\").join("");
}

/** 路径保证末尾文件名可见；完整值始终放在 title，不在数据层截断。 */
function ToolTargetText({
  target,
  fullTarget,
  kind,
  compact = false,
}: {
  target: string;
  fullTarget?: string;
  kind: ToolTargetKind;
  compact?: boolean;
}) {
  const common: CSSProperties = {
    color: "var(--t3)",
    font: `${compact ? 11 : 11.5}px/1.55 ${MONO}`,
    flex: 1,
    minWidth: 0,
  };
  if (kind !== "path") {
    return <span title={fullTarget || target} className="ellipsis" style={{ ...common, display: "block" }}>{target}</span>;
  }

  const split = Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\"));
  const hasFilename = split >= 0 && split < target.length - 1;
  const directory = hasFilename ? target.slice(0, split + 1) : "";
  const filename = hasFilename ? target.slice(split + 1) : target;
  return (
    <span title={fullTarget || target} style={{ ...common, display: "flex", whiteSpace: "nowrap", overflow: "hidden" }}>
      {directory && <span className="ellipsis" style={{ minWidth: 12, color: "var(--t5)" }}>{directory}</span>}
      <span className="ellipsis" style={{ flex: "none", maxWidth: "70%", color: "var(--t3)" }}>{filename}</span>
    </span>
  );
}

/** 工具卡只显示可靠的最终耗时；没有完整起止时间时宁可留空。 */
function formatToolDuration(durationMs?: number): string {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return "";
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1).replace(/\.0$/, "")}s`;
  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** 上传/落盘图片:src 经壳异步回读(data URL),就绪前占位不渲染。 */
function UploadImg({
  load,
  alt,
  title,
  onClick,
  style,
}: {
  load: () => Promise<string>;
  alt: string;
  title?: string;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    load().then(
      (u) => alive && setSrc(u),
      () => alive && setSrc(null),
    );
    return () => {
      alive = false;
    };
    // load 闭包按 alt(路径)稳定,不依赖函数身份
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alt]);
  if (!src) return null;
  return <img src={src} alt={alt} title={title} onClick={onClick} style={style} />;
}

/** 附件文件下载:壳回读 data URL 后经 <a download> 落盘。 */
function downloadUpload(load: () => Promise<string>, name: string): void {
  load().then((url) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }).catch(() => {});
}

export function ToolCard({
  item,
  onOpenChild,
  uploadUrl,
  onLocalLink,
  workdir,
  perm,
  onPermAnswer,
  grouped = false,
}: {
  item: Extract<LogItem, { kind: "tool" }>;
  onOpenChild?: (id: string) => void;
  /** 已上传/落盘图片路径 → 可渲染 URL(异步 data URL;不传则不渲染图) */
  uploadUrl?: (path: string) => Promise<string>;
  /** Markdown 中工作区文件链接的安全打开动作 */
  onLocalLink?: (path: string) => void;
  workdir?: string;
  /** 锚定到本卡的待决审批(permAnchors 判定):头部 ⏸ + 底部内嵌按钮行,
   * 独立审批大卡随之不渲染;已决后由调用方不再传入,卡片回归常态 */
  perm?: Extract<LogItem, { kind: "perm" }>;
  onPermAnswer?: PermAnswerFn;
  /** 相邻工具共享外框时只渲染内部区块，由父级提供卡片底座。 */
  grouped?: boolean;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  const [showAgentResult, setShowAgentResult] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const feed = item.feed ?? [];
  // 子代理运行时卡内直播少量进度;完成后无论同步/后台都收成单行,
  // 完整过程与最终产出统一从子会话查看。
  const isAgentCard = !!(item.childSessionId || feed.length || item.background);
  const agentFinished = isAgentCard && item.status !== "run";
  const canOpenChild = !!(item.childSessionId && onOpenChild);
  const agentResult = agentFinished ? (item.result ?? "").trim() : "";
  const visible = agentFinished ? [] : feed.slice(-FEED_WINDOW);
  // 极端情况下子会话入口缺失(云端只读流/旧 journal),保留按需展开兜底,
  // 但不再默认把整段结果灌进卡片。
  const summary = agentResult && !canOpenChild && showAgentResult ? agentResult : "";
  const images = uploadUrl && !(agentFinished && canOpenChild) ? (item.images ?? []) : [];
  // 动作取标题，目标优先取完整 rawInput；旧 journal 自动回退标题。
  const presentation = presentToolCall(item.title, item.rawInput, { toolKind: item.toolKind, meta: item._meta });
  const fullTarget = presentation.target;
  const target = presentation.targetKind === "path" ? stripWorkdir(fullTarget, workdir) : fullTarget;
  const { action, targetKind } = presentation;
  // 子代理沿用“子会话/查看结果”；其余本地与云端工具统一走结构化详情。
  const detail = !isAgentCard && item.status !== "run" ? toolDetailFor(item) : null;
  const duration = formatToolDuration(item.durationMs);
  const stepRow: CSSProperties = {
    display: "flex",
    gap: 7,
    alignItems: "center",
    paddingLeft: 15,
    fontSize: 11.5,
    lineHeight: 1.7,
    color: "var(--t3)",
    whiteSpace: "nowrap",
    minWidth: 0,
  };
  return (
    <div className={grouped ? "tool-card tool-card-grouped" : "card tool-card"} style={{ padding: "11px 14px", display: "flex", flexDirection: "column", gap: 7, fontSize: 12.5 }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", columnGap: 9, alignItems: "center", minWidth: 0 }}>
        {/* 待审批:⏸ 顶掉运行状态图标,
            解答后回到 run/ok/fail 常规流转 */}
        <span style={{ display: "flex", alignItems: "center" }}>
          {perm ? <span style={{ color: "var(--warn)", fontSize: 11 }}>⏸</span> : <StatusDot status={item.status} />}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, lineHeight: "18px" }}>
          <span title={presentation.rawTool ? `原始工具：${presentation.rawTool}` : undefined} style={{ fontWeight: 500, flex: "none", color: "var(--t2)" }}>{action}</span>
          {target && <ToolTargetText target={target} fullTarget={fullTarget} kind={targetKind} />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 18 }}>
          {duration && <span className="tool-duration" title={`耗时 ${duration}`} style={{ color: "var(--t5)", fontSize: 10.5, whiteSpace: "nowrap" }}>{duration}</span>}
          {item.childSessionId && onOpenChild && (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onOpenChild(item.childSessionId!);
              }}
              style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}
            >
              查看子会话
            </a>
          )}
          {agentResult && !canOpenChild && (
            <button
              type="button"
              className="hv-t1"
              onClick={() => setShowAgentResult((v) => !v)}
              style={{ padding: 0, border: 0, background: "transparent", color: "var(--t5)", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {showAgentResult ? "收起结果" : "查看结果"}
            </button>
          )}
          {detail && (
            <button
              type="button"
              className="hv-t1 tool-detail-toggle"
              aria-label={showDetail ? "收起工具详情" : "展开工具详情"}
              aria-expanded={showDetail}
              title={showDetail ? "收起详情" : "查看详情"}
              onClick={() => setShowDetail((value) => !value)}
              style={{ width: 20, height: 20, padding: 0, border: 0, borderRadius: 5, background: "transparent", display: "grid", placeItems: "center", cursor: "pointer" }}
            >
              <IconChevronRight
                size={9}
                color="var(--t5)"
                style={{ transform: showDetail ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}
              />
            </button>
          )}
        </div>
      </div>
      {visible.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {visible.map((s, i) => {
            const subPresentation = s.kind === "tool" ? presentToolCall(s.title, s.rawInput) : null;
            const subFullTarget = subPresentation?.target ?? "";
            const subTarget = subPresentation?.targetKind === "path" ? stripWorkdir(subFullTarget, workdir) : subFullTarget;
            return (
              <div key={feed.length - visible.length + i} style={stepRow}>
                {s.kind === "tool" ? (
                  <>
                    {stepMark(s.status)}
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, overflow: "hidden" }}>
                      <span style={{ flex: "none", color: "var(--t3)" }}>{subPresentation?.action}</span>
                      {subTarget && subPresentation && (
                        <ToolTargetText target={subTarget} fullTarget={subFullTarget} kind={subPresentation.targetKind} compact />
                      )}
                    </span>
                  </>
                ) : (
                  <MarkdownInline text={s.text} style={{ color: "var(--t5)", flex: 1, minWidth: 0 }} />
                )}
              </div>
            );
          })}
        </div>
      )}
      {summary && (
        <div style={{ marginLeft: 5, borderLeft: "2px solid var(--line)", padding: "2px 0 2px 13px" }}>
          <Markdown text={summary} localImageUrl={uploadUrl} onLocalLink={onLocalLink} />
        </div>
      )}
      {showDetail && detail && (
        <div
          aria-label="工具详情"
          style={{ margin: "2px 0 0 15px", maxHeight: "50vh", overflow: "auto", border: "1px solid var(--line2)", borderRadius: 8, background: "var(--codeBg)" }}
        >
          {detail.kind === "diff" ? (
            <DiffPanel text={detail.text} />
          ) : (
            <pre style={{ margin: 0, padding: "10px 12px", font: "11.5px/1.7 " + MONO, color: "var(--t3)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {detail.text}
            </pre>
          )}
        </div>
      )}
      {item.status === "run" && item.lastLine && (
        <div style={{ ...stepRow, display: "block", color: "var(--t5)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", animation: "mcpulse 1.2s infinite" }}>
          {item.lastLine}
        </div>
      )}
      {item.status === "fail" && item.out && !summary && (
        <div role="alert" title={item.result || item.out} style={{ ...stepRow, display: "block", color: "var(--err)", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.out}
        </div>
      )}
      {/* 内嵌审批:按钮行长在卡内底部(独立大卡不再出现);虚线分隔 +
          警示色标题保住"这是要你拍板"的视觉信号,不给整卡换底色 */}
      {perm && onPermAnswer && (
        <div style={{ borderTop: "1px dashed var(--warnBd)", paddingTop: 9, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--warn)" }}>
            需要确认 · {perm.tool ? toolDisplayName(perm.tool) : "执行操作"}
          </div>
          <PermActions id={perm.id} onAnswer={onPermAnswer} />
        </div>
      )}
      {images.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 15 }}>
          {images.map((p) => (
            <UploadImg
              key={p}
              load={() => uploadUrl!(p)}
              alt={p}
              title={p}
              onClick={() => setZoom(p)}
              style={{
                maxWidth: 180,
                maxHeight: 130,
                borderRadius: 8,
                border: "1px solid var(--line)",
                cursor: "zoom-in",
                display: "block",
              }}
            />
          ))}
        </div>
      )}
      {zoom && (
        <div
          onClick={() => setZoom(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim3)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
          }}
        >
          <UploadImg
            load={() => uploadUrl!(zoom)}
            alt={zoom}
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 10, boxShadow: "var(--shadowLg)" }}
          />
        </div>
      )}
    </div>
  );
}

/** 审批答复回调(独立审批卡与工具卡内嵌按钮行共用签名) */
type PermAnswerFn = (id: string, action: "allow" | "always" | "persist" | "deny") => void;

/** 审批按钮行:允许/本会话始终/此项目永久/拒绝 + 快捷键提示。
 * 从 PermCard 抽出与工具卡内嵌(锚定态)共用——同一套按钮样式与动作
 * 词汇只维护一份,两处渲染不漂移。 */
function PermActions({ id, onAnswer }: { id: string; onAnswer: PermAnswerFn }) {
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

function PermCard({
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

/** 轮次边界只保留呼吸间距；消息天然按用户/助手交替，不再用横线切碎正文。 */
function TurnDivider() {
  return <div aria-label="本轮结束" style={{ height: 2 }} />;
}

/** 连续模型切换属于一件系统事件，折成一条路径，避免多行居中文字占满对话。 */
function ModelSwitchEvent({ names }: { names: string[] }) {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <span style={{ maxWidth: "90%", padding: "3px 9px", borderRadius: 999, background: "var(--codeBg)", color: "var(--t5)", fontSize: 10.5 }}>
        模型 · {names.join(" → ")}
      </span>
    </div>
  );
}

/** 用户消息里的附件行:`[图片]/[文件] <工作区相对路径>`(composer 发送时拼接的约定格式) */
const ATT_LINE = /^\[(图片|文件)\] (\S+)$/;

/** 消息时间:默认隐藏,悬停消息时在其上沿浮出,不参与正文布局。 */
function MessageTime({ timestamp, align }: { timestamp?: number; align: "start" | "end" }) {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  // 用户消息有气泡边框，需要比无底色的 assistant 正文再抬高一点，
  // 否则同一偏移会让时间胶囊压在气泡上沿。
  const top = align === "end" ? -20 : -16;
  return (
    <time
      className="mc-message-time"
      dateTime={date.toISOString()}
      title={date.toLocaleString()}
      style={{ position: "absolute", top, ...(align === "end" ? { right: 0 } : { left: 0 }) }}
    >
      {time}
    </time>
  );
}

/** 用户气泡:文本 + 附图缩略图(点击看大图)+ 文件 chip(点击下载) */
function UserBubble({
  text,
  timestamp,
  uploadUrl,
}: {
  text: string;
  timestamp?: number;
  uploadUrl?: (path: string) => Promise<string>;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  const lines = text.split("\n");
  const images: string[] = [];
  const files: string[] = [];
  const rest: string[] = [];
  for (const line of lines) {
    const m = line.match(ATT_LINE);
    if (m && uploadUrl) (m[1] === "图片" ? images : files).push(m[2]);
    else rest.push(line);
  }
  const body = rest.join("\n").trim();
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div
        className="mc-message-row"
        style={{
          position: "relative",
          maxWidth: "72%",
          background: "var(--userBg)",
          border: "1px solid var(--accBd)",
          borderRadius: "14px 14px 4px 14px",
          padding: "10px 15px",
          fontSize: 13.5,
          lineHeight: 1.6,
          color: "var(--t1)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          animation: "mcin .25s ease",
        }}
      >
        {body}
        {(images.length > 0 || files.length > 0) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: body ? 8 : 2, alignItems: "center" }}>
            {images.map((p) => (
              <UploadImg
                key={p}
                load={() => uploadUrl!(p)}
                alt={p}
                title={p}
                onClick={() => setZoom(p)}
                style={{
                  maxWidth: 150,
                  maxHeight: 120,
                  borderRadius: 8,
                  border: "1px solid var(--accBd)",
                  cursor: "zoom-in",
                  display: "block",
                }}
              />
            ))}
            {files.map((p) => (
              <span
                key={p}
                title={p + "(点击下载)"}
                onClick={() => downloadUpload(() => uploadUrl!(p), p.split("/").pop() || "附件")}
                style={{
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 10px",
                  borderRadius: 8,
                  border: "1px solid var(--accBd)",
                  background: "var(--card)",
                  fontSize: 12,
                  color: "var(--t2)",
                  maxWidth: 240,
                  cursor: "pointer",
                }}
              >
                📄
                <span className="ellipsis">
                  {p.split("/").pop()}
                </span>
              </span>
            ))}
          </div>
        )}
        <MessageTime timestamp={timestamp} align="end" />
      </div>
      {zoom && (
        <div
          onClick={() => setZoom(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim3)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
          }}
        >
          <UploadImg
            load={() => uploadUrl!(zoom)}
            alt={zoom}
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 10, boxShadow: "var(--shadowLg)" }}
          />
        </div>
      )}
    </div>
  );
}

function ItemView({
  item,
  onPermAnswer,
  onAskAnswer,
  uploadUrl,
  onLocalLink,
}: {
  item: Exclude<LogItem, { kind: "tool" }>;
  onPermAnswer: (id: string, action: "allow" | "always" | "persist" | "deny") => void;
  onAskAnswer?: (askId: string, answers: Record<string, string | string[]>) => void;
  uploadUrl?: (path: string) => Promise<string>;
  onLocalLink?: (path: string) => void;
}) {
  switch (item.kind) {
    case "user":
      return <UserBubble text={item.text} timestamp={item.timestamp} uploadUrl={uploadUrl} />;
    case "agent":
      return (
        <div
          className="mc-message-row"
          style={{ position: "relative", maxWidth: "92%", wordBreak: "break-word", animation: "mcin .25s ease" }}
        >
          <Markdown text={item.text} localImageUrl={uploadUrl} onLocalLink={onLocalLink} />
          <MessageTime timestamp={item.timestamp} align="start" />
        </div>
      );
    case "thought":
      return <ThoughtView text={item.text} />;
    case "sys":
      if (item.text === "— 本轮结束 —") return <TurnDivider />;
      return (
        <div style={{ color: item.error ? "var(--err)" : "var(--t5)", fontSize: 11.5, textAlign: "center" }}>
          {item.text}
        </div>
      );
    case "perm":
      return <PermCard item={item} onAnswer={onPermAnswer} />;
    case "ask":
      return <AskCard item={item} onAnswer={onAskAnswer} />;
  }
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
function AskCard({
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
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8, color: hasAnswers ? "var(--acc)" : "var(--t5)", fontSize: 10.5, fontWeight: 700 }}>
            {hasAnswers && <IconCheck size={11} color="var(--acc)" />}
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
            color: "var(--acc)",
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
                <span style={{ flex: "none", fontSize: 10.5, fontWeight: 700, color: "var(--acc)", background: "var(--accBg)", borderRadius: 6, padding: "2px 6px" }}>
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
          <span style={{ color: ready ? "var(--acc)" : "var(--t5)", fontSize: 11.5 }}>
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

/** 对话流:相邻工具调用共享一个卡片外框，以细分割线保留逐项结构。 */
export function LogList({
  items,
  onPermAnswer,
  onAskAnswer,
  onOpenChild,
  uploadUrl,
  onLocalLink,
  workdir,
}: {
  items: LogItem[];
  onPermAnswer: (id: string, action: "allow" | "always" | "persist" | "deny") => void;
  /** 回答 AI 提问卡(云端任务);缺省则提问卡只读 */
  onAskAnswer?: (askId: string, answers: Record<string, string | string[]>) => void;
  onOpenChild?: (id: string) => void;
  /** 已上传附件/工作区图片路径 → 可渲染 URL(不传则本地图片不加载) */
  uploadUrl?: (path: string) => Promise<string>;
  /** Markdown 中工作区文件链接的安全打开动作 */
  onLocalLink?: (path: string) => void;
  /** 工作区根:工具卡标题里的绝对路径按它收敛为相对路径 */
  workdir?: string;
}) {
  // 审批锚定:待决 perm 带 toolCallId 且有同 id 工具卡时,按钮行嵌进
  // 那张卡(见 reduce.ts::permAnchors),对应的独立审批项跳过不渲染;
  // 无锚点(旧引擎/云端任务流/找不到卡)仍走独立 PermCard,行为不变
  const anchors = permAnchors(items);
  const anchored = new Set(anchors.values());
  const out: ReactElement[] = [];
  for (let i = 0; i < items.length; ) {
    const it = items[i];
    const modelName = it.kind === "sys" && !it.error ? it.text.match(/^模型已切换为\s*(.+)$/)?.[1] : undefined;
    if (modelName) {
      const start = i;
      const names: string[] = [];
      while (i < items.length) {
        const next = items[i];
        const name = next.kind === "sys" && !next.error ? next.text.match(/^模型已切换为\s*(.+)$/)?.[1] : undefined;
        if (!name) break;
        names.push(name);
        i++;
      }
      out.push(<ModelSwitchEvent key={"models" + start} names={names} />);
    } else if (it.kind === "tool") {
      const start = i;
      const group: Extract<LogItem, { kind: "tool" }>[] = [];
      while (i < items.length) {
        const t = items[i];
        if (t.kind !== "tool") break;
        group.push(t);
        i++;
      }
      const grouped = group.length > 1;
      out.push(
        <div className={grouped ? "card tool-stack" : undefined} key={"g" + start} style={{ display: "flex", flexDirection: "column", gap: grouped ? 0 : 8, maxWidth: "92%" }}>
          {group.map((t, j) => (
            <ToolCard
              key={t.tcId || j}
              item={t}
              onOpenChild={onOpenChild}
              uploadUrl={uploadUrl}
              onLocalLink={onLocalLink}
              workdir={workdir}
              perm={anchors.get(t.tcId)}
              onPermAnswer={onPermAnswer}
              grouped={grouped}
            />
          ))}
        </div>,
      );
    } else {
      if (it.kind === "perm" && anchored.has(it)) {
        i++; // 已嵌进工具卡,独立卡不渲染
        continue;
      }
      out.push(
        <ItemView
          key={i}
          item={it}
          onPermAnswer={onPermAnswer}
          onAskAnswer={onAskAnswer}
          uploadUrl={uploadUrl}
          onLocalLink={onLocalLink}
        />,
      );
      i++;
    }
  }
  return <>{out}</>;
}

interface DiffRow {
  no: string;
  text: string;
  kind: "h" | "add" | "del" | "ctx";
}

/** unified diff → 带行号的行(行号取新文件侧,删除行取旧文件侧) */
function parseDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldN = 0;
  let newN = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) {
      oldN = +m[1];
      newN = +m[2];
      rows.push({ no: "", text: line, kind: "h" });
      continue;
    }
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("similarity") ||
      line.startsWith("rename") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode")
    )
      continue;
    if (line.startsWith("+")) {
      rows.push({ no: String(newN++), text: line, kind: "add" });
    } else if (line.startsWith("-")) {
      rows.push({ no: String(oldN++), text: line, kind: "del" });
    } else {
      rows.push({ no: String(newN), text: line, kind: "ctx" });
      oldN++;
      newN++;
    }
  }
  return rows;
}

/** diff 面板(改动抽屉的行渲染:36px 行号列 + hunk 灰条 + 增删着色) */
export function DiffPanel({ text }: { text: string }) {
  const rows = useMemo(() => parseDiff(text), [text]);
  if (!rows.some((r) => r.kind === "h")) {
    // 非 diff 内容(加载中/错误/无差异提示)
    return (
      <pre style={{ margin: 0, padding: "10px 24px", font: "12px/1.9 " + MONO, color: "var(--t4)", whiteSpace: "pre-wrap" }}>
        {text}
      </pre>
    );
  }
  return (
    <div style={{ font: "12px/1.9 " + MONO }}>
      {rows.map((r, i) =>
        r.kind === "h" ? (
          <div key={i} style={{ display: "flex", padding: "2px 24px", background: "var(--codeBg)", color: "var(--t4)", fontSize: 11 }}>
            <span style={{ width: 36, flex: "none" }} />
            <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{r.text}</span>
          </div>
        ) : (
          <div
            key={i}
            className="mc-preview-line mc-diff-line"
            data-line-number={r.no}
            style={{
              display: "flex",
              padding: "0 24px",
              background: r.kind === "add" ? "var(--addBg)" : r.kind === "del" ? "var(--delBg)" : "transparent",
              color: r.kind === "add" ? "var(--addT)" : r.kind === "del" ? "var(--delT)" : "var(--t3)",
            }}
          >
            <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", minWidth: 0 }}>{r.text || " "}</span>
          </div>
        ),
      )}
    </div>
  );
}

// ---- 代码预览高亮(文件抽屉查看器) ----

for (const [name, lang] of Object.entries({
  bash, c, cpp, css, go, ini, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml,
})) {
  hljs.registerLanguage(name, lang);
}

/** 扩展名 → highlight.js 语言名(未收录的扩展退回纯文本) */
const EXT_LANG: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  go: "go", py: "python", rs: "rust", java: "java",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp",
  json: "json", css: "css",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml",
  md: "markdown", markdown: "markdown",
  sh: "bash", bash: "bash", zsh: "bash",
  yml: "yaml", yaml: "yaml", sql: "sql",
  ini: "ini", toml: "ini", conf: "ini",
};

/** 高亮 HTML 按行拆分:跨行的 <span>(块注释/模板串)在行尾闭合、次行重开,
 * 使每行成为独立合法片段——行号采用逐行 flex 行(与 DiffPanel 同构),
 * pre-wrap 折行时行号才能与内容对齐(整体 gutter 会错位)。 */
function splitHighlighted(html: string): string[] {
  const out: string[] = [];
  const open: string[] = []; // 行首需要重开的未闭合 <span ...> 栈
  for (const line of html.split("\n")) {
    const prefix = open.join("");
    const re = /<span[^>]*>|<\/span>/g;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m[0] === "</span>") open.pop();
      else open.push(m[0]);
    }
    out.push(prefix + line + "</span>".repeat(open.length));
  }
  return out;
}

const codeLine: CSSProperties = {
  flex: 1,
  minWidth: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: "var(--t2)",
};

/** 文件内容预览:行号 + 按扩展名语法高亮(hljs 输出自带转义);
 * 未知语言/高亮失败退回纯文本行。行号由 CSS 伪元素绘制，不进入复制文本。 */
export function CodeView({ path, text }: { path: string; text: string }) {
  const lines = useMemo(() => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const lang = EXT_LANG[ext];
    if (lang) {
      try {
        return { html: true, rows: splitHighlighted(hljs.highlight(text, { language: lang }).value) };
      } catch {
        /* 高亮失败退回纯文本,不影响阅读 */
      }
    }
    return { html: false, rows: text.split("\n") };
  }, [path, text]);
  return (
    <div style={{ font: "12px/1.9 " + MONO }}>
      {lines.rows.map((l, i) => (
        <div key={i} className="mc-preview-line mc-code-line" data-line-number={i + 1} style={{ display: "flex", padding: "0 24px" }}>
          {lines.html ? (
            <span className="hl" style={codeLine} dangerouslySetInnerHTML={{ __html: l || " " }} />
          ) : (
            <span style={codeLine}>{l || " "}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ==================== 视图镶边共享件(ChatView / CloudTaskView / Sidebar) ====================

/** 视图标题栏:56px 双行,空白区可拖拽窗口(macOS 常规行为)。
 * 几何为本地会话与云端任务两个视图逐像素共用;副标题行整体作 ReactNode
 * 传入(两侧内容与 gap 各异,原样保留)。 */
export function ViewHeader({
  title,
  titleTip,
  subtitle,
  children,
}: {
  title: ReactNode;
  /** 标题的悬停提示(云端传完整任务名;本地不传) */
  titleTip?: string;
  subtitle: ReactNode;
  /** 右侧控件(文件按钮 / ⋯ 菜单) */
  children?: ReactNode;
}) {
  return (
    <div data-tauri-drag-region="" style={{ height: 58, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 26px", borderBottom: "1px solid var(--line2)", background: "rgba(255,255,255,.42)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span className="ellipsis" title={titleTip} style={{ fontWeight: 700, fontSize: 14 }}>
          {title}
        </span>
        {subtitle}
      </div>
      <span data-tauri-drag-region="" style={{ flex: 1, alignSelf: "stretch" }} />
      {children}
    </div>
  );
}

/** 标题栏「文件」按钮(badge 位:本地放改动计数徽标) */
export function HeaderFilesButton({ title, onClick, badge }: { title: string; onClick: () => void; badge?: ReactNode }) {
  return (
    <button
      className="hv"
      title={title}
      onClick={onClick}
      style={{
        height: 28,
        border: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 12px",
        borderRadius: 8,
        background: "var(--card)",
        fontSize: 12,
        color: "var(--t2)",
        cursor: "pointer",
        fontWeight: 600,
        boxShadow: "var(--cardSh)",
        flex: "none",
      }}
    >
      <IconFolder size={12} />
      文件
      {badge}
    </button>
  );
}

/** ⋯ 菜单的三态(closed/open/confirm;confirm = 危险操作的二段确认页) */
export type MenuState = "closed" | "open" | "confirm";

/** 菜单确认页:警示文案 + 确认/取消(三处菜单共用,文案差异走 props) */
export function ConfirmPane({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div style={{ padding: "6px 9px 4px", fontSize: 11.5, color: "var(--t4)", lineHeight: 1.6, maxWidth: 200, whiteSpace: "normal" }}>
        {message}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button className="hv-errbg menu-item" style={{ color: "var(--err)", fontWeight: 600 }} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button className="hv menu-item" onClick={onCancel}>
          取消
        </button>
      </div>
    </>
  );
}

/** 删除菜单项:运行中置灰(先停止才能删),否则进入二段确认 */
export function DeleteMenuItem({ running, onDelete, label = "删除" }: { running: boolean; onDelete: () => void; label?: string }) {
  return running ? (
    <button className="menu-item" style={{ cursor: "default", color: "var(--t5)" }} title="运行中,请先停止">
      <IconTrash color="var(--t5)" />
      {label}
    </button>
  ) : (
    <button className="hv-errbg menu-item" style={{ color: "var(--err)" }} onClick={onDelete}>
      <IconTrash />
      {label}
    </button>
  );
}

/** 标题栏 ⋯ 菜单外壳:触发钮 + backdrop + 上对齐弹层,open 态渲染 children,
 * confirm 态渲染确认页(状态由调用方持有——children 里的菜单项要能置 confirm)。 */
export function HeaderMenu({
  menu,
  setMenu,
  minWidth,
  confirm,
  children,
}: {
  menu: MenuState;
  setMenu: (m: MenuState) => void;
  minWidth: number;
  confirm: { message: string; confirmLabel: string; onConfirm: () => void };
  children: ReactNode;
}) {
  return (
    <div style={{ position: "relative", flex: "none" }}>
      <button
        className="hv icon-btn"
        title="更多"
        onClick={() => setMenu(menu === "closed" ? "open" : "closed")}
        style={{ width: 28, height: 28, borderRadius: 8, background: menu !== "closed" ? "var(--hov)" : "transparent" }}
      >
        <IconDots size={14} color="var(--t5)" />
      </button>
      {menu !== "closed" && (
        <>
          <div className="backdrop" onClick={() => setMenu("closed")} />
          <div className="pop" style={{ position: "absolute", top: 32, right: 0, minWidth }}>
            {menu === "open" ? (
              children
            ) : (
              <ConfirmPane
                message={confirm.message}
                confirmLabel={confirm.confirmLabel}
                onConfirm={() => {
                  setMenu("closed");
                  confirm.onConfirm();
                }}
                onCancel={() => setMenu("closed")}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
