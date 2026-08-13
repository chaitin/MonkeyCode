// 审查发现列表(report_findings 工具卡体):每条一行——严重度点/徽标 +
// 摘要(行内 markdown)+ file:line(mono)+ 处置徽标,展开看完整描述与
// 失败场景。空列表渲染"未发现问题"完成态,而不是空白卡。
// 字段宽容解析(对表旧工程 findings.ts):旧 journal/异构引擎缺字段时
// 行内自然降级,不整卡放弃。
import { IconShieldCheck } from "@tabler/icons-react";

import { Markdown, MarkdownInline } from "@/components/markdown/Markdown";
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { ToolItem } from "@/lib/protocol/types";
import { statusDot } from "./statusDot";

type UnknownRecord = Record<string, unknown>;

export interface ReviewFinding {
  file: string;
  line?: number;
  summary: string;
  /** 紧凑标签(引擎侧 ≤60 字符);缺省时行内退回 summary */
  shortSummary?: string;
  failureScenario?: string;
  category?: string;
  /** 核验结论:CONFIRMED/PLAUSIBLE(未核验则缺席) */
  verdict?: string;
  /** 处置结果:fixed/skipped/no_change_needed(修复后复报才有) */
  outcome?: string;
}

export interface FindingsReport {
  findings: ReviewFinding[];
  level?: string;
}

