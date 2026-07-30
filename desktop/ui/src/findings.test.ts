import { describe, expect, it } from "vitest";

import { outcomeBadge, parseFindingsReport, verdictBadge } from "./findings";

describe("parseFindingsReport", () => {
  it("解析 findings 数组与全部可选字段", () => {
    const report = parseFindingsReport({
      level: "high",
      findings: [
        {
          file: "src/foo.ts",
          line: 120,
          summary: "分页游标未透传导致漏数据",
          short_summary: "分页游标未透传",
          failure_scenario: "第二页请求返回第一页内容",
          category: "correctness",
          verdict: "CONFIRMED",
          outcome: "fixed",
        },
      ],
    });

    expect(report).toEqual({
      level: "high",
      findings: [
        {
          file: "src/foo.ts",
          line: 120,
          summary: "分页游标未透传导致漏数据",
          shortSummary: "分页游标未透传",
          failureScenario: "第二页请求返回第一页内容",
          category: "correctness",
          verdict: "CONFIRMED",
          outcome: "fixed",
        },
      ],
    });
  });

  it("非对象入参或缺 findings 数组时返回 null", () => {
    expect(parseFindingsReport(undefined)).toBeNull();
    expect(parseFindingsReport("{}")).toBeNull();
    expect(parseFindingsReport({ level: "low" })).toBeNull();
    expect(parseFindingsReport({ findings: "none" })).toBeNull();
  });

  it("空数组保留为空报告(渲染完成态),坏条目被跳过", () => {
    expect(parseFindingsReport({ findings: [] })?.findings).toEqual([]);
    const report = parseFindingsReport({
      findings: [null, "text", {}, { file: "a.ts", summary: "有效发现" }],
    });
    expect(report?.findings).toHaveLength(1);
    expect(report?.findings[0].file).toBe("a.ts");
  });

  it("line 非法值丢弃,小数取整", () => {
    const parse = (line: unknown) =>
      parseFindingsReport({ findings: [{ file: "a.ts", summary: "s", line }] })?.findings[0].line;
    expect(parse(-1)).toBeUndefined();
    expect(parse("12")).toBeUndefined();
    expect(parse(NaN)).toBeUndefined();
    expect(parse(3.7)).toBe(3);
  });
});

describe("徽标标签", () => {
  it("verdict 映射已证实/疑似,未知返回 null", () => {
    expect(verdictBadge("CONFIRMED")).toEqual({ text: "已证实", tone: "err" });
    expect(verdictBadge("PLAUSIBLE")).toEqual({ text: "疑似", tone: "warn" });
    expect(verdictBadge(undefined)).toBeNull();
  });

  it("outcome 映射修复结果,未知枚举原样降级展示", () => {
    expect(outcomeBadge("fixed")).toEqual({ text: "已修复", tone: "ok" });
    expect(outcomeBadge("skipped")).toEqual({ text: "已跳过", tone: "warn" });
    expect(outcomeBadge("no_change_needed")).toEqual({ text: "无需修改", tone: "dim" });
    expect(outcomeBadge("deferred")).toEqual({ text: "deferred", tone: "dim" });
    expect(outcomeBadge(undefined)).toBeNull();
  });
});
