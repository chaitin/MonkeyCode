// ReportFindings(代码审查发现)入参解析与中文标签。
// 引擎 schema:findings 按严重度降序;verdict 只在跑过核验时出现
// (CONFIRMED/PLAUSIBLE);outcome 只在修复后复报时出现。字段宽容解析:
// 旧 journal/异构引擎缺字段时行内自然降级,不整卡放弃。

type UnknownRecord = Record<string, unknown>;

export interface ReviewFinding {
  file: string;
  line?: number;
  summary: string;
  /** 紧凑标签(引擎侧 ≤60 字符);缺省时行内退回 summary */
  shortSummary?: string;
  failureScenario?: string;
  category?: string;
  verdict?: string;
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

export interface FindingBadge {
  text: string;
  tone: "err" | "warn" | "ok" | "dim";
}

export function verdictBadge(verdict?: string): FindingBadge | null {
  if (verdict === "CONFIRMED") return { text: "已证实", tone: "err" };
  if (verdict === "PLAUSIBLE") return { text: "疑似", tone: "warn" };
  return null;
}

export function outcomeBadge(outcome?: string): FindingBadge | null {
  switch (outcome) {
    case "fixed":
      return { text: "已修复", tone: "ok" };
    case "skipped":
      return { text: "已跳过", tone: "warn" };
    case "no_change_needed":
      return { text: "无需修改", tone: "dim" };
  }
  // 未来枚举扩展时至少原样可见,不无声吞掉
  return outcome ? { text: outcome, tone: "dim" } : null;
}