function rec(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function parseFindingsReport(rawInput: unknown): FindingsReport | null {
  const input = rec(rawInput);
  if (!input || !Array.isArray(input.findings)) return null;
  const findings: ReviewFinding[] = [];
  for (const entry of input.findings) {
    const f = rec(entry);
    if (!f) continue;
    const summary = str(f.summary) ?? str(f.short_summary);
    const file = str(f.file);
    if (!summary && !file) continue;
    findings.push({
      file: file ?? "",
      line: typeof f.line === "number" && Number.isFinite(f.line) && f.line > 0 ? Math.floor(f.line) : undefined,
      summary: summary ?? "",
      shortSummary: str(f.short_summary),
      failureScenario: str(f.failure_scenario),
      category: str(f.category),
      verdict: str(f.verdict),
      outcome: str(f.outcome),
    });
  }
  return { findings, level: str(input.level) };
}

/** report_findings 判定:标题首词(旧 journal 是 "ReportFindings …")或
 * ACP kind,大小写/连字符/下划线归一后比对;命中才解析 rawInput。 */
export function findingsReportFor(item: Pick<ToolItem, "title" | "toolKind" | "rawInput">): FindingsReport | null {
  const norm = (v: string) => v.toLowerCase().replace(/[_-]/g, "");
  const token = (item.title.trim().split(/\s+/)[0] ?? "").replace(/:+$/, "");
  const hit = norm(token) === "reportfindings" || norm(item.toolKind ?? "") === "reportfindings";
  return hit ? parseFindingsReport(item.rawInput) : null;
}

interface BadgeSpec {
  key: MessageKey | null;
  raw?: string;
  cls: string;
}

function verdictBadge(verdict?: string): BadgeSpec | null {
  if (verdict === "CONFIRMED") return { key: "chat.findings.confirmed", cls: "badge badge-error badge-soft badge-xs" };
  if (verdict === "PLAUSIBLE") return { key: "chat.findings.plausible", cls: "badge badge-warning badge-soft badge-xs" };
  return null;
}

function outcomeBadge(outcome?: string): BadgeSpec | null {
  switch (outcome) {
    case "fixed":
      return { key: "chat.findings.fixed", cls: "badge badge-success badge-soft badge-xs" };
    case "skipped":
      return { key: "chat.findings.skipped", cls: "badge badge-warning badge-soft badge-xs" };
    case "no_change_needed":
      return { key: "chat.findings.noChange", cls: "badge badge-ghost badge-xs" };
  }
  // 未来枚举扩展时至少原样可见,不无声吞掉
  return outcome ? { key: null, raw: outcome, cls: "badge badge-ghost badge-xs" } : null;
}

function FindingRow({ finding, onOpenFile }: { finding: ReviewFinding; onOpenFile?: (path: string) => void }) {
  const { t } = useI18n();
  const title = finding.shortSummary || finding.summary;
  // 展开块只放行内没有的信息:完整一句话(与行内不同时)+ 失败场景
  const detail = [
    finding.summary && finding.summary !== title ? finding.summary : "",
    finding.failureScenario ? `**${t("chat.findings.failure")}**:${finding.failureScenario}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const filename = finding.file.split(/[\\/]/).pop() ?? "";
  // 超长文件名截中段:行内 file:line 是 nowrap 的 flex 项,不设上限会把
  // 整行挤爆——flex-1 的摘要列被压成一字一行的竖排(2026-08-12 截图报障,
  // 现场 basename 70+ 字符)。截中段而非 CSS 尾部省略:尾部的扩展名与
  // :行号恰是定位的关键;完整路径一直在 title/tooltip 里。按码点切,
  // 中文文件名不撕裂代理对
  const chars = Array.from(filename);
  const shown = chars.length > 44 ? `${chars.slice(0, 26).join("")}…${chars.slice(-14).join("")}` : filename;
  const location = shown ? (finding.line ? `${shown}:${finding.line}` : shown) : "";
  const dot = statusDot(
    finding.verdict === "CONFIRMED" ? "fail" : finding.verdict === "PLAUSIBLE" ? "warn" : "idle",
  );
  const verdict = verdictBadge(finding.verdict);
  const outcome = outcomeBadge(finding.outcome);
  const row = (
    <>
      <span aria-hidden className={dot} />
      {verdict && <span className={verdict.cls}>{verdict.key ? t(verdict.key) : verdict.raw}</span>}
      <MarkdownInline source={title} className="min-w-0 flex-1" />
      {/* 分类 chip(旧 findingsCard.tsx 摘要与 file:line 之间那枚 mono 标签):
          category 一路解析进 ReviewFinding 却从不进 JSX,发现条数一多就失去
          按类别(correctness / test-coverage / efficiency…)快速扫读的能力。
          引擎侧是自由字符串,不进词典、原样显示 */}
      {finding.category && (
        <span className="badge badge-ghost badge-xs shrink-0 font-mono">{finding.category}</span>
      )}
      {location &&
        (onOpenFile ? (
          // file:line 可点定位(旧 findingsCard.tsx onOpenFile 设计):
          // 行可能在 <summary> 里,preventDefault/stopPropagation 保证这一
          // 下只归定位,不顺手切换展开态
          <button
            type="button"
            title={finding.file + (finding.line ? `:${finding.line}` : "")}
            // truncate + 上限是窄窗口的兜底(JS 截中段管的是常规宽度):
            // overflow-hidden 让 flex 最小尺寸归零,永远轮不到摘要列被挤扁
            className="link link-hover max-w-[50%] truncate font-mono text-base-content/50"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenFile(finding.file);
            }}
          >
            {location}
          </button>
        ) : (
          <span title={finding.file + (finding.line ? `:${finding.line}` : "")} className="max-w-[50%] truncate font-mono text-base-content/50">
            {location}
          </span>
        ))}
      {outcome && <span className={outcome.cls}>{outcome.key ? t(outcome.key) : outcome.raw}</span>}
    </>
  );
  // 两种行同给 py-1:collapse-title 默认 padding:1rem 会把每行撑出近 40px
  // 行距(2026-08-12 截图报障),压到 py-1/ps-0 与无展开行同一节奏;
  // pe 不动,留给 collapse-arrow 的 3rem 箭头位
  if (!detail) return <div className="flex items-center gap-2 py-1 text-xs">{row}</div>;
  return (
    <details className="collapse collapse-arrow text-xs">
      <summary className="collapse-title flex min-h-0 items-center gap-2 py-1 ps-0">{row}</summary>
      <div className="collapse-content pb-2">
        <Markdown source={detail} className="opacity-80" />
      </div>
    </details>
  );
}

export function FindingsCard({
  report,
  onOpenFile,
}: {
  report: FindingsReport;
  /** file:line 点击定位(ChatView 的 revealMarkdownLink 经 ToolCard 透传);
   * 缺省保持纯文本展示。 */
  onOpenFile?: (path: string) => void;
}) {
  const { t } = useI18n();
  if (report.findings.length === 0) {
    // 空态统一形态:图标 + 标题档,居中
    return (
      <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
        {/* success 色而非中性灰:「未发现问题」是成功结论,盾牌是这卡唯一
            的状态显影,灰色读起来像"没启用"(2026-08-12 反馈) */}
        <IconShieldCheck size={20} stroke={1.75} className="text-success" aria-hidden />
        <div className="text-sm font-semibold">{t("chat.findings.empty")}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2">
      {report.findings.map((finding, i) => (
        <FindingRow key={i} finding={finding} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
}
