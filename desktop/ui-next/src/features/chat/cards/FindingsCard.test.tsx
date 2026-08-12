import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FindingsCard, findingsReportFor, parseFindingsReport } from "./FindingsCard";

describe("parseFindingsReport(字段宽容解析)", () => {
  it("完整字段解析(short_summary/failure_scenario 蛇形命名)", () => {
    const report = parseFindingsReport({
      level: "high",
      findings: [
        {
          file: "src/a.ts",
          line: 7,
          summary: "完整的一句话",
          short_summary: "短摘要",
          failure_scenario: "并发时丢更新",
          category: "logic",
          verdict: "PLAUSIBLE",
          outcome: "fixed",
        },
      ],
    });
    expect(report).toEqual({
      level: "high",
      findings: [
        {
          file: "src/a.ts",
          line: 7,
          summary: "完整的一句话",
          shortSummary: "短摘要",
          failureScenario: "并发时丢更新",
          category: "logic",
          verdict: "PLAUSIBLE",
          outcome: "fixed",
        },
      ],
    });
  });

  it("非法输入返回 null;缺 summary 与 file 的条目丢弃;非法 line 丢弃", () => {
    expect(parseFindingsReport(null)).toBeNull();
    expect(parseFindingsReport({ findings: "x" })).toBeNull();
    const report = parseFindingsReport({
      findings: [{ category: "noise" }, { file: "b.ts", line: -3, summary: "有效" }],
    });
    expect(report?.findings).toEqual([{ file: "b.ts", summary: "有效", line: undefined, shortSummary: undefined, failureScenario: undefined, category: undefined, verdict: undefined, outcome: undefined }]);
  });
});

describe("findingsReportFor(report_findings 判定)", () => {
  const raw = { findings: [{ file: "a.ts", summary: "x" }] };
  it("标题首词 ReportFindings 命中(含冒号尾巴)", () => {
    expect(findingsReportFor({ title: "ReportFindings: 2 项", rawInput: raw })).not.toBeNull();
  });
  it("toolKind report_findings 命中", () => {
    expect(findingsReportFor({ title: "汇报审查发现", toolKind: "report_findings", rawInput: raw })).not.toBeNull();
  });
  it("普通工具不命中(即使入参形似 findings)", () => {
    expect(findingsReportFor({ title: "Read src/a.ts", rawInput: raw })).toBeNull();
  });
});

describe("发现列表渲染", () => {
  it("空列表渲染「未发现问题」完成态", () => {
    render(<FindingsCard report={{ findings: [] }} />);
    expect(screen.getByText("本轮审查未发现需要处理的问题")).toBeTruthy();
  });

  it("行:严重度徽标 + 摘要(行内 markdown)+ file:line mono + 处置徽标", () => {
    render(
      <FindingsCard
        report={{
          findings: [
            {
              file: "src/deep/auth.ts",
              line: 42,
              summary: "`token` 未做过期校验",
              verdict: "CONFIRMED",
              outcome: "fixed",
            },
            { file: "b.ts", summary: "疑似空指针", verdict: "PLAUSIBLE" },
          ],
        }}
      />,
    );
    expect(screen.getByText("已证实")).toBeTruthy();
    expect(screen.getByText("token").tagName).toBe("CODE"); // MarkdownInline 生效
    expect(screen.getByText("auth.ts:42")).toBeTruthy();
    expect(screen.getByText("已修复")).toBeTruthy();
    expect(screen.getByText("疑似")).toBeTruthy();
    expect(screen.getByText("b.ts")).toBeTruthy(); // 无行号只显文件名
  });

  it("展开块:完整描述与失败场景(行内没有的信息)", () => {
    render(
      <FindingsCard
        report={{
          findings: [
            {
              file: "a.ts",
              summary: "完整的一句话描述",
              shortSummary: "短摘要",
              failureScenario: "高并发下丢更新",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("短摘要")).toBeTruthy();
    expect(screen.getByText("完整的一句话描述")).toBeTruthy();
    expect(screen.getByText(/高并发下丢更新/)).toBeTruthy();
    expect(screen.getByText("失败场景")).toBeTruthy();
  });

  it("超长文件名截中段:保尾部扩展名与行号,tooltip 留完整路径(挤扁摘要列的截图报障)", () => {
    const long = "Nsfocus_VPT_Model_OneClick_Interactive_FIXED_V2_NO_TIME_DECAY_ASSET20_RISK45.py";
    render(<FindingsCard report={{ findings: [{ file: `deep/${long}`, line: 355, summary: "x" }] }} />);
    const el = screen.getByText(/…/);
    expect(el.textContent).toBe("Nsfocus_VPT_Model_OneClick…ET20_RISK45.py:355");
    expect(el.getAttribute("title")).toBe(`deep/${long}:355`);
  });

  it("未知 outcome 枚举原样外显,不无声吞掉", () => {
    render(<FindingsCard report={{ findings: [{ file: "a.ts", summary: "x", outcome: "deferred" }] }} />);
    expect(screen.getByText("deferred")).toBeTruthy();
  });

  it("file:line 可点:传 onOpenFile 时定位是按钮,点击回调完整路径;不传保持纯文本", async () => {
    const onOpenFile = vi.fn();
    const { unmount } = render(
      <FindingsCard
        report={{ findings: [{ file: "src/deep/auth.ts", line: 42, summary: "短摘要", failureScenario: "崩" }] }}
        onOpenFile={onOpenFile}
      />,
    );
    // 行内展示仍是 文件名:行号,回调给的是完整路径(reveal 需要)
    await userEvent.click(screen.getByRole("button", { name: "auth.ts:42" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/deep/auth.ts");
    unmount();

    render(<FindingsCard report={{ findings: [{ file: "src/deep/auth.ts", line: 42, summary: "短摘要" }] }} />);
    expect(screen.queryByRole("button", { name: "auth.ts:42" })).toBeNull();
    expect(screen.getByText("auth.ts:42")).toBeTruthy();
  });

  it("file 无值:即便传了 onOpenFile 也不渲染点击件", () => {
    render(<FindingsCard report={{ findings: [{ file: "", summary: "只有摘要" }] }} onOpenFile={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
