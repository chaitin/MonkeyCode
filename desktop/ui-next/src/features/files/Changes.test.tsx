import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Changes } from "./Changes";

describe("改动列表", () => {
  it("null = 加载中;空数组 = 空态文案", () => {
    const { rerender } = render(<Changes changes={null} activePath={null} onOpen={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("加载中");

    rerender(<Changes changes={[]} activePath={null} onOpen={() => {}} />);
    expect(screen.getByText("没有未提交的改动")).toBeTruthy();
  });

  it("状态徽标 + 文件名/目录 + 可选 +N/-N;删除行有删除线语义", () => {
    render(
      <Changes
        changes={[
          { path: "src/a.ts", status: "M", additions: 3, deletions: 1 },
          { path: "b.txt", status: "A" },
          { path: "gone.rs", status: "D" },
        ]}
        activePath={null}
        onOpen={() => {}}
      />,
    );
    const modified = screen.getByRole("button", { name: /a\.ts/ });
    expect(modified.textContent).toContain("修改");
    expect(modified.textContent).toContain("src"); // 目录列
    expect(modified.textContent).toContain("+3");
    expect(modified.textContent).toContain("-1");

    const added = screen.getByRole("button", { name: /b\.txt/ });
    expect(added.textContent).toContain("新增");
    expect(added.textContent).not.toContain("+"); // 本地无增删统计则整列缺席

    expect(screen.getByRole("button", { name: /gone\.rs/ }).textContent).toContain("删除");
  });

  it("按路径排序;点击行回调 onOpen(path)", async () => {
    const onOpen = vi.fn();
    render(
      <Changes
        changes={[
          { path: "z/last.ts", status: "M" },
          { path: "a/first.ts", status: "M" },
        ]}
        activePath={null}
        onOpen={onOpen}
      />,
    );
    const rows = screen.getAllByRole("button");
    expect(rows[0]?.textContent).toContain("first.ts");
    await userEvent.click(rows[0] as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith("a/first.ts");
  });

  it("未知状态词退回原文徽标(云端超集词到齐前不装死)", () => {
    render(<Changes changes={[{ path: "x.ts", status: "T" }]} activePath={null} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /x\.ts/ }).textContent).toContain("T");
  });
});
