import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { RepoEntry } from "@/lib/ipc/repo";
import { Tree } from "./Tree";

const entry = (name: string, path: string, isDir = false, size = 10): RepoEntry => ({ name, path, isDir, size });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("文件树", () => {
  it("懒加载:挂载只拉根,目录点开才拉子层并缩进展示;再展开走缓存", async () => {
    const listDir = vi.fn((dir: string) =>
      Promise.resolve(dir === "" ? [entry("src", "src", true), entry("a.md", "a.md")] : [entry("b.ts", "src/b.ts")]),
    );
    render(<Tree listDir={listDir} onOpenFile={() => {}} activePath={null} />);

    expect(await screen.findByRole("button", { name: /a\.md/ })).toBeTruthy();
    expect(listDir.mock.calls.map((c) => c[0])).toEqual([""]);
    expect(screen.queryByRole("button", { name: /b\.ts/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "src" }));
    const child = await screen.findByRole("button", { name: /b\.ts/ });
    expect(listDir.mock.calls.map((c) => c[0])).toEqual(["", "src"]);
    // 子层比父层多一级缩进
    const parent = screen.getByRole("button", { name: "src" });
    expect(parseInt(child.style.paddingLeft, 10)).toBeGreaterThan(parseInt(parent.style.paddingLeft, 10));

    // 收起再展开不重复拉取
    await userEvent.click(screen.getByRole("button", { name: "src" }));
    await userEvent.click(screen.getByRole("button", { name: "src" }));
    expect(listDir.mock.calls.map((c) => c[0])).toEqual(["", "src"]);
  });

  it("在途目录先出骨架屏,数据到位后替换成行", async () => {
    const d = deferred<RepoEntry[]>();
    const listDir = vi.fn(() => d.promise);
    const { container } = render(<Tree listDir={listDir} onOpenFile={() => {}} activePath={null} />);

    expect(container.querySelector("div[aria-hidden]")).toBeTruthy(); // 骨架行
    expect(screen.queryByRole("button")).toBeNull();

    await act(async () => d.resolve([entry("a.md", "a.md")]));
    expect(screen.getByRole("button", { name: /a\.md/ })).toBeTruthy();
    expect(container.querySelector("div[aria-hidden]")).toBeNull();
  });

  it("列目录失败:错误行外显(role=alert)", async () => {
    const listDir = vi.fn(() => Promise.reject(new Error("读取目录失败: 权限不足")));
    render(<Tree listDir={listDir} onOpenFile={() => {}} activePath={null} />);
    expect((await screen.findByRole("alert")).textContent).toContain("读取目录失败: 权限不足");
  });

  it("根目录为空:整块空态文案", async () => {
    render(<Tree listDir={() => Promise.resolve([])} onOpenFile={() => {}} activePath={null} />);
    expect(await screen.findByText("工作区是空的")).toBeTruthy();
  });

  it("点文件回调 onOpenFile;改动状态以徽标标注", async () => {
    const onOpenFile = vi.fn();
    const changeStatus = new Map([["a.md", "M"]]);
    render(
      <Tree
        listDir={() => Promise.resolve([entry("a.md", "a.md"), entry("b.txt", "b.txt")])}
        onOpenFile={onOpenFile}
        activePath={null}
        changeStatus={changeStatus}
      />,
    );
    const row = await screen.findByRole("button", { name: /a\.md/ });
    expect(row.textContent).toContain("修改");
    await userEvent.click(row);
    expect(onOpenFile).toHaveBeenCalledWith(entry("a.md", "a.md"));
  });
});
