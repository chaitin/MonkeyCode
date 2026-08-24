import { render, screen, waitFor } from "@testing-library/react";
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

  it("Markdown 文件渲染为富文本", () => {
    const { container } = render(
      <Preview model={model({ path: "docs/README.MD", text: "# 标题\n\n- 条目" })} onClose={() => {}} />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("标题");
    expect(container.querySelector("li")?.textContent).toBe("条目");
  });

  it("Markdown 图片与文件链接按当前文件目录解析", async () => {
    const localImageUrl = vi.fn(async () => "data:image/png;base64,AA==");
    const onLocalLink = vi.fn();
    render(
      <Preview
        model={model({ path: "docs/guide/readme.md", text: "![图](../assets/cat.png)\n\n[源码](./src/main.ts)" })}
        resources={{ localImageUrl, onLocalLink }}
        onClose={() => {}}
      />,
    );
    await screen.findByRole("img", { name: "图" });
    expect(localImageUrl).toHaveBeenCalledWith("docs/assets/cat.png");
    await userEvent.click(screen.getByRole("link", { name: "源码" }));
    expect(onLocalLink).toHaveBeenCalledWith("docs/guide/src/main.ts");
  });

  it("Markdown 相对路径逃逸时不调用资源适配器", async () => {
    const localImageUrl = vi.fn(async () => "data:image/png;base64,AA==");
    const onLocalLink = vi.fn();
    render(
      <Preview
        model={model({ path: "docs/readme.md", text: "![图](../../secret.png)\n\n[秘密](../../secret.txt)" })}
        resources={{ localImageUrl, onLocalLink }}
        onClose={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("link", { name: "秘密" }));
    await waitFor(() => expect(screen.getByRole("img", { name: "图" }).getAttribute("aria-busy")).toBeNull());
    expect(localImageUrl).not.toHaveBeenCalled();
    expect(onLocalLink).not.toHaveBeenCalled();
  });

  it("切换 Markdown 路径时同名资源重新按新目录读取", async () => {
    const localImageUrl = vi.fn(async () => "data:image/png;base64,AA==");
    const props = { resources: { localImageUrl }, onClose: () => {} };
    const { rerender } = render(
      <Preview {...props} model={model({ path: "one/readme.md", text: "![图](./cat.png)" })} />,
    );
    await waitFor(() => expect(localImageUrl).toHaveBeenCalledWith("one/cat.png"));
    rerender(<Preview {...props} model={model({ path: "two/readme.md", text: "![图](./cat.png)" })} />);
    await waitFor(() => expect(localImageUrl).toHaveBeenCalledWith("two/cat.png"));
    expect(localImageUrl).toHaveBeenCalledTimes(2);
  });

  it("其他文件正文走代码预览(行号可见)", () => {
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
