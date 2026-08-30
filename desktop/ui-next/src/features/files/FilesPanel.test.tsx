// FilesPanel(自 FilesDrawer.test 移植,2026-08-30 侧边栏改造):抽屉形态
// 专属的宽度/scrim/Esc 关面板用例随形态退役;树懒加载/预览/改动/定位/
// Markdown 判界等数据面契约原样钉住。
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilesPanel } from "./FilesPanel";

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.removeAttribute("style");
});

interface CallRecord {
  kind: string;
  payload: Record<string, unknown>;
}

/** 壳桩:session_call 按 kind 分派(与 driver/mod.rs::session_call 同构)。 */
function stubShell(opts: {
  list?: Record<string, unknown[]>;
  changes?: unknown;
  content?: string;
  diff?: string;
  imageUrl?: string;
  /** repo_reveal 的应答;缺省成功 */
  reveal?: unknown;
}) {
  const calls: CallRecord[] = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "upload_read") {
          calls.push({ kind: cmd, payload: args ?? {} });
          return Promise.resolve(opts.imageUrl ?? "data:image/png;base64,AA==");
        }
        if (cmd !== "session_call") return Promise.resolve(null);
        const kind = String(args?.kind);
        const payload = (args?.payload ?? {}) as Record<string, unknown>;
        calls.push({ kind, payload });
        if (kind === "repo_file_list") return Promise.resolve({ result: opts.list?.[String(payload.path)] ?? [] });
        if (kind === "repo_file_changes") return Promise.resolve(opts.changes ?? { result: [], is_git_repo: true });
        if (kind === "repo_read_file") return Promise.resolve({ result: { content: opts.content ?? "" } });
        if (kind === "repo_file_diff") return Promise.resolve({ result: { diff: opts.diff ?? "" } });
        if (kind === "repo_reveal") return Promise.resolve(opts.reveal ?? { result: { ok: true } });
        return Promise.resolve({ result: null });
      },
    },
  };
  return calls;
}

const entry = (name: string, path: string, isDir = false) => ({ name, path, is_dir: isDir, size: 12 });
const flush = () => act(() => Promise.resolve());

