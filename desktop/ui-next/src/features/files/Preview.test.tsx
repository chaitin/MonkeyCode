import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Preview, type PreviewModel } from "./Preview";

const model = (over: Partial<PreviewModel>): PreviewModel => ({
  path: "src/a.txt",
  mode: "file",
  state: "ready",
  text: "",
  ...over,
});

describe("预览窗格", () => {
  it("头部展示文件名与全路径,✕ 回调 onClose", async () => {
    const onClose = vi.fn();
    render(<Preview model={model({ text: "hi" })} onClose={onClose} />);
    expect(screen.getByText("a.txt")).toBeTruthy();
    expect(screen.getByText("src/a.txt")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("改动状态经徽标外显", () => {
    render(<Preview model={model({ text: "hi" })} status="M" onClose={() => {}} />);
    expect(screen.getByText("修改")).toBeTruthy();
  });

  it("loading → 加载中;error → ✗ 原因", () => {
    const { rerender } = render(<Preview model={model({ state: "loading" })} onClose={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("加载中");

    rerender(<Preview model={model({ state: "error", text: "文件过大(2097152 字节)" })} onClose={() => {}} />);
    expect(screen.getByRole("alert").textContent).toBe("✗ 文件过大(2097152 字节)");
  });

  it("文件态占位:空文件/二进制", () => {
    const { rerender } = render(<Preview model={model({ text: "" })} onClose={() => {}} />);
    expect(screen.getByText("(空文件)")).toBeTruthy();

    rerender(<Preview model={model({ text: "PK\0binary" })} onClose={() => {}} />);
    expect(screen.getByText("二进制文件,不支持预览")).toBeTruthy();
  });

  it("文件态正文走代码预览(行号可见)", () => {
    render(<Preview model={model({ path: "note.txt", text: "hello" })} onClose={() => {}} />);
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("diff 态:空 diff 占位;有 hunk 走 diff 渲染", () => {
    const { rerender } = render(<Preview model={model({ mode: "diff", text: "" })} onClose={() => {}} />);
    expect(screen.getByText("(无差异)")).toBeTruthy();

    rerender(<Preview model={model({ mode: "diff", text: "@@ -1 +1 @@\n-old\n+new\n" })} onClose={() => {}} />);
    expect(screen.getByText("@@ -1 +1 @@")).toBeTruthy();
    expect(screen.getByText("new")).toBeTruthy();
  });
});
