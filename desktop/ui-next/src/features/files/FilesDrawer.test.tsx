import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilesDrawer } from "./FilesDrawer";

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

describe("文件抽屉", () => {
  it("树懒加载:根目录挂载即拉,子目录点开才拉,收起再展开走缓存", async () => {
    const calls = stubShell({
      list: {
        "": [entry("src", "src", true), entry("README.md", "README.md")],
        src: [entry("index.ts", "src/index.ts")],
      },
    });
    render(<FilesDrawer sessionId="s1" onClose={() => {}} />);

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

  it("文件点击 → 读取内容并在预览窗格展示(带行号)", async () => {
    stubShell({ list: { "": [entry("note.txt", "note.txt")] }, content: "hello world" });
    render(<FilesDrawer sessionId="s1" onClose={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: /note\.txt/ }));
    expect(await screen.findByText("hello world")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy(); // 行号
  });

  it("Markdown 相对图片走 upload_read,相对文件链接走 repo_reveal(workdir 缺省也可用)", async () => {
    const calls = stubShell({
      list: { "": [entry("README.md", "docs/README.md")] },
      content: "![截图](./images/cat.png)\n\n[源码](../src/main.ts)",
    });
    render(<FilesDrawer sessionId="s1" onClose={() => {}} />);

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
    render(<FilesDrawer sessionId="s1" workdir="/proj/alpha" onClose={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: /README\.md/ }));
    await waitFor(() => expect(calls.some((c) => c.kind === "upload_read")).toBe(true));
    expect(calls.filter((c) => c.kind === "upload_read")).toEqual([
      { kind: "upload_read", payload: { id: "s1", path: "images/cat.png" } },
    ]);
    await userEvent.click(screen.getByRole("link", { name: "外链" }));
    expect(calls.some((c) => c.kind === "repo_reveal" && c.payload.path === "/proj/other/secret.txt")).toBe(false);
    expect(await screen.findByText("只能打开当前工作区内的文件")).toBeTruthy();
  });

  it("tab 切到改动(带计数 badge),点改动行出 diff 预览", async () => {
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
    stubShell({
      list: { "": [] },
      changes: { result: [{ path: "src/a.ts", status: "M" }], is_git_repo: true },
      diff,
    });
    render(<FilesDrawer sessionId="s1" onClose={() => {}} />);

    const tab = await screen.findByRole("tab", { name: /改动/ });
    expect(tab.textContent).toContain("1"); // 计数 badge
    await userEvent.click(tab);

    const row = await screen.findByRole("button", { name: /a\.ts/ });
    expect(row.textContent).toContain("修改"); // 状态徽标
    await userEvent.click(row);

    expect(await screen.findByText("@@ -1,2 +1,2 @@")).toBeTruthy();
    expect(screen.getByText("new line")).toBeTruthy();
    expect(screen.getByText("old line")).toBeTruthy();
  });

  it("宽度:localStorage 存量生效;拖拽调宽松手落盘(mc.drawerWidth)", async () => {
    localStorage.setItem("mc.drawerWidth", "777");
    stubShell({ list: { "": [] } });
    render(<FilesDrawer sessionId="s1" onClose={() => {}} />);
    await flush();

    const panel = screen.getByRole("region", { name: "会话文件" });
    expect(panel.style.width).toBe("777px");

    fireEvent.mouseDown(screen.getByTitle("拖动调整宽度"));
    fireEvent.mouseMove(window, { clientX: 300 });
    fireEvent.mouseUp(window);

    const expected = window.innerWidth - 300;
    expect(panel.style.width).toBe(`${expected}px`);
    expect(localStorage.getItem("mc.drawerWidth")).toBe(String(expected));
  });

  it("pane 形态的宽度与预览分栏都以所在格边界计算", async () => {
    stubShell({ list: { "": [entry("a.txt", "a.txt")] }, content: "hello" });
    const { container } = render(
      <div data-test-pane="">
        <FilesDrawer variant="pane" sessionId="s1" onClose={() => {}} />
      </div>,
    );
    const pane = container.querySelector<HTMLElement>("[data-test-pane]")!;
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 50,
      right: 900,
      bottom: 650,
      width: 800,
      height: 600,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent(window, new Event("resize"));
    await flush();

    const panel = screen.getByRole("region", { name: "会话文件" });
    const widthHandle = screen.getByTitle("拖动调整宽度");
    await waitFor(() => expect(widthHandle.getAttribute("aria-valuemax")).toBe("680"));
    expect(widthHandle.getAttribute("aria-valuemin")).toBe("420");
    expect(widthHandle.getAttribute("aria-valuenow")).toBe("600");
    fireEvent.mouseDown(widthHandle);
    fireEvent.mouseMove(window, { clientX: 350 });
    fireEvent.mouseUp(window);
    // pane 右沿 900 - 指针 350 = 550；旧实现会算成 window.innerWidth - 350。
    expect(panel.style.width).toBe("550px");

    await userEvent.click(await screen.findByRole("button", { name: /a\.txt/ }));
    await screen.findByText("hello");
    const splitHandle = screen.getByTitle("拖动调整列表/预览高度");
    const list = splitHandle.previousElementSibling as HTMLElement;
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 150,
      right: 900,
      bottom: 400,
      width: 800,
      height: 250,
      x: 100,
      y: 150,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(splitHandle.getAttribute("aria-valuemax")).toBe("340"));
    expect(splitHandle.getAttribute("aria-valuemin")).toBe("80");
    expect(splitHandle.getAttribute("aria-valuenow")).toBe("250");
    fireEvent.mouseDown(splitHandle);
    fireEvent.mouseMove(window, { clientY: 600 });
    fireEvent.mouseUp(window);
    // pane.bottom 650 - list.top 150 - 预览最小 160 = 340。
    expect(list.style.height).toBe("340px");
  });

  it("窄 pane 的宽度 ARIA 使用实际可达边界，而不是存量目标宽度", async () => {
    localStorage.setItem("mc.drawerWidth", "777");
    stubShell({ list: { "": [] } });
    const { container } = render(
      <div data-test-pane="">
        <FilesDrawer variant="pane" sessionId="s1" onClose={() => {}} />
      </div>,
    );
    const pane = container.querySelector<HTMLElement>("[data-test-pane]")!;
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 600,
      width: 400,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent(window, new Event("resize"));

    const handle = screen.getByTitle("拖动调整宽度");
    await waitFor(() => expect(handle.getAttribute("aria-valuenow")).toBe("340"));
    expect(handle.getAttribute("aria-valuemin")).toBe("340");
    expect(handle.getAttribute("aria-valuemax")).toBe("340");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(localStorage.getItem("mc.drawerWidth")).toBe("340");
    expect(handle.getAttribute("aria-valuenow")).toBe("340");
  });

  it("pane 被 CSS 上限夹窄后，首次 ArrowRight 从实测宽度继续缩窄", async () => {
    stubShell({ list: { "": [] } });
    const { container } = render(
      <div data-test-pane="">
        <FilesDrawer variant="pane" sessionId="s1" onClose={() => {}} />
      </div>,
    );
    const pane = container.querySelector<HTMLElement>("[data-test-pane]")!;
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 600,
      bottom: 600,
      width: 600,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const panel = screen.getByRole("region", { name: "会话文件" });
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      left: 90,
      top: 0,
      right: 600,
      bottom: 600,
      width: 510,
      height: 600,
      x: 90,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent(window, new Event("resize"));
    const handle = screen.getByTitle("拖动调整宽度");
    await waitFor(() => expect(handle.getAttribute("aria-valuenow")).toBe("510"));

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(panel.style.width).toBe("494px");
    expect(localStorage.getItem("mc.drawerWidth")).toBe("494");
  });

  it("自适应短列表按 ArrowUp 不反向增高，ARIA 跟随实测列表高度", async () => {
    stubShell({ list: { "": [entry("a.txt", "a.txt")] }, content: "hello" });
    render(<FilesDrawer sessionId="s1" onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: /a\.txt/ }));
    await screen.findByText("hello");
    const handle = screen.getByTitle("拖动调整列表/预览高度");
    const list = handle.previousElementSibling as HTMLElement;
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 100,
      right: 600,
      bottom: 140,
      width: 600,
      height: 40,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(handle.getAttribute("aria-valuenow")).toBe("40"));
    expect(handle.getAttribute("aria-valuemin")).toBe("40");

    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(list.style.height).toBe("");
    expect(localStorage.getItem("mc.drawerSplit")).toBeNull();

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(list.style.height).toBe("80px");
    expect(localStorage.getItem("mc.drawerSplit")).toBe("80");
    await waitFor(() => expect(handle.getAttribute("aria-valuenow")).toBe("80"));
  });

  // trackPointer 的收尾此前只挂在 mouseup 上,而 mouseup 不保证会来:抽屉在
  // 按住把手期间被卸载(它自己的 Esc 就能关掉自己、会话被删、切走视图),
  // 或者鼠标拖出 webview 才松开。泄漏的不只是 window 上那两条监听——body 的
  // cursor/user-select 是**全局副作用**,留下就是整个应用从此选不中任何文字、
  // 光标恒为调宽箭头,只能重启
  it("拖拽中途卸载:window 监听与 body 全局样式都收得回来", async () => {
    stubShell({ list: { "": [] } });
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<FilesDrawer sessionId="s1" onClose={() => {}} />);
    await flush();

    fireEvent.mouseDown(screen.getByTitle("拖动调整宽度"));
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
    const { unmount } = render(<FilesDrawer sessionId="s1" onClose={() => {}} />);
    await flush();

    fireEvent.mouseDown(screen.getByTitle("拖动调整宽度"));
    fireEvent.mouseMove(window, { clientX: 400 });
    fireEvent.mouseUp(window);
    const persisted = localStorage.getItem("mc.drawerWidth");
    expect(persisted).toBe(String(window.innerWidth - 400));

    unmount(); // 兜底不该再跑一遍收尾(否则 onDone 会二次落盘/二次 setState)
    expect(localStorage.getItem("mc.drawerWidth")).toBe(persisted);
    expect(document.body.style.cursor).toBe("");
  });

  it("Esc(escLayer 层栈):预览开着先关预览,再一次才关抽屉", async () => {
    const onClose = vi.fn();
    stubShell({ list: { "": [entry("a.txt", "a.txt")] }, content: "hello" });
    render(<FilesDrawer sessionId="s1" onClose={onClose} />);

    await userEvent.click(await screen.findByRole("button", { name: /a\.txt/ }));
    await screen.findByText("hello");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("hello")).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc 消费后截断传播(H1):window 上后续监听不再收到这一下按键", async () => {
    const onClose = vi.fn();
    stubShell({ list: { "": [] } });
    render(<FilesDrawer sessionId="s1" onClose={onClose} />);
    await flush();

    // 模拟审批热键(app/shortcuts.ts 挂 window bubble):抽屉消费 Esc 后
    // 绝不能漏到这里——esc = deny 不可逆,同一下按键不许双消费
    const leaked = vi.fn();
    window.addEventListener("keydown", leaked);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(leaked).not.toHaveBeenCalled();

    // 非 Esc 按键不截断,照常传播
    fireEvent.keyDown(window, { key: "a" });
    expect(leaked).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", leaked);
  });

  // H3:scrim/面板从自绘窗框条下缘起,结构性避让(三键与拖拽区恒可点)。
  // 偏移**必须读 --chrome-h**,不许按平台手算:此前这里是 isWindowsShell()
  // 三元,同一笔账 App 的 toast 又手算了一遍、算的还是 mac 的数,于是
  // Windows 上提醒压住主区头的动作钮(2026-08-08 定案:凡 fixed 贴顶的统一读
  // 变量)。所以这条钉的是「读了变量」而非某个具体像素——平台差异归 CSS。
  it.each([
    ["Windows NT 10.0", "Windows"],
    ["X11; Linux x86_64", "Linux"],
    ["Macintosh; Intel Mac OS X 10_15_7", "mac"],
  ])("%s:scrim/面板的顶偏移读 --chrome-h,不写死平台值", async (ua) => {
    vi.stubGlobal("navigator", { ...window.navigator, userAgent: ua });
    stubShell({ list: { "": [] } });
    const { container } = render(<FilesDrawer sessionId="s1" onClose={() => {}} />);
    await flush();
    const scrim = container.querySelector(".z-30");
    const panel = screen.getByRole("region", { name: "会话文件" });
    for (const cls of [scrim?.className ?? "", panel.className]) {
      expect(cls).toContain("top-[var(--chrome-h)]");
      expect(cls).not.toContain("top-9");
      expect(cls).not.toContain("top-0");
    }
    expect(scrim?.className).not.toContain("inset-0");
  });

  it("非 git 工作区:改动 tab 不渲染,只留文件浏览", async () => {
    stubShell({ list: { "": [] }, changes: { result: [], is_git_repo: false } });
    render(<FilesDrawer sessionId="s1" onClose={() => {}} />);
    await flush();
    expect(screen.queryByRole("tab", { name: /改动/ })).toBeNull();
    expect(screen.getByRole("tab", { name: "文件" })).toBeTruthy();
  });

  it("initialTab=changes:打开即落在「改动」页(徽标直达),文件树不拉根目录", async () => {
    const calls = stubShell({
      list: { "": [] },
      changes: { result: [{ path: "src/a.ts", status: "M" }], is_git_repo: true },
    });
    render(<FilesDrawer sessionId="s1" onClose={() => {}} initialTab="changes" />);

    const row = await screen.findByRole("button", { name: /a\.ts/ }); // 改动列表直出
    expect(row.textContent).toContain("修改");
    expect(screen.getByRole("tab", { name: /改动/ }).className).toContain("tab-active");
    expect(screen.getByRole("tab", { name: "文件" }).className).not.toContain("tab-active");
    // 树未挂载:根目录列表不必拉
    expect(calls.filter((c) => c.kind === "repo_file_list")).toHaveLength(0);
  });

  it("refreshToken 自增(轮次结束)重拉改动列表", async () => {
    const calls = stubShell({ list: { "": [] } });
    const { rerender } = render(<FilesDrawer sessionId="s1" onClose={() => {}} refreshToken={0} />);
    await flush();
    expect(calls.filter((c) => c.kind === "repo_file_changes")).toHaveLength(1);

    rerender(<FilesDrawer sessionId="s1" onClose={() => {}} refreshToken={1} />);
    await flush();
    expect(calls.filter((c) => c.kind === "repo_file_changes")).toHaveLength(2);
  });
});

describe("在系统文件管理器中定位", () => {
  it("头部按钮定位工作区根:repo_reveal 带空路径", async () => {
    const calls = stubShell({ list: { "": [] } });
    render(<FilesDrawer sessionId="s1" workdir="/proj/alpha" onClose={() => {}} />);
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
    render(<FilesDrawer sessionId="s1" workdir="/proj/alpha" onClose={() => {}} />);
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
