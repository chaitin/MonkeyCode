// 审查发现列表(ReportFindings 工具卡体):每条发现一行——核验徽标 +
// 摘要 + 分类 + 文件定位 + 处置结果,点击展开完整描述与失败场景。
// 空列表渲染"未发现问题"的完成态,而不是空白卡。
import { useState, type CSSProperties } from "react";
import { MONO } from "./fonts";
import { IconCheck, IconChevronRight } from "./icons";
import { Markdown, MarkdownInline } from "./markdown";
import { outcomeBadge, verdictBadge, type FindingBadge, type FindingsReport, type ReviewFinding } from "./findings";

const TONE: Record<FindingBadge["tone"], CSSProperties> = {
  err: { background: "var(--errBg)", color: "var(--err)" },
  warn: { background: "var(--warnBg)", color: "var(--warn)" },
  ok: { background: "var(--accBg)", color: "var(--accTx)" },
  dim: { background: "var(--codeBg)", color: "var(--t5)" },
};

function Badge({ badge }: { badge: FindingBadge }) {
  return (
    <span style={{ ...TONE[badge.tone], flex: "none", fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: "1px 6px", whiteSpace: "nowrap" }}>
      {badge.text}
    </span>
  );
}

/** 严重度点:已证实红、疑似黄、未核验灰;徽标之外保住行首的统一节奏。 */
function severityColor(verdict?: string): string {
  if (verdict === "CONFIRMED") return "var(--err)";
  if (verdict === "PLAUSIBLE") return "var(--warn)";
  return "var(--t6)";
}

function FindingRow({ finding, onOpenFile }: { finding: ReviewFinding; onOpenFile?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const verdict = verdictBadge(finding.verdict);
  const outcome = outcomeBadge(finding.outcome);
  const title = finding.shortSummary || finding.summary;
  // 展开块只放行内没有的信息:完整一句话(与行内不同时)+ 失败场景
  const detail = [
    finding.summary && finding.summary !== title ? finding.summary : "",
    finding.failureScenario ? `**失败场景**:${finding.failureScenario}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const filename = finding.file.split(/[\\/]/).pop() ?? "";
  const location = filename ? (finding.line ? `${filename}:${finding.line}` : filename) : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div
        onClick={detail ? () => setOpen((v) => !v) : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          minWidth: 0,
          fontSize: 11.5,
          lineHeight: 1.7,
          cursor: detail ? "pointer" : "default",
          userSelect: "none",
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: severityColor(finding.verdict), flex: "none" }} />
        {verdict && <Badge badge={verdict} />}
        <MarkdownInline text={title} style={{ flex: 1, minWidth: 0, color: "var(--t2)", fontWeight: 500 }} />
        {finding.category && (
          <span style={{ flex: "none", color: "var(--t5)", font: `10px/1.6 ${MONO}`, background: "var(--codeBg)", borderRadius: 6, padding: "1px 6px", whiteSpace: "nowrap" }}>
            {finding.category}
          </span>
        )}
        {location &&
          (onOpenFile ? (
            <button
              type="button"
              className="hv-t1"
              title={finding.file + (finding.line ? `:${finding.line}` : "")}
              onClick={(e) => {
                e.stopPropagation();
                onOpenFile(finding.file);
              }}
              style={{ flex: "none", padding: 0, border: 0, background: "transparent", color: "var(--t5)", font: `11px/1.6 ${MONO}`, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {location}
            </button>
          ) : (
            <span title={finding.file} style={{ flex: "none", color: "var(--t5)", font: `11px/1.6 ${MONO}`, whiteSpace: "nowrap" }}>{location}</span>
          ))}
        {outcome && <Badge badge={outcome} />}
        {detail && (
          <IconChevronRight
            size={9}
            color="var(--t6)"
            style={{ flex: "none", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}
          />
        )}
      </div>
      {open && detail && (
        <div
          className="selectable finding-md"
          style={{ marginLeft: 2, borderLeft: "2px solid var(--line)", padding: "1px 0 1px 10px", wordBreak: "break-word", animation: "mcin .2s ease" }}
        >
          <Markdown text={detail} />
        </div>
      )}
    </div>
  );
}

export function FindingsReportView({ report, onOpenFile }: { report: FindingsReport; onOpenFile?: (path: string) => void }) {
  if (!report.findings.length) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 7, paddingLeft: 15, fontSize: 11.5, lineHeight: 1.7, color: "var(--t4)" }}>
        <IconCheck size={10} />
        <span>本轮审查未发现需要处理的问题</span>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, paddingLeft: 15, minWidth: 0 }}>
      {report.findings.map((finding, i) => (
        <FindingRow key={i} finding={finding} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
}
