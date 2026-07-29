// 工具卡:状态点、动作/目标、耗时、子代理进度直播、结构化详情与内嵌审批。
import { useEffect, useState, type CSSProperties } from "react";
import { DiffPanel } from "./diffView";
import { parseFindingsReport } from "./findings";
import { FindingsReportView } from "./findingsCard";
import { MONO } from "./fonts";
import { IconCheck, IconChevronRight } from "./icons";
import { Markdown, MarkdownInline } from "./markdown";
import { PermActions, type PermAnswerFn } from "./promptCards";
import { isImageFilename } from "./cloudUpload";
import { frameData } from "./codec";
import { toolDetailFor, toolResultText } from "./toolDetails";
import { presentToolCall, toolDisplayName, type ToolTargetKind } from "./toolLabels";
import type { AcpUpdate, Frame, LogItem } from "./types";
import { UploadImg } from "./uploadMedia";

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

export function ToolCard({
  item,
  onOpenChild,
  uploadUrl,
  onLocalLink,
  workdir,
  perm,
  onPermAnswer,
  loadFullTool,
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
  /** 回读被截断的工具大字段原文(壳侧物化时超 4KB 会截,见 fold.rs);
   * 不传则只展示行内的截断头部 */
  loadFullTool?: (seq: number) => Promise<Frame>;
  /** 相邻工具共享外框时只渲染内部区块，由父级提供卡片底座。 */
  grouped?: boolean;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  const [showAgentResult, setShowAgentResult] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  // 大字段护栏的另一半:行内只有头部时,展开即按 seq 回读原帧补全。
  // 截断与回读必须成对存在——只截不读会把子代理的最终产出切掉半截。
  const srcSeq = (item._meta as { mcSrc?: { seq?: number } } | undefined)?.mcSrc?.seq;
  const [full, setFull] = useState<AcpUpdate | null>(null);
  const [fullErr, setFullErr] = useState("");
  const [loadingFull, setLoadingFull] = useState(false);
  const wantFull = showDetail || showAgentResult;
  useEffect(() => {
    if (!wantFull || srcSeq === undefined || full || loadingFull || fullErr || !loadFullTool) return;
    setLoadingFull(true);
    loadFullTool(srcSeq)
      .then((f) => {
        const u = frameData<{ update?: AcpUpdate }>(f)?.update;
        if (u) setFull(u);
        else setFullErr("原始记录已不可用");
      })
      .catch((e) => setFullErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingFull(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantFull, srcSeq]);
  const feed = item.feed ?? [];
  // 子代理运行时卡内直播少量进度;完成后无论同步/后台都收成单行,
  // 完整过程与最终产出统一从子会话查看。
  const isAgentCard = !!(item.childSessionId || feed.length || item.background);
  const agentFinished = isAgentCard && item.status !== "run";
  const canOpenChild = !!(item.childSessionId && onOpenChild);
  const fullResult = full ? toolResultText(full.rawOutput, full.content) : "";
  const agentResult = agentFinished ? (fullResult || item.result || "").trim() : "";
  const visible = agentFinished ? [] : feed.slice(-FEED_WINDOW);
  // 极端情况下子会话入口缺失(云端只读流/旧 journal),保留按需展开兜底,
  // 但不再默认把整段结果灌进卡片。
  const summary = agentResult && !canOpenChild && showAgentResult ? agentResult : "";
  // 按扩展名过滤:修复前壳侧把 uploads 下所有路径(docx/json/.gitignore)
  // 都当图片落进 images 帧,老 journal 回放时这些路径进 <img> 就是裂图
  const images = uploadUrl && !(agentFinished && canOpenChild) ? (item.images ?? []).filter(isImageFilename) : [];
  // 动作取标题，目标优先取完整 rawInput；旧 journal 自动回退标题。
  const presentation = presentToolCall(item.title, item.rawInput, { toolKind: item.toolKind, meta: item._meta });
  const fullTarget = presentation.target;
  const target = presentation.targetKind === "path" ? stripWorkdir(fullTarget, workdir) : fullTarget;
  const { action, targetKind } = presentation;
  // 子代理沿用“子会话/查看结果”；其余本地与云端工具统一走结构化详情。
  // 回读到全文后用全文渲染详情;没有护栏标记时 full 恒为 null,行为不变
  const shown = full
    ? {
        ...item,
        ...(full.rawInput !== undefined ? { rawInput: full.rawInput } : {}),
        ...(full.rawOutput !== undefined ? { rawOutput: full.rawOutput } : {}),
        ...(full.content !== undefined ? { content: full.content } : {}),
      }
    : item;
  // ReportFindings 走结构化发现列表;详情(原始 JSON)保留作兜底
  const findingsReport = presentation.rawTool === "ReportFindings" ? parseFindingsReport(shown.rawInput) : null;
  const detail = !isAgentCard && shown.status !== "run" ? toolDetailFor(shown) : null;
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
      {findingsReport && <FindingsReportView report={findingsReport} onOpenFile={onLocalLink} />}
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
      {wantFull && (loadingFull || fullErr) && (
        <div style={{ ...stepRow, display: "block", color: fullErr ? "var(--err)" : "var(--t5)" }}>
          {fullErr ? `⚠ 完整内容取不回来了: ${fullErr}` : "正在取完整内容…"}
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