describe("文件面板", () => {
  it("树懒加载:根目录挂载即拉,子目录点开才拉,收起再展开走缓存", async () => {
    const calls = stubShell({
      list: {
        "": [entry("src", "src", true), entry("README.md", "README.md")],
        src: [entry("index.ts", "src/index.ts")],
      },
    });
    render(<FilesPanel sessionId="s1" tab="files" />);

    expect(await screen.findByRole("button", { name: /README\.md/ })).toBeTruthy();
    const listCalls = () => calls.filter((c) => c.kind === "repo_file_list").map((c) => c.payload.path);
    expect(listCalls()).toEqual([""]);

    await userEvent.click(screen.getByRole("button", { name: "src" }));
    expect(await screen.findByRole("button", { name: /index\.ts/ })).toBeTruthy();
    expect(listCalls()).toEqual(["", "src"]);

    // 收起再展开:走缓存,不再发请求
    await userEvent.click(screen.getByRole("button", { name: "src" }));
    expect(screen.queryByRole("button", { name: /index\.ts/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "src" }));
    expect(screen.getByRole("button", { name: /index\.ts/ })).toBeTruthy();
    expect(listCalls()).toEqual(["", "src"]);
  });

  it("文件点击 → 读取内容并在右侧预览区展示(带行号);未选中时是占位空态", async () => {
    stubShell({ list: { "": [entry("note.txt", "note.txt")] }, content: "hello world" });
    render(<FilesPanel sessionId="s1" tab="files" />);

    expect(await screen.findByText("选择要预览的文件")).toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: /note\.txt/ }));
    expect(await screen.findByText("hello world")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy(); // 行号
    expect(screen.queryByText("选择要预览的文件")).toBeNull();
  });

  it("Markdown 相对图片走 upload_read,相对文件链接走 repo_reveal(workdir 缺省也可用)", async () => {
    const calls = stubShell({
      list: { "": [entry("README.md", "docs/README.md")] },
      content: "![截图](./images/cat.png)\n\n[源码](../src/main.ts)",
    });
    render(<FilesPanel sessionId="s1" tab="files" />);

    await userEvent.click(await screen.findByRole("button", { name: /README\.md/ }));
    const image = await screen.findByRole("img", { name: "截图" });
    await waitFor(() => expect(image.getAttribute("src")).toBe("data:image/png;base64,AA=="));
    expect(calls).toContainEqual({ kind: "upload_read", payload: { id: "s1", path: "docs/images/cat.png" } });

    await userEvent.click(screen.getByRole("link", { name: "源码" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ kind: "repo_reveal", payload: { path: "src/main.ts" } }),
    );
  });

  it("Markdown 绝对资源只允许 workdir 内路径,工作区外不发 IPC", async () => {
    const calls = stubShell({
      list: { "": [entry("README.md", "README.md")] },
      content: "![内图](/proj/alpha/images/cat.png)\n![外图](/proj/other/secret.png)\n\n[外链](/proj/other/secret.txt)",
    });
    render(<FilesPanel sessionId="s1" workdir="/proj/alpha" tab="files" />);

    await userEvent.click(await screen.findByRole("button", { name: /README\.md/ }));
    await waitFor(() => expect(calls.some((c) => c.kind === "upload_read")).toBe(true));
    expect(calls.filter((c) => c.kind === "upload_read")).toEqual([
      { kind: "upload_read", payload: { id: "s1", path: "images/cat.png" } },
    ]);
    await userEvent.click(screen.getByRole("link", { name: "外链" }));
    expect(calls.some((c) => c.kind === "repo_reveal" && c.payload.path === "/proj/other/secret.txt")).toBe(false);
    expect(await screen.findByText("只能打开当前工作区内的文件")).toBeTruthy();
  });

  it("tab=changes:改动列表直出、点行出 diff 预览;文件树不拉根目录", async () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      " ctx line",
      "-old line",
      "+new line",
      "",
    ].join("\n");
    const calls = stubShell({
      list: { "": [] },
      changes: { result: [{ path: "src/a.ts", status: "M" }], is_git_repo: true },
      diff,
    });
    render(<FilesPanel sessionId="s1" tab="changes" />);

    const row = await screen.findByRole("button", { name: /a\.ts/ });
    expect(row.textContent).toContain("修改"); // 状态徽标
    await userEvent.click(row);

    expect(await screen.findByText("@@ -1,2 +1,2 @@")).toBeTruthy();
    expect(screen.getByText("new line")).toBeTruthy();
    expect(screen.getByText("old line")).toBeTruthy();
    // 树未挂载:根目录列表不必拉(徽标直达改动页的省流约定随迁)
    expect(calls.filter((c) => c.kind === "repo_file_list")).toHaveLength(0);
  });

  it("受控 tab 切换:改动页的 diff 预览不跟进文件页(切换即关)", async () => {
    stubShell({
      list: { "": [entry("a.ts", "src/a.ts")] },
      changes: { result: [{ path: "src/a.ts", status: "M" }], is_git_repo: true },
      diff: "@@ -1 +1 @@\n-old\n+new\n",
    });
    const { rerender } = render(<FilesPanel sessionId="s1" tab="changes" />);
    await userEvent.click(await screen.findByRole("button", { name: /a\.ts/ }));
    expect(await screen.findByText("@@ -1 +1 @@")).toBeTruthy();

    rerender(<FilesPanel sessionId="s1" tab="files" />);
    await flush();
    expect(screen.queryByText("@@ -1 +1 @@")).toBeNull();
    expect(screen.getByText("选择要预览的文件")).toBeTruthy();
  });

  it("onRepoInfo 上报改动探测(git 与否 + 计数);非 git 也能继续浏览文件", async () => {
    stubShell({ list: { "": [entry("a.txt", "a.txt")] }, changes: { result: [], is_git_repo: false } });
    const onRepoInfo = vi.fn();
    render(<FilesPanel sessionId="s1" tab="files" onRepoInfo={onRepoInfo} />);
    await waitFor(() => expect(onRepoInfo).toHaveBeenCalledWith({ isGitRepo: false, changesCount: 0 }));
    expect(await screen.findByRole("button", { name: /a\.txt/ })).toBeTruthy();
  });

  it("刷新钮:已加载目录全量重拉且展开保留,改动列表一并重拉", async () => {
    const calls = stubShell({
      list: {
        "": [entry("src", "src", true)],
        src: [entry("a.ts", "src/a.ts")],
      },
    });
    render(<FilesPanel sessionId="s1" tab="files" />);
    await userEvent.click(await screen.findByRole("button", { name: "src" })); // 展开子目录
    await screen.findByRole("button", { name: /a\.ts/ });
    const listCalls = () => calls.filter((c) => c.kind === "repo_file_list").map((c) => c.payload.path);
    const changesCalls = () => calls.filter((c) => c.kind === "repo_file_changes").length;
    expect(listCalls()).toEqual(["", "src"]);
    expect(changesCalls()).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: "刷新" }));
    // 树:根 + 已展开子目录都重拉(不是只拉根);改动列表同步重拉
    await waitFor(() => expect(listCalls()).toEqual(["", "src", "", "src"]));
    await waitFor(() => expect(changesCalls()).toBe(2));
    // 展开集合保留:子项仍然可见,不需要重新逐层点开
    expect(screen.getByRole("button", { name: /a\.ts/ })).toBeTruthy();
  });

  it("refreshToken 自增(轮次结束)重拉改动列表", async () => {
    const calls = stubShell({ list: { "": [] } });
    const { rerender } = render(<FilesPanel sessionId="s1" tab="files" refreshToken={0} />);
    await flush();
    expect(calls.filter((c) => c.kind === "repo_file_changes")).toHaveLength(1);

    rerender(<FilesPanel sessionId="s1" tab="files" refreshToken={1} />);
    await flush();
    expect(calls.filter((c) => c.kind === "repo_file_changes")).toHaveLength(2);
  });

  it("树列宽度:localStorage 存量生效;拖拽调宽松手落盘(mc.filesTreeWidth)", async () => {
    localStorage.setItem("mc.filesTreeWidth", "300");
    stubShell({ list: { "": [] } });
    render(<FilesPanel sessionId="s1" tab="files" />);
    await flush();

    const handle = screen.getByTitle("拖动调整文件树宽度");
    expect(handle.getAttribute("aria-valuenow")).toBe("300");

    // jsdom 无布局:列左沿 rect 是 0,clientX 即目标宽
    fireEvent.mouseDown(handle);
    fireEvent.mouseMove(window, { clientX: 260 });
    fireEvent.mouseUp(window);
    expect(localStorage.getItem("mc.filesTreeWidth")).toBe("260");
    expect(handle.getAttribute("aria-valuenow")).toBe("260");

    // 键盘同一条链:16px 步进 + 落盘
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(localStorage.getItem("mc.filesTreeWidth")).toBe("276");
  });

  // trackPointer 的收尾此前只挂在 mouseup 上,而 mouseup 不保证会来:面板在
  // 按住把手期间被卸载(会话被删、切走视图),或鼠标拖出 webview 才松开。
  // 泄漏的不只是 window 上那两条监听——body 的 cursor/user-select 是**全局
  // 副作用**,留下就是整个应用从此选不中任何文字、光标恒为调宽箭头
  it("拖拽中途卸载:window 监听与 body 全局样式都收得回来", async () => {
    stubShell({ list: { "": [] } });
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<FilesPanel sessionId="s1" tab="files" />);
    await flush();

    fireEvent.mouseDown(screen.getByTitle("拖动调整文件树宽度"));
    fireEvent.mouseMove(window, { clientX: 300 });
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    unmount(); // 按住不放就卸载(mouseup 永远不会来)

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(document.body.style.getPropertyValue("-webkit-user-select")).toBe("");
    // 拖拽期间挂上的 window 监听逐个摘干净(留一条就是"后台还在跟指针")
    const dragHandlers = (spy: typeof addSpy) =>
      new Set(spy.mock.calls.filter(([type]) => type === "mousemove" || type === "mouseup").map(([, fn]) => fn));
    expect(dragHandlers(addSpy)).toEqual(dragHandlers(removeSpy));
  });

  it("正常松手仍然只收一次(mouseup 收尾与卸载兜底幂等)", async () => {
    stubShell({ list: { "": [] } });
    const { unmount } = render(<FilesPanel sessionId="s1" tab="files" />);
    await flush();

    fireEvent.mouseDown(screen.getByTitle("拖动调整文件树宽度"));
    fireEvent.mouseMove(window, { clientX: 240 });
    fireEvent.mouseUp(window);
    expect(localStorage.getItem("mc.filesTreeWidth")).toBe("240");

    unmount(); // 兜底不该再跑一遍收尾(否则 onDone 会二次落盘/二次 setState)
    expect(localStorage.getItem("mc.filesTreeWidth")).toBe("240");
    expect(document.body.style.cursor).toBe("");
  });

  // 面板改常驻侧边栏后 Esc 只保留「关预览」一级:消费即截断(审批热键
  // esc = deny 不可逆,同一下按键绝不能双消费);预览关完后 Esc 不再被
  // 面板吃掉,照常传播给后续监听
  it("Esc:预览开着先关预览且截断传播;预览关完不再消费", async () => {
    stubShell({ list: { "": [entry("a.txt", "a.txt")] }, content: "hello" });
    render(<FilesPanel sessionId="s1" tab="files" />);

    await userEvent.click(await screen.findByRole("button", { name: /a\.txt/ }));
    await screen.findByText("hello");

    const leaked = vi.fn();
    window.addEventListener("keydown", leaked);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("hello")).toBeNull(); // 预览关了
    expect(leaked).not.toHaveBeenCalled(); // 消费即截断

    fireEvent.keyDown(window, { key: "Escape" });
    expect(leaked).toHaveBeenCalledTimes(1); // 无预览:不消费,照常传播
    expect(screen.getByRole("region", { name: "会话文件" })).toBeTruthy(); // 面板不动
    window.removeEventListener("keydown", leaked);
  });
});

