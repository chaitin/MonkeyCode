import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { PlanEntry } from "@/lib/protocol/types";
import { TaskPanel } from "./TaskPanel";

const PLAN: PlanEntry[] = [
  { content: "读代码", status: "completed" },
  { content: "改代码", status: "in_progress" },
  { content: "跑测试", status: "pending" },
];

describe("任务面板", () => {
  it("收起态:一行摘要 = 进度 + 正在项", () => {
    const { container } = render(<TaskPanel entries={PLAN} />);
    expect(container.firstElementChild?.classList.contains("mc-workbench-material")).toBe(true);
    expect(screen.getByText("任务 1/3")).toBeTruthy();
    expect(screen.getByText(/正在:改代码/)).toBeTruthy();
    expect(screen.getByRole("button", { expanded: false })).toBeTruthy();
  });

  it("无进行中项时摘要给「接下来」的 pending 项", () => {
    render(<TaskPanel entries={[{ content: "读代码", status: "completed" }, { content: "写文档", status: "pending" }]} />);
    expect(screen.getByText(/接下来:写文档/)).toBeTruthy();
  });

  it("展开:checkbox 区分 pending/in_progress/completed 三态;摘要行收起", async () => {
    render(<TaskPanel entries={PLAN} />);
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false]);
    expect(boxes.map((b) => b.indeterminate)).toEqual([false, true, false]);
    expect(boxes[1]?.className).toContain("checkbox-primary");
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual(["读代码", "改代码", "跑测试"]);
    // 展开后摘要行不再重复"正在"
    expect(screen.queryByText(/正在:改代码/)).toBeNull();
    expect(screen.getByText("改代码")).toBeTruthy();
  });

  it("依赖提示:未完成依赖 → blocked 行降色 + 「等 #N」;有依赖关系时全员编号", async () => {
    const plan: PlanEntry[] = [
      { id: "a", content: "建表", status: "in_progress" },
      { id: "b", content: "写接口", status: "pending", depends_on: ["a"] },
      { id: "c", content: "跑测试", status: "pending", depends_on: ["a", "b"] },
    ];
    render(<TaskPanel entries={plan} />);
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    // 全员编号("等 #N" 才有落点)
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
    expect(screen.getByText("#3")).toBeTruthy();
    // blocked 推导:b 等 a,c 等 a b;hint 指向未完成依赖的序号
    expect(screen.getByText(/等 #1$/)).toBeTruthy();
    expect(screen.getByText(/等 #1 #2/)).toBeTruthy();
    // blocked 行只降色(文字透明度),不划线
    expect(screen.getByText(/写接口/).className).toContain("opacity-60");
    expect(screen.getByText(/建表/).className).not.toContain("opacity");
  });

  it("依赖已完成不算 blocked;无 depends_on 的清单不编号也无 hint", async () => {
    const { unmount } = render(
      <TaskPanel
        entries={[
          { id: "a", content: "建表", status: "completed" },
          { id: "b", content: "写接口", status: "in_progress", depends_on: ["a"] },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByText(/等 #/)).toBeNull(); // 依赖已完成,无阻塞
    expect(screen.getByText("写接口").className).toContain("text-primary"); // 照常进行中样式
    unmount();

    render(<TaskPanel entries={PLAN} />);
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByText("#1")).toBeNull(); // 无依赖关系不编号
  });

  it("上游显式 blocked 字段优先于本地推导", async () => {
    render(
      <TaskPanel
        entries={[
          { id: "a", content: "建表", status: "pending", blocked: true },
          { id: "b", content: "写接口", status: "pending", depends_on: ["a"], blocked: false },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("建表").className).toContain("opacity-60"); // 显式 blocked
    expect(screen.getByText(/写接口/).className).not.toContain("opacity-60"); // 显式非 blocked,推导不覆盖
  });
});