describe("在系统文件管理器中定位", () => {
  it("左列头按钮定位工作区根:repo_reveal 带空路径", async () => {
    const calls = stubShell({ list: { "": [] } });
    render(<FilesPanel sessionId="s1" workdir="/proj/alpha" tab="files" />);
    await flush();
    await userEvent.click(screen.getByRole("button", { name: "打开文件夹" }));
    await flush();
    expect(calls.filter((c) => c.kind === "repo_reveal")).toEqual([{ kind: "repo_reveal", payload: { path: "" } }]);
  });

  it("预览头按钮定位当前文件;失败则复制绝对路径并外显", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const calls = stubShell({
      list: { "": [entry("a.ts", "src/a.ts")] },
      content: "x",
      reveal: { error: "没有可用的文件管理器" },
    });
    render(<FilesPanel sessionId="s1" workdir="/proj/alpha" tab="files" />);
    await flush();
    await userEvent.click(await screen.findByText("a.ts"));
    await flush();
    await userEvent.click(screen.getByRole("button", { name: "打开所在文件夹" }));
    await flush();
    expect(calls.some((c) => c.kind === "repo_reveal" && c.payload.path === "src/a.ts")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("/proj/alpha/src/a.ts");
    expect((await screen.findAllByRole("alert")).some((n) => n.textContent?.includes("/proj/alpha/src/a.ts"))).toBe(true);
  });
});
