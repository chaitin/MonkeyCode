// 分屏视图(树形布局):装载卡 tab/分组与排序、拆分/关闭、把手按节点独立、
// 拖格头换位、内嵌新建。ChatView 数据面在格内真实挂载,壳走最小 stub。
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionMeta } from "@/lib/ipc/sessions";
import { SplitView, type SplitAdminWiring } from "./SplitView";
import { LOAD_MIME } from "./slots";
import { useSplitState } from "./useSplitState";

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  localStorage.clear();
});

interface ShellCall {
  cmd: string;
  args?: Record<string, unknown>;
}

function stubShell() {
  const calls: ShellCall[] = [];
  const listeners = new Map<string, Set<(e: { payload: unknown }) => void>>();
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        if (cmd === "session_open") return Promise.resolve({ frames: [], cursor: 0, has_more: false });
        if (cmd === "session_outline") return Promise.resolve([]);
        if (cmd === "session_call") return Promise.resolve({ result: [], is_git_repo: true });
        if (cmd === "engine_status") return Promise.resolve({ phase: "ready" });
        if (cmd === "session_create")
          return Promise.resolve({
            id: "created",
            title: "新建成功",
            workdir: "~/MonkeyCode",
            model: "m",
            turns: 0,
            status: "idle",
          });
        if (cmd === "stat_dropped_file") return Promise.resolve({ name: "drop.txt", mediaType: "text/plain" });
        if (cmd === "upload_file_path") return Promise.resolve({ path: ".monkeycode/uploads/drop.txt" });
        // 内嵌新建表单挂载即拉模型/配置(与整页形态同一份代码)
        if (cmd === "models_list") return Promise.resolve([{ name: "m", default: true }]);
        if (cmd === "get_config") return Promise.resolve({ models: [], mcp_servers: {} });
        return Promise.resolve(null);
      },
    },
    event: {
      listen: (name: string, cb: (e: { payload: unknown }) => void) => {
        const set = listeners.get(name) ?? new Set();
        set.add(cb);
        listeners.set(name, set);
        return Promise.resolve(() => set.delete(cb));
      },
    },
  };
  return {
    calls,
    emit: (name: string, payload: unknown) => listeners.get(name)?.forEach((cb) => cb({ payload })),
    listenerCount: (name: string) => listeners.get(name)?.size ?? 0,
  };
}

const meta = (over: Partial<SessionMeta> & { id: string }): SessionMeta => ({
  title: over.id,
  workdir: "/p/a",
  model: "m",
  turns: 1,
  status: "idle",
  ...over,
});

const SESSIONS: SessionMeta[] = [
  meta({ id: "s1", title: "已入格的任务", updated_at: "2026-08-16T03:00:00Z" }),
  meta({ id: "s2", title: "跑着的任务", status: "running", updated_at: "2026-08-16T02:00:00Z" }),
  meta({ id: "s3", title: "闲着的任务", workdir: "/p/alpha", updated_at: "2026-08-16T01:00:00Z" }),
  meta({ id: "c1", title: "闲聊", kind: "chat", workdir: "", updated_at: "2026-08-16T00:30:00Z" }),
];

function Harness({
  active = true,
  sessions = SESSIONS,
  onAssign,
  admin,
}: {
  active?: boolean;
  sessions?: SessionMeta[];
  onAssign?: (slot: number, id: string) => void;
  admin?: SplitAdminWiring;
}) {
  const split = useSplitState();
  const [focusRequest, setFocusRequest] = useState(0);
  return (
    <SplitView
      active={active}
      sessions={sessions}
      split={split}
      epoch={0}
      focusRequest={focusRequest}
      onFocusRequestHandled={() => setFocusRequest(0)}
      onAssign={(slot, id) => {
        onAssign?.(slot, id);
        split.assignTo(slot, id);
      }}
      onLoadSession={(id) => split.place(id)}
      onCreatedInSlot={(slot, created) => split.assignTo(slot, created.id)}
      onCloudCreatedInSlot={() => {}}
      onComposerIntent={() => setFocusRequest((n) => n + 1)}
      onOpenSettings={() => {}}
      recentDirs={[]}
      admin={admin}
    />
  );
}

/** 假 dataTransfer(jsdom 无 DataTransfer 构造器;换位拖拽用)。 */
const fakeDT = () => {
  const data: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => {
      data[k] = v;
    },
    getData: (k: string) => data[k] ?? "",
    get types() {
      return Object.keys(data);
    },
    effectAllowed: "",
    dropEffect: "",
  };
};

/** jsdom 未实现 DragEvent，fireEvent.dragOver 不会带上指针坐标。 */
const fireDragAt = (
  target: Element,
  type: "dragover" | "drop",
  dataTransfer: ReturnType<typeof fakeDT>,
  clientX: number,
  clientY: number,
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  fireEvent(target, event);
};

describe("分屏视图(树形布局)", () => {
  it("首启缺省单格(2026-08-20 定案:新用户不见空栏;存过树不受影响)", () => {
    stubShell();
    render(<Harness />);
    expect(screen.getAllByRole("region")).toHaveLength(1);
  });

  it("恢复时压密超大叶槽号并丢弃离树长尾，装载不再扩巨型数组", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ leaf: Number.MAX_SAFE_INTEGER }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(Array.from({ length: 500 }, (_, i) => `c:orphan-${i}`)));
    render(<Harness />);
    expect(screen.getByRole("region", { name: "第 1 格" })).toBeTruthy();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("mc.splitTree") ?? "null")).toEqual({ leaf: 0 }));
    expect(JSON.parse(localStorage.getItem("mc.splitSlots") ?? "null")).toEqual([]);
  });

  it("20,001 叶深存档启动时只物化像素可见子树", () => {
    stubShell();
    const parts: string[] = [];
    for (let slot = 0; slot < 20_000; slot++) {
      parts.push(`{"dir":"col","ratio":0.5,"a":{"leaf":${slot}},"b":`);
    }
    localStorage.setItem("mc.splitTree", parts.join("") + '{"leaf":20000}' + "}".repeat(20_000));
    const { container } = render(<Harness />);
    expect(container.querySelectorAll("section[aria-label$='格']").length).toBeLessThan(32);
    expect(container.querySelectorAll("[data-split-handle]").length).toBeLessThan(32);
  });

  it("4K 画布中的 20,001 叶平衡存档仍受全局物化预算约束", () => {
    stubShell();
    let level = Array.from({ length: 20_001 }, (_, slot) => `{"leaf":${slot}}`);
    let depth = 0;
    while (level.length > 1) {
      const next: string[] = [];
      for (let index = 0; index < level.length; index += 2) {
        const a = level[index]!;
        const b = level[index + 1];
        next.push(b ? `{"dir":"${depth % 2 === 0 ? "col" : "row"}","ratio":0.5,"a":${a},"b":${b}}` : a);
      }
      level = next;
      depth += 1;
    }
    localStorage.setItem("mc.splitTree", level[0]!);
    const width = vi.spyOn(window, "innerWidth", "get").mockReturnValue(3840);
    const height = vi.spyOn(window, "innerHeight", "get").mockReturnValue(2160);
    const { container } = render(<Harness />);
    width.mockRestore();
    height.mockRestore();
    expect(container.querySelectorAll("section[aria-label$='格']").length).toBeLessThanOrEqual(512);
    expect(container.querySelectorAll("[data-split-handle]").length).toBeLessThanOrEqual(512);
  });

  it("存档双格:槽 0 挂会话,槽 1 装载卡——tab、项目分组、临时会话段、已入格判重排除", async () => {
    stubShell();
    localStorage.setItem("mc.workbenchListHidden", "1"); // 钉在装载卡路径(任务列默认展开时空格是提示卡)
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    render(<Harness />);
    const panes = screen.getAllByRole("region");
    expect(panes).toHaveLength(2);
    expect(within(panes[0]!).getByTitle(/已入格的任务/)).toBeTruthy();
    const loader = panes[1]!;
    expect(within(loader).getByRole("tab", { name: "本地" }).getAttribute("aria-selected")).toBe("true");
    expect(within(loader).getByText("运行中")).toBeTruthy();
    expect(within(loader).getByText("跑着的任务")).toBeTruthy();
    expect(within(loader).getByText("alpha")).toBeTruthy();
    // 已入格的 s1 判重不列(装载卡里没有它;细头那份标题不算)
    expect(within(loader).queryByText("已入格的任务")).toBeNull();
    // 组头 = 侧栏同款安静小标签(GroupLabel /50 降色),不是 menu-title
    expect(within(loader).getByText("alpha").className).toContain("text-base-content/50");
    expect(loader.querySelector(".menu-title")).toBeNull();
    // 组内行缩一级(层级靠缩进,§6.2)
    expect(within(loader).getByText("闲着的任务").closest("button")?.className).toContain("ps-8");
    // chat 收进本地 tab 的「临时会话」段(2026-08-18 撤并),不再单设 tab
    expect(within(loader).queryByRole("tab", { name: /本地会话/ })).toBeNull();
    expect(within(loader).getByText("临时会话")).toBeTruthy();
    expect(within(loader).getByText("闲聊")).toBeTruthy();
    expect(within(loader).getByRole("button", { name: "新建任务" })).toBeTruthy();
    expect(within(loader).queryByRole("button", { name: "新建会话" })).toBeNull();
  });

  it("项目组顺序与侧栏一致:运行中的会话也计入项目活跃度(只是行不重复列)", () => {
    stubShell();
    localStorage.setItem("mc.workbenchListHidden", "1"); // 钉在装载卡路径(任务列默认展开时空格是提示卡)
    // 项目 A 最近的活动是一条**运行中**会话(03:00),项目 B 是闲置(02:00)。
    // 侧栏按组内最近活跃排 A 在前;分组若先剔掉运行中再算,A 只剩 01:00
    // 的旧会话,就会错排到 B 之后(用户报障「排序怎么跟 sidebar 不一样」)
    const list: SessionMeta[] = [
      meta({ id: "a1", title: "A 旧任务", workdir: "/p/aaa", updated_at: "2026-08-16T01:00:00Z" }),
      meta({ id: "a2", title: "A 跑着", workdir: "/p/aaa", status: "running", updated_at: "2026-08-16T03:00:00Z" }),
      meta({ id: "b1", title: "B 闲置", workdir: "/p/bbb", updated_at: "2026-08-16T02:00:00Z" }),
    ];
    render(<Harness sessions={list} />);
    const loader = screen.getAllByRole("region")[0]!;
    const html = loader.innerHTML;
    expect(html.indexOf("aaa")).toBeGreaterThan(-1);
    expect(html.indexOf("aaa")).toBeLessThan(html.indexOf("bbb"));
    // 运行中的 a2 只在「运行中」组出现一次,不在项目组里重复
    expect(within(loader).getAllByText("A 跑着")).toHaveLength(1);
  });

  it("右分屏:新格取最小空槽号、树落盘且可继续拆出第七格", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    render(<Harness />);
    expect(screen.getAllByRole("region")).toHaveLength(2);
    // 分窗操作收进「格操作」⋯ 菜单(2026-08-18 定案「不是常见的操作」)
    await userEvent.click(within(screen.getAllByRole("region")[0]!).getByRole("button", { name: "格操作" }));
    await userEvent.click(within(document.body.lastElementChild as HTMLElement).getByText("右分屏"));
    expect(screen.getAllByRole("region")).toHaveLength(3);
    expect(screen.getByRole("region", { name: "第 3 格" })).toBeTruthy();
    const saved = JSON.parse(localStorage.getItem("mc.splitTree") ?? "null");
    expect(saved).not.toBeNull();
    // 连拆到 6 格后菜单仍可继续拆分
    for (let i = 0; i < 3; i++) {
      await userEvent.click(screen.getAllByRole("button", { name: "格操作" })[0]!);
      await userEvent.click(within(document.body.lastElementChild as HTMLElement).getByText("下分屏"));
    }
    expect(screen.getAllByRole("region")).toHaveLength(6);
    await userEvent.click(screen.getAllByRole("button", { name: "格操作" })[0]!);
    const menu = document.body.lastElementChild as HTMLElement;
    const splitRight = within(menu).getByText("右分屏").closest("button") as HTMLButtonElement;
    expect(splitRight.disabled).toBe(false);
    await userEvent.click(splitRight);
    expect(screen.getAllByRole("region")).toHaveLength(7);
    expect(screen.getByRole("region", { name: "第 7 格" })).toBeTruthy();
  });

  it("工作台 inactive 时不响应聚焦、侧栏和分屏快捷键", async () => {
    stubShell();
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    render(<Harness active={false} />);
    const input = await screen.findByRole("textbox", { name: "消息输入" });

    fireEvent.keyDown(window, { key: "l", code: "KeyL", ctrlKey: true });
    fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true });
    fireEvent.keyDown(window, { key: "\\", code: "Backslash", ctrlKey: true });

    expect(document.activeElement).not.toBe(input);
    expect(screen.getByRole("complementary", { name: "选择任务" })).toBeTruthy();
    expect(screen.getAllByRole("region")).toHaveLength(1);
  });

  it("工作台切为 inactive 时关闭 body portal，恢复后不重新弹出", async () => {
    stubShell();
    const { rerender } = render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "键盘快捷键" }));
    expect(screen.getByRole("dialog", { name: "键盘快捷键" })).toBeTruthy();

    rerender(<Harness active={false} />);
    expect(screen.queryByRole("dialog", { name: "键盘快捷键" })).toBeNull();
    rerender(<Harness />);
    expect(screen.queryByRole("dialog", { name: "键盘快捷键" })).toBeNull();
  });

  it("工作台切为 inactive 时终止正在进行的布局拖动", () => {
    stubShell();
    const { rerender } = render(<Harness />);
    const handle = screen.getByRole("separator", { name: "拖动调整任务列宽度" });
    const aside = screen.getByRole("complementary", { name: "选择任务" });
    fireEvent.mouseDown(handle, { clientX: 232 });
    expect(document.body.style.cursor).toBe("col-resize");

    rerender(<Harness active={false} />);
    expect(document.body.style.cursor).toBe("");
    fireEvent.mouseMove(window, { clientX: 360 });
    expect(aside.style.width).toBe("232px");
  });

  it("工作台快捷键只操作焦点格，且可连续拆分超过六格", async () => {
    stubShell();
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    render(<Harness />);
    await screen.findByRole("textbox", { name: "消息输入" });

    fireEvent.keyDown(window, { key: "l", code: "KeyL", ctrlKey: true });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "消息输入" })));

    fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true });
    expect(screen.queryByRole("complementary", { name: "选择任务" })).toBeNull();
    fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true });
    expect(screen.getByRole("complementary", { name: "选择任务" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "\\", code: "Backslash", ctrlKey: true });
    expect(screen.getAllByRole("region")).toHaveLength(2);
    fireEvent.keyDown(window, { key: "|", code: "Backslash", ctrlKey: true, shiftKey: true });
    expect(screen.getAllByRole("region")).toHaveLength(3);
    expect(screen.getByRole("region", { name: "第 3 格" }).querySelector("[data-split-focus]")).not.toBeNull();

    for (let i = 0; i < 4; i++) fireEvent.keyDown(window, { key: "\\", code: "Backslash", ctrlKey: true });
    expect(screen.getAllByRole("region")).toHaveLength(7);
  });

  it("Ctrl+N 沿用当前任务类型；侧栏帮助入口展示快捷键并由 Esc 关闭", async () => {
    stubShell();
    render(<Harness />);
    fireEvent.keyDown(window, { key: "n", code: "KeyN", ctrlKey: true });
    expect(screen.getByRole("heading", { name: "新建任务" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "取消" }));

    await userEvent.click(screen.getByRole("button", { name: "键盘快捷键" }));
    expect(screen.getByRole("dialog", { name: "键盘快捷键" })).toBeTruthy();
    expect(screen.getByText("切换权限模式")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "键盘快捷键" })).toBeNull();
  });

  it("会话快捷键隔离到 split.focused：Shift+Tab 与 Ctrl+. 不会切另一格权限", async () => {
    const shell = stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    await waitFor(() => expect(screen.getAllByRole("textbox", { name: "消息输入" })).toHaveLength(2));

    fireEvent.keyDown(window, { key: "Tab", code: "Tab", shiftKey: true });
    await waitFor(() => expect(shell.calls.filter((c) => c.cmd === "session_call")).toHaveLength(1));
    expect(shell.calls.find((c) => c.cmd === "session_call")?.args?.id).toBe("s1");

    fireEvent.pointerDown(screen.getByRole("region", { name: "第 2 格" }));
    fireEvent.keyDown(window, { key: ".", code: "Period", ctrlKey: true });
    await waitFor(() => expect(shell.calls.filter((c) => c.cmd === "session_call")).toHaveLength(2));
    expect(shell.calls.filter((c) => c.cmd === "session_call")[1]?.args?.id).toBe("s2");
  });

  it("关闭格子:兄弟上位并清档;关闭最后一格后原地打开新建任务页", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    await userEvent.click(within(screen.getByRole("region", { name: "第 1 格" })).getByRole("button", { name: /关闭格子/ }));
    const pane = screen.getByRole("region");
    expect(JSON.parse(localStorage.getItem("mc.splitSlots") ?? "[]")[0]).toBeNull();
    const close = within(pane).getByRole("button", { name: /关闭格子/ });

    await userEvent.click(close);

    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(within(pane).getByRole("heading", { name: "新建任务" })).toBeTruthy();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("mc.splitSlots") ?? "[]").every((entry: unknown) => entry === null)).toBe(true));
  });

  it("归档成功关闭对应 Panel，并保留其他 Panel", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2"]));
    const onToggleArchive = vi.fn(async () => true);
    const admin: SplitAdminWiring = {
      attentionIds: new Set(),
      onRename: () => {},
      onToggleArchive,
      onDelete: () => {},
    };
    render(<Harness admin={admin} />);
    const pane = screen.getByRole("region", { name: "第 1 格" });
    await userEvent.click(within(pane).getByRole("button", { name: "格操作" }));
    await userEvent.click(within(document.body.lastElementChild as HTMLElement).getByText("归档"));

    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(1));
    expect(within(screen.getByRole("region")).getByTitle(/跑着的任务/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "新建任务" })).toBeNull();
  });

  it("归档最后一个任务时进入新建任务页", async () => {
    stubShell();
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1"]));
    const onToggleArchive = vi.fn(async () => true);
    const admin: SplitAdminWiring = {
      attentionIds: new Set(),
      onRename: () => {},
      onToggleArchive,
      onDelete: () => {},
    };
    render(<Harness admin={admin} />);
    const pane = screen.getByRole("region");
    await userEvent.click(within(pane).getByRole("button", { name: "格操作" }));
    await userEvent.click(within(document.body.lastElementChild as HTMLElement).getByText("归档"));

    await waitFor(() => expect(onToggleArchive).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" })));
    expect(within(pane).getByRole("heading", { name: "新建任务" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("mc.splitSlots") ?? "[]").every((entry: unknown) => entry === null)).toBe(true);
  });

  it("归档失败保留原 Panel", async () => {
    stubShell();
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1"]));
    const admin: SplitAdminWiring = {
      attentionIds: new Set(),
      onRename: () => {},
      onToggleArchive: vi.fn(async () => false),
      onDelete: () => {},
    };
    render(<Harness admin={admin} />);
    const pane = screen.getByRole("region");
    await userEvent.click(within(pane).getByRole("button", { name: "格操作" }));
    await userEvent.click(within(document.body.lastElementChild as HTMLElement).getByText("归档"));

    await waitFor(() => expect(within(pane).getByTitle(/已入格的任务/)).toBeTruthy());
    expect(within(pane).queryByRole("heading", { name: "新建任务" })).toBeNull();
  });

  it("平铺分栏(2026-08-19 mockup 终案,当日浮卡退役):格白底无卡衣、细头恒在带拖窗面,右侧无顶条", () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ leaf: 0 }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    render(<Harness />);
    // 列开着:右侧无顶条
    expect(document.querySelector("[data-view-header]")).toBeNull();
    // 平铺:画布无衬(1px 细线由 grid 底色透缝),格无卡衣
    const grid = document.querySelector("[data-split-grid]") as HTMLElement;
    expect(grid.className).not.toContain("p-3");
    const pane = screen.getByRole("region", { name: "第 1 格" });
    expect(pane.className).not.toContain("rounded-box");
    expect(pane.className).not.toContain("shadow");
    // 细头恒在(标题在格上)且自任拖窗面
    expect(within(pane).getByTitle(/已入格的任务/)).toBeTruthy();
    expect(within(pane).getByTitle(/已入格的任务/).closest("[data-tauri-drag-region]")).not.toBeNull();
    expect(within(pane).getByRole("button", { name: "格操作" })).toBeTruthy();
  });

  it("拖放装载落在「创建中」格上:装载优先、表单退场(取消不再连格收走)", async () => {
    stubShell();
    localStorage.setItem("mc.workbenchListHidden", "1"); // 装载卡路径
    render(<Harness />);
    const pane = screen.getAllByRole("region")[0]!;
    await userEvent.click(within(pane).getByRole("button", { name: "新建任务" }));
    expect(within(pane).getByRole("heading", { name: "新建任务" })).toBeTruthy();
    const dt = fakeDT();
    dt.setData(LOAD_MIME, "s2");
    fireEvent.drop(pane, { dataTransfer: dt });
    expect(within(pane).queryByRole("heading", { name: "新建任务" })).toBeNull();
    await waitFor(() => expect(within(pane).getByTitle(/跑着的任务/)).toBeTruthy());
  });

  it("任务列可拖宽:最小 184 钳制、双击回缺省 232、松手落盘 mc.workbenchListWidth", async () => {
    stubShell();
    render(<Harness />);
    const handle = screen.getByRole("separator", { name: "拖动调整任务列宽度" });
    const aside = screen.getByRole("complementary", { name: "选择任务" });
    fireEvent.mouseDown(handle, { clientX: 232 });
    fireEvent.mouseMove(document, { clientX: 300 });
    fireEvent.mouseUp(document);
    expect(aside.style.width).toBe("300px");
    // 低于下限钳到 184
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 50 });
    fireEvent.mouseUp(document);
    expect(aside.style.width).toBe("184px");
    await waitFor(() => expect(localStorage.getItem("mc.workbenchListWidth")).toBe("184"));
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute("aria-valuemin")).toBe("184");
    expect(handle.getAttribute("aria-valuemax")).toBe("420");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(aside.style.width).toBe("192px");
    fireEvent.keyDown(handle, { key: "End" });
    expect(aside.style.width).toBe("420px");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(aside.style.width).toBe("184px");
    fireEvent.doubleClick(handle);
    expect(aside.style.width).toBe("232px");
  });

  it("把手按树节点独立:四格拖左列横切不牵动右列与贯通竖切;双击回平分", () => {
    stubShell();
    localStorage.setItem(
      "mc.splitTree",
      JSON.stringify({
        dir: "col",
        ratio: 0.5,
        a: { dir: "row", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 2 } },
        b: { dir: "row", ratio: 0.5, a: { leaf: 1 }, b: { leaf: 3 } },
      }),
    );
    const { container } = render(<Harness />);
    const handle = container.querySelector<HTMLElement>('[data-split-handle="a"]')!;
    vi.spyOn(handle.parentElement!, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 500, height: 800, right: 500, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    fireEvent.mouseDown(handle, { clientY: 400 });
    fireEvent.mouseMove(window, { clientY: 600 }); // 600/800 = 0.75
    fireEvent.mouseUp(window);
    expect(document.body.style.cursor).toBe(""); // 收尾纪律:全局样式收回
    const saved = JSON.parse(localStorage.getItem("mc.splitTree") ?? "null");
    expect(saved.a.ratio).toBeCloseTo(0.75);
    expect(saved.b.ratio).toBe(0.5); // 右列不牵动
    expect(saved.ratio).toBe(0.5); // 贯通竖切不牵动
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute("aria-orientation")).toBe("horizontal");
    expect(handle.getAttribute("aria-valuenow")).toBe("75");
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(JSON.parse(localStorage.getItem("mc.splitTree") ?? "null").a.ratio).toBe(0.8);
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(JSON.parse(localStorage.getItem("mc.splitTree") ?? "null").a.ratio).toBeCloseTo(0.75);
    fireEvent.doubleClick(container.querySelector('[data-split-handle="a"]')!);
    expect(JSON.parse(localStorage.getItem("mc.splitTree") ?? "null").a.ratio).toBe(0.5);
    const resetHandle = container.querySelector<HTMLElement>('[data-split-handle="a"]')!;
    fireEvent.mouseDown(resetHandle, { clientY: 400 });
    fireEvent.mouseMove(window, { clientY: 0 });
    fireEvent.mouseUp(window);
    expect(JSON.parse(localStorage.getItem("mc.splitTree") ?? "null").a.ratio).toBeCloseTo(48 / 800);
  });

  it("三格双击贯通线:按辖下格数分成 2:1,并递归均分左侧两格", () => {
    stubShell();
    localStorage.setItem(
      "mc.splitTree",
      JSON.stringify({
        dir: "col",
        ratio: 0.5,
        a: { dir: "row", ratio: 0.7, a: { leaf: 0 }, b: { leaf: 2 } },
        b: { leaf: 1 },
      }),
    );
    const { container } = render(<Harness />);
    fireEvent.doubleClick(container.querySelector('[data-split-handle="root"]')!);
    const saved = JSON.parse(localStorage.getItem("mc.splitTree") ?? "null");
    expect(saved.ratio).toBeCloseTo(2 / 3);
    expect(saved.a.ratio).toBe(0.5);
  });

  it("七格 1:6 均分可落盘并继续用键盘调整", () => {
    stubShell();
    localStorage.setItem(
      "mc.splitTree",
      JSON.stringify({
        dir: "col",
        ratio: 0.5,
        a: { leaf: 0 },
        b: {
          dir: "col",
          ratio: 0.5,
          a: { leaf: 1 },
          b: {
            dir: "col",
            ratio: 0.5,
            a: { leaf: 2 },
            b: {
              dir: "col",
              ratio: 0.5,
              a: { leaf: 3 },
              b: {
                dir: "col",
                ratio: 0.5,
                a: { leaf: 4 },
                b: { dir: "col", ratio: 0.5, a: { leaf: 5 }, b: { leaf: 6 } },
              },
            },
          },
        },
      }),
    );
    const { container } = render(<Harness />);
    const root = container.querySelector<HTMLElement>('[data-split-handle="root"]')!;
    fireEvent.doubleClick(root);
    expect(JSON.parse(localStorage.getItem("mc.splitTree") ?? "null").ratio).toBeCloseTo(1 / 7);
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(JSON.parse(localStorage.getItem("mc.splitTree") ?? "null").ratio).toBeCloseTo(1 / 7 - 0.05);
    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(JSON.parse(localStorage.getItem("mc.splitTree") ?? "null").ratio).toBeCloseTo(1 / 7);
  });

  it("按住格头标题拖到另一格 = 交换位置(内容跟格走,落点有高亮)", () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    const first = screen.getByRole("region", { name: "第 1 格" });
    const second = screen.getByRole("region", { name: "第 2 格" });
    expect(within(first).getByTitle(/已入格的任务/)).toBeTruthy();
    const dt = fakeDT();
    fireEvent.dragStart(within(first).getByTitle(/已入格的任务/), { dataTransfer: dt });
    fireEvent.dragOver(second, { dataTransfer: dt });
    expect(second.querySelector("[data-split-drop]")).not.toBeNull(); // 落点高亮
    fireEvent.drop(second, { dataTransfer: dt });
    // 树上两叶交换 = 两格连内容一起对调位置(槽号跟格走,故按 DOM 序断言:
    // 视觉左侧现在是 s2,右侧是 s1)
    const after = screen.getAllByRole("region");
    expect(within(after[0]!).getByTitle(/跑着的任务/)).toBeTruthy();
    expect(within(after[1]!).getByTitle(/已入格的任务/)).toBeTruthy();
    // 被拖的是槽 0；交换后它视觉上到了右侧，但槽号仍是 0，焦点应跟着它。
    expect(screen.getByRole("region", { name: "第 1 格" }).querySelector("[data-split-focus]")).not.toBeNull();
    expect(screen.getByRole("region", { name: "第 2 格" }).querySelector("[data-split-focus]")).toBeNull();
  });

  it("任务拖到目标 Panel 上边缘 = 只拆该 Panel；其他列不受影响", () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null]));
    const { container } = render(<Harness />);
    const grid = container.querySelector<HTMLElement>("[data-split-grid]")!;
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
    });
    const first = screen.getByRole("region", { name: "第 1 格" });
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 500, height: 800, right: 500, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
    });
    const row = within(screen.getByRole("complementary", { name: "选择任务" })).getByText("跑着的任务").closest("button")!;
    const dt = fakeDT();
    fireEvent.dragStart(row, { dataTransfer: dt });
    fireDragAt(first, "dragover", dt, 500, 12);
    expect(grid.querySelector('[data-split-root-drop="top"]')).toBeNull();
    expect(first.querySelector('[data-split-pane-drop="top"]')).not.toBeNull();
    expect(first.querySelector("[data-split-drop]")).toBeNull();
    fireDragAt(first, "drop", dt, 500, 12);

    const panes = screen.getAllByRole("region");
    expect(panes).toHaveLength(3);
    expect(panes[0]!.getAttribute("aria-label")).toBe("第 3 格");
    expect(within(panes[0]!).getByTitle(/跑着的任务/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "第 1 格" })).getByTitle(/已入格的任务/)).toBeTruthy();
    expect(panes[0]!.parentElement?.style.width).toBe("50%");
    expect(panes[0]!.parentElement?.style.height).toBe("50%");
    expect(screen.getByRole("region", { name: "第 2 格" }).parentElement?.style.height).toBe("100%");
  });

  it("任务拖到目标 Panel 下边缘以及整个主视图左边缘均可创建", () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null]));
    const { container, unmount } = render(<Harness />);
    const grid = container.querySelector<HTMLElement>("[data-split-grid]")!;
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
    });
    const first = screen.getByRole("region", { name: "第 1 格" });
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 500, height: 800, right: 500, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
    });
    const row = within(screen.getByRole("complementary", { name: "选择任务" })).getByText("跑着的任务").closest("button")!;
    const bottomDt = fakeDT();
    fireEvent.dragStart(row, { dataTransfer: bottomDt });
    fireDragAt(first, "dragover", bottomDt, 250, 788);
    expect(first.querySelector('[data-split-pane-drop="bottom"]')).not.toBeNull();
    fireDragAt(first, "drop", bottomDt, 250, 788);
    expect(screen.getAllByRole("region").map((pane) => pane.getAttribute("aria-label"))).toEqual(["第 1 格", "第 3 格", "第 2 格"]);

    unmount();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null]));
    const secondRender = render(<Harness />);
    const secondGrid = secondRender.container.querySelector<HTMLElement>("[data-split-grid]")!;
    vi.spyOn(secondGrid, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
    });
    const secondFirst = screen.getByRole("region", { name: "第 1 格" });
    const secondRow = within(screen.getByRole("complementary", { name: "选择任务" })).getByText("跑着的任务").closest("button")!;
    const leftDt = fakeDT();
    fireEvent.dragStart(secondRow, { dataTransfer: leftDt });
    fireDragAt(secondFirst, "dragover", leftDt, 12, 400);
    expect(secondGrid.querySelector('[data-split-root-drop="left"]')).not.toBeNull();
    fireDragAt(secondFirst, "drop", leftDt, 12, 400);
    const panes = screen.getAllByRole("region");
    expect(panes.map((pane) => pane.getAttribute("aria-label"))).toEqual(["第 3 格", "第 1 格", "第 2 格"]);
    expect(parseFloat(panes[0]!.parentElement?.style.width ?? "0")).toBeCloseTo(100 / 3);
  });

  it("Panel 拖到整个主视图右边缘 = 搬到根级右侧并收拢原位置", () => {
    stubShell();
    localStorage.setItem(
      "mc.splitTree",
      JSON.stringify({
        dir: "row",
        ratio: 0.5,
        a: { dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } },
        b: { leaf: 2 },
      }),
    );
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", "s3"]));
    const { container } = render(<Harness />);
    const grid = container.querySelector<HTMLElement>("[data-split-grid]")!;
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
    });
    const first = screen.getByRole("region", { name: "第 1 格" });
    const target = screen.getByRole("region", { name: "第 3 格" });
    const dt = fakeDT();
    fireEvent.dragStart(within(first).getByTitle(/已入格的任务/), { dataTransfer: dt });
    fireDragAt(target, "dragover", dt, 988, 400);
    expect(grid.querySelector('[data-split-root-drop="right"]')).not.toBeNull();
    fireDragAt(target, "drop", dt, 988, 400);

    const panes = screen.getAllByRole("region");
    expect(panes).toHaveLength(3);
    expect(panes.map((pane) => pane.getAttribute("aria-label"))).toEqual(["第 2 格", "第 3 格", "第 1 格"]);
    expect(within(panes[2]!).getByTitle(/已入格的任务/)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("mc.splitSlots") ?? "[]")).toEqual(["s1", "s2", "s3"]);
  });

  it("布局模板钮退役(2026-08-18 用户定案「没啥用」——拆分/关闭本身就是布局手段):头部无布局组", () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    // 多格 + 列开:右侧顶条整块退场(2026-08-19「整个 panel 浮上去」),
    // 布局组自然无处安身;全局也无一颗布局钮
    expect(document.querySelector("[data-view-header]")).toBeNull();
    expect(screen.queryByRole("group", { name: "布局" })).toBeNull();
    expect(screen.queryByRole("button", { name: /单格|左右双格|上下双格|四格/ })).toBeNull();
    // 布局手段仍在:格细头「格操作」菜单(多格)/视图头同款(单格融合)
    expect(within(screen.getByRole("region", { name: "第 1 格" })).getByRole("button", { name: "格操作" })).toBeTruthy();
  });

  it("第七格的动态细头插槽可用：「会话文件」打开文件抽屉", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ leaf: 6 }));
    localStorage.setItem("mc.splitSlots", JSON.stringify([null, null, null, null, null, null, "s1"]));
    render(<Harness />);
    await userEvent.click(
      await within(screen.getByRole("region", { name: "第 7 格" })).findByRole("button", { name: "会话文件" }),
    );
    // FilesDrawer 挂上(文件/改动两页签);关掉即收
    expect(await screen.findByRole("tab", { name: /文件/ })).toBeTruthy();
  });

  it("点装载卡行 → onAssign(槽, 会话) 且该格挂载", async () => {
    stubShell();
    localStorage.setItem("mc.workbenchListHidden", "1"); // 钉在装载卡路径(任务列默认展开时空格是提示卡)
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    const assigned = vi.fn();
    render(<Harness onAssign={assigned} />);
    await userEvent.click(screen.getByText("跑着的任务"));
    expect(assigned).toHaveBeenCalledWith(1, "s2");
    expect(within(screen.getAllByRole("region")[1]!).getByTitle(/跑着的任务/)).toBeTruthy();
  });

  // jsdom 无布局,类名机检钉住(layoutContract 同手法):嵌套 flex 的内在
  // 宽度上传只要有一环缺 min-w-0,整棵格区就跟着最宽内容走(2026-08-18
  // 用户报障「右侧 panel 向右溢出」,Chrome 实测:一段长代码把格撑到
  // 8054px、文档 9857px)。真实布局验证走 probe.tmp.mjs 手跑
  it("格区宽度总闸:格区与其父行两层容器都带 min-w-0(2026-08-18 溢出事故根因)", () => {
    stubShell();
    const { container } = render(<Harness />);
    const grid = container.querySelector<HTMLElement>("[data-split-grid]")!;
    expect(grid.className).toContain("min-w-0");
    expect(grid.parentElement!.className).toContain("min-w-0");
  });

  it("每格全套 composer(轻输入条 2026-08-19 撤销「不需要缩小」);细头按钮簇悬停显隐", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    const first = screen.getByRole("region", { name: "第 1 格" });
    const second = screen.getByRole("region", { name: "第 2 格" });
    // 焦点与否都全套 composer,轻输入条不复存在
    await waitFor(() => expect(within(first).getByRole("textbox")).toBeTruthy());
    await waitFor(() => expect(within(second).getByRole("textbox")).toBeTruthy());
    expect(second.querySelector("[data-slim-composer]")).toBeNull();
    // 细头按钮簇默认隐形占位(invisible,不挤布局),悬停/焦点才浮现
    const cluster = within(second).getByRole("button", { name: "格操作" }).parentElement!;
    expect(cluster.className).toContain("invisible");
    expect(cluster.className).toContain("group-hover/pane:visible");
  });

  it("焦点跟随按下:多格并存恰有一枚焦点环,pointerdown 换格即移动", () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    const panes = screen.getAllByRole("region");
    expect(panes[0]!.querySelector("[data-split-focus]")).not.toBeNull();
    expect(panes[1]!.querySelector("[data-split-focus]")).toBeNull();
    fireEvent.pointerDown(panes[1]!);
    expect(panes[0]!.querySelector("[data-split-focus]")).toBeNull();
    expect(panes[1]!.querySelector("[data-split-focus]")).not.toBeNull();
  });

  it("格内内嵌新建:装载卡「新建任务」原地换成创建表单(不跳整页),取消回装载卡", async () => {
    stubShell();
    localStorage.setItem("mc.workbenchListHidden", "1"); // 钉在装载卡路径(任务列默认展开时空格是提示卡)
    render(<Harness />);
    await userEvent.click(screen.getAllByRole("button", { name: "新建任务" })[0]!);
    const pane = screen.getAllByRole("region")[0]!;
    expect(within(pane).getByRole("heading", { name: "新建任务" })).toBeTruthy();
    expect(document.querySelectorAll("main")).toHaveLength(1);
    // 云端页签在格内同样可用(2026-08-18 整页新建退役,「云端不内嵌」随之作废)
    expect(within(pane).getByRole("tab", { name: /云端任务/ })).toBeTruthy();
    expect(within(pane).getByRole("tab", { name: /本地任务/ })).toBeTruthy();
    await userEvent.click(within(pane).getByRole("button", { name: "取消" }));
    expect(within(pane).queryByRole("heading", { name: "新建任务" })).toBeNull();
    expect(within(pane).getByRole("tab", { name: "本地" })).toBeTruthy();
  });

  it("新建即新格(2026-08-18 定案「创建任务也是一个 panel」):格全被占时拆新格装表单,取消收回", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    await userEvent.click(within(list).getByRole("button", { name: "新建任务" }));
    // 两格都有会话 → 不覆盖任何一格,拆出第 3 格专供创建
    expect(screen.getAllByRole("region")).toHaveLength(3);
    const pane = screen.getByRole("region", { name: "第 3 格" });
    expect(within(pane).getByRole("heading", { name: "新建任务" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "第 1 格" })).getByTitle(/已入格的任务/)).toBeTruthy();
    // 取消:专为创建拆的格收回,不留空格尾巴
    await userEvent.click(within(pane).getByRole("button", { name: "取消" }));
    expect(screen.getAllByRole("region")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "新建任务" })).toBeNull();
  });

  it("拆出的创建格成功后保留任务与 pane,onClose 只把取消当成收格", async () => {
    const shell = stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    await userEvent.click(
      within(screen.getByRole("complementary", { name: "选择任务" })).getByRole("button", { name: "新建任务" }),
    );
    const createdPane = screen.getByRole("region", { name: "第 3 格" });
    await userEvent.click(within(createdPane).getByRole("button", { name: "创建" }));
    await waitFor(() => expect(shell.calls.some((c) => c.cmd === "session_create")).toBe(true));
    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(3));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("mc.splitSlots") ?? "[]")[2]).toBe("created"));
  });

  it("六格全满时新建表单拆出第七格，不覆盖已有会话", async () => {
    stubShell();
    const sixTree = {
      dir: "col",
      ratio: 0.5,
      a: { dir: "row", ratio: 0.5, a: { leaf: 0 }, b: { dir: "row", ratio: 0.5, a: { leaf: 1 }, b: { leaf: 2 } } },
      b: { dir: "row", ratio: 0.5, a: { leaf: 3 }, b: { dir: "row", ratio: 0.5, a: { leaf: 4 }, b: { leaf: 5 } } },
    };
    const sessions = Array.from({ length: 6 }, (_, i) => meta({ id: `full-${i}`, title: `满格 ${i}` }));
    localStorage.setItem("mc.splitTree", JSON.stringify(sixTree));
    localStorage.setItem("mc.splitSlots", JSON.stringify(sessions.map((s) => s.id)));
    render(<Harness sessions={sessions} />);
    await userEvent.click(
      within(screen.getByRole("complementary", { name: "选择任务" })).getByRole("button", { name: "新建任务" }),
    );
    expect(screen.getAllByRole("region")).toHaveLength(7);
    expect(within(screen.getByRole("region", { name: "第 7 格" })).getByRole("heading", { name: "新建任务" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "第 1 格" })).getByTitle(/^满格 0/)).toBeTruthy();
  });

  it("工作台 inactive 时 window 级原生文件拖放不投递到后台 pane", async () => {
    const shell = stubShell();
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    render(<Harness active={false} />);
    await waitFor(() => expect(shell.listenerCount("tauri://drag-drop")).toBe(1));

    shell.emit("tauri://drag-drop", { paths: ["/tmp/hidden.txt"] });
    await act(() => Promise.resolve());
    expect(shell.calls.filter((c) => c.cmd === "stat_dropped_file")).toHaveLength(0);
  });

  it("Linux window 级原生文件拖放每次只投递给焦点 pane", async () => {
    const shell = stubShell();
    const sessions = [meta({ id: "left", title: "左格" }), meta({ id: "right", title: "右格" })];
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["left", "right", null, null, null, null]));
    render(<Harness sessions={sessions} />);
    await waitFor(() => expect(shell.listenerCount("tauri://drag-drop")).toBe(2));

    shell.emit("tauri://drag-drop", { paths: ["/tmp/one.txt"] });
    await waitFor(() => expect(shell.calls.filter((c) => c.cmd === "stat_dropped_file")).toHaveLength(1));
    await waitFor(() =>
      expect(shell.calls.some((c) => c.cmd === "upload_file_path" && c.args?.id === "left")).toBe(true),
    );

    fireEvent.pointerDown(screen.getByRole("region", { name: "第 2 格" }));
    shell.emit("tauri://drag-drop", { paths: ["/tmp/two.txt"] });
    await waitFor(() => expect(shell.calls.filter((c) => c.cmd === "stat_dropped_file")).toHaveLength(2));
    await waitFor(() =>
      expect(shell.calls.some((c) => c.cmd === "upload_file_path" && c.args?.id === "right")).toBe(true),
    );
  });

  it("「临时会话」组:默认在待办之下、项目组之前;与项目组同快照拖动排序", async () => {
    stubShell();
    const list: SessionMeta[] = [
      meta({ id: "a1", title: "甲任务", workdir: "/p/alpha", updated_at: "2026-08-18T02:00:00Z" }),
      meta({ id: "c9", title: "闲聊", kind: "chat", workdir: "", waiting_ask: true, updated_at: "2026-08-18T01:00:00Z" }),
    ];
    render(<Harness sessions={list} />);
    const strip = screen.getByRole("complementary", { name: "选择任务" });
    // 默认序:临时会话在项目组之前(待办组是列表最前的固定段,本 Harness
    // 未接待办 wiring,组间序不受影响)
    const chatsHead = within(strip).getByText("临时会话");
    // 等待处理只在具体会话行外显，组头不展示数字。
    expect(chatsHead.closest("button")?.querySelector(".badge")).toBeNull();
    expect(chatsHead.compareDocumentPosition(within(strip).getByText("alpha")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 拖 alpha 落到临时会话之前:快照写盘且渲染序翻转
    const dt = fakeDT();
    fireEvent.dragStart(within(strip).getByText("alpha").closest("button")!, { dataTransfer: dt });
    fireEvent.dragOver(within(strip).getByText("临时会话").closest("button")!, { dataTransfer: dt });
    fireEvent.drop(within(strip).getByText("临时会话").closest("button")!, { dataTransfer: dt });
    expect(JSON.parse(localStorage.getItem("mc.projectOrder") ?? "[]")).toEqual(["/p/alpha", "\u0000chats"]);
    expect(
      within(strip).getByText("alpha").compareDocumentPosition(within(strip).getByText("临时会话")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("「临时会话」组头「+」快捷新建:内嵌表单落本地页签的「临时会话」档(会话不关联项目)", async () => {
    stubShell();
    render(<Harness sessions={[]} />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    // 固定组头常驻；没有任何项目的新安装也保留「项目」分区锚点。
    const chatsHead = within(list).getByText("临时会话");
    const projectsCap = within(list).getByText("项目");
    expect(within(list).getByText("暂无项目，点击右上角「+」新建")).toBeTruthy();
    expect(chatsHead.compareDocumentPosition(projectsCap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(within(list).getByRole("button", { name: "新建会话" }));
    const pane = screen.getAllByRole("region")[0]!;
    expect(within(pane).getByRole("tab", { name: /本地任务/ }).getAttribute("aria-selected")).toBe("true");
    expect(within(pane).getByRole("button", { name: "选择项目" }).textContent).toContain("临时会话");
  });

  it("任务列默认展开:新建/列开关双钮在列内(2026-08-18 定案),点行走 place 路由(在场定位/空格装载)", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    render(<Harness />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    // 计数统计行已撤(2026-08-18 用户定案「没啥用」);列在场时主区头不再
    // 有新建钮。列顶 chrome 行(mac 净空标记)只归 mac——非 mac 平台它是
    // 空行挂两颗钮,双钮改住品牌行行尾(2026-08-20 用户报障「空了一行」)
    expect(within(list).queryByText(/\d+ 项目/)).toBeNull();
    expect(within(list).getByRole("button", { name: "新建任务" })).toBeTruthy();
    expect(list.querySelector("[data-mac-lights-clear]")).toBeNull();
    expect(within(list).getByRole("button", { name: "收起任务列" })).toBeTruthy();
    // 多格 + 列开:右侧无顶条(2026-08-19「整个 panel 浮上去」),画布
    // 自任拖窗面
    expect(document.querySelector("[data-view-header]")).toBeNull();
    expect(document.querySelector("[data-split-grid]")!.hasAttribute("data-tauri-drag-region")).toBe(true);
    // 任务列**包含**已入格的 s1(装载卡才判重),在场信息进行 tooltip
    const onBoardRow = within(list).getByText("已入格的任务").closest("button")!;
    expect(onBoardRow.getAttribute("title")).toContain("已在工作台上");
    // 空格是轻提示卡,不再重复一份列表(左右两份列表像镜子)
    const emptyPane = screen.getByRole("region", { name: "第 2 格" });
    expect(within(emptyPane).getByText("把左侧的任务拖到这里,或新建一个")).toBeTruthy();
    expect(within(emptyPane).queryByRole("tab", { name: "本地" })).toBeNull();
    // 点屏外行 → 装进空格(place:叶序第一个空格)
    await userEvent.click(within(list).getByText("跑着的任务"));
    expect(within(screen.getByRole("region", { name: "第 2 格" })).getByTitle(/跑着的任务/)).toBeTruthy();
    // 点已入格行 → 不重复装载,焦点定位过去
    await userEvent.click(within(list).getByText("已入格的任务"));
    expect(screen.getByRole("region", { name: "第 1 格" }).querySelector("[data-split-focus]")).not.toBeNull();
  });

  it("组头按旧侧栏对表(2026-08-18 报障回归):裸项目名、开合换 Folder/FolderOpen、waiting 徽标、hover「+」快捷新建", async () => {
    stubShell();
    const list: SessionMeta[] = [
      meta({ id: "m1", title: "任务甲", workdir: "/x/MonkeyCode", updated_at: "2026-08-18T02:00:00Z" }),
      meta({ id: "m2", title: "任务乙", workdir: "/y/MonkeyCode", waiting_ask: true, updated_at: "2026-08-18T01:00:00Z" }),
    ];
    render(<Harness sessions={list} />);
    const strip = screen.getByRole("complementary", { name: "选择任务" });
    // 裸项目名:撞名也不缀父目录段(旧侧栏原样,全路径在组头 title 里)。
    // 品牌行字标也是 "MonkeyCode"(2026-08-18 加回),组头按 a[aria-expanded] 收口
    const groupHeads = () =>
      within(strip)
        .getAllByText("MonkeyCode")
        .map((n) => n.closest("button"))
        .filter((a): a is HTMLButtonElement => !!a && a.hasAttribute("aria-expanded"));
    expect(groupHeads()).toHaveLength(2);
    expect(within(strip).queryByText(/MonkeyCode · /)).toBeNull();
    // waiting 徽标挂在「等待确认」那组(/y 组 m2)的组头
    const heads = groupHeads();
    expect(heads.some((h) => h.querySelector(".badge-warning")?.textContent === "1")).toBe(true);
    // 展开态 FolderOpen ↔ 收起态 Folder(图标随开合)
    expect(heads[0]!.querySelector(".tabler-icon-folder-open")).not.toBeNull();
    await userEvent.click(heads[0]!);
    const headAfter = groupHeads()[0]!;
    expect(headAfter.querySelector(".tabler-icon-folder-open")).toBeNull();
    expect(headAfter.querySelector(".tabler-icon-folder")).not.toBeNull();
    // hover「+」快捷新建:常驻占位(invisible 只切可见性),点它开内嵌预填
    const plus = within(headAfter.parentElement!).getByRole("button", { name: "在此项目新建任务" });
    expect(plus.className).toContain("invisible");
    expect(plus.className).toContain("group-hover/ghead:visible");
    expect(headAfter.parentElement?.className).toContain("p-0");
    expect(headAfter.parentElement?.className).toContain("gap-0");
    expect(headAfter.className).toContain("min-h-8");
    expect(plus.className).toContain("w-9");
    // daisyUI menu 的 hover/padding 在外层容器；直接点该边缘也必须开合。
    fireEvent.click(headAfter.parentElement!);
    expect(groupHeads()[0]!.querySelector(".tabler-icon-folder-open")).not.toBeNull();
    await userEvent.click(plus);
    expect(await screen.findByRole("heading", { name: "新建任务" })).toBeTruthy();
  });

  it("项目归档全套(2026-08-18 报障回归):组头右键归档 → 入底部小节;右键恢复;项目内归档任务小节", async () => {
    stubShell();
    const list: SessionMeta[] = [
      meta({ id: "a1", title: "甲任务", workdir: "/p/alpha", updated_at: "2026-08-18T02:00:00Z" }),
      meta({ id: "a2", title: "甲的旧任务", workdir: "/p/alpha", archived: true, updated_at: "2026-08-18T01:00:00Z" }),
      meta({ id: "b1", title: "乙任务", workdir: "/p/beta", updated_at: "2026-08-18T00:00:00Z" }),
    ];
    render(<Harness sessions={list} />);
    const strip = screen.getByRole("complementary", { name: "选择任务" });
    // 项目内「已归档任务」小节:点开出降色行
    expect(within(strip).queryByText("甲的旧任务")).toBeNull();
    await userEvent.click(within(strip).getByText("已归档任务"));
    expect(within(strip).getByText("甲的旧任务")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("mc.sessionArchivesOpen") ?? "[]")).toContain("/p/alpha");
    // 组头右键「归档项目」:beta 移入底部「已归档项目」小节
    fireEvent.contextMenu(within(strip).getByText("beta"));
    await userEvent.click(within(document.body.lastElementChild as HTMLElement).getByText("归档项目"));
    expect(JSON.parse(localStorage.getItem("mc.archivedProjects") ?? "[]")).toContain("/p/beta");
    expect(within(strip).getByText("已归档项目")).toBeTruthy();
    // 展开小节 → 组头右键「恢复项目」回到活跃区
    await userEvent.click(within(strip).getByText("已归档项目"));
    fireEvent.contextMenu(within(strip).getByText("beta"));
    await userEvent.click(within(document.body.lastElementChild as HTMLElement).getByText("恢复项目"));
    expect(JSON.parse(localStorage.getItem("mc.archivedProjects") ?? "[]")).not.toContain("/p/beta");
  });

  it("组头拖拽排序(mc.projectOrder 全序快照)与「在此项目新建任务」(内嵌预填)", async () => {
    stubShell();
    const list: SessionMeta[] = [
      meta({ id: "a1", title: "甲任务", workdir: "/p/alpha", updated_at: "2026-08-18T02:00:00Z" }),
      meta({ id: "b1", title: "乙任务", workdir: "/p/beta", updated_at: "2026-08-18T00:00:00Z" }),
    ];
    render(<Harness sessions={list} />);
    const strip = screen.getByRole("complementary", { name: "选择任务" });
    const dt = fakeDT();
    fireEvent.dragStart(within(strip).getByText("alpha").closest("button")!, { dataTransfer: dt });
    fireEvent.dragOver(within(strip).getByText("beta").closest("button")!, { dataTransfer: dt });
    fireEvent.drop(within(strip).getByText("beta").closest("button")!, { dataTransfer: dt });
    // alpha 挪到 beta 前?reorderKeys(dragged→before):alpha 落在 beta 之前
    // 「临时会话」哨兵键同一条快照入序(默认居首,项目相对序不受扰)
    expect(JSON.parse(localStorage.getItem("mc.projectOrder") ?? "[]")).toEqual(["\u0000chats", "/p/alpha", "/p/beta"]);
    // 组头右键「在此新建任务」(旧侧栏 newTaskIn 键)→ 格内内嵌创建表单
    fireEvent.contextMenu(within(strip).getByText("beta"));
    await userEvent.click(within(document.body.lastElementChild as HTMLElement).getByText("在此新建任务"));
    expect(await screen.findByRole("heading", { name: "新建任务" })).toBeTruthy();
  });

  it("项目组可折叠:点组头收起行(卸载),与主侧栏共用 mc.collapsedGroups", async () => {
    stubShell();
    render(<Harness />);
    const strip = screen.getByRole("complementary", { name: "选择任务" });
    expect(within(strip).getByText("闲着的任务")).toBeTruthy();
    await userEvent.click(within(strip).getByText("alpha"));
    expect(within(strip).queryByText("闲着的任务")).toBeNull();
    expect(JSON.parse(localStorage.getItem("mc.collapsedGroups") ?? "[]")).toContain("/p/alpha");
    await userEvent.click(within(strip).getByText("alpha"));
    expect(within(strip).getByText("闲着的任务")).toBeTruthy();
  });

  it("任务列可折叠:一键收起回全沉浸(空格换回完整装载卡),开合态落盘", async () => {
    stubShell();
    render(<Harness />);
    expect(screen.getByRole("complementary", { name: "选择任务" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "收起任务列" }));
    expect(screen.queryByRole("complementary", { name: "选择任务" })).toBeNull();
    expect(localStorage.getItem("mc.workbenchListHidden")).toBe("1");
    // 收起后空格回落完整装载卡(装载能力不丢)
    expect(within(screen.getAllByRole("region")[0]!).getByRole("tab", { name: "本地" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "展开任务列" }));
    expect(screen.getByRole("complementary", { name: "选择任务" })).toBeTruthy();
    expect(localStorage.getItem("mc.workbenchListHidden")).toBe("0");
  });

  it("任务列拖行到格 = 定点装载(LOAD 通道与格头换位 SWAP 通道并存)", () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    render(<Harness />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    const first = screen.getByRole("region", { name: "第 1 格" });
    const dt = fakeDT();
    fireEvent.dragStart(within(list).getByText("跑着的任务").closest("button")!, { dataTransfer: dt });
    fireEvent.dragOver(first, { dataTransfer: dt });
    expect(first.querySelector("[data-split-drop]")).not.toBeNull();
    fireEvent.drop(first, { dataTransfer: dt });
    // 定点顶替第 1 格(move 语义;原 s1 从格上卸下——任务列的行照常在,
    // 断言只看格子)
    expect(within(screen.getByRole("region", { name: "第 1 格" })).getByTitle(/跑着的任务/)).toBeTruthy();
    for (const pane of screen.getAllByRole("region")) {
      expect(within(pane).queryByTitle(/已入格的任务/)).toBeNull();
    }
  });

  it("工作台只有一层背景，任务列、pane 与画布使用显式语义表面", () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    const { container } = render(<Harness />);
    expect(container.querySelectorAll(".mc-workbench-background")).toHaveLength(1);
    expect(container.querySelector(".mc-workbench-background")?.getAttribute("aria-hidden")).not.toBeNull();
    expect(screen.getByRole("complementary", { name: "选择任务" }).className).toContain("mc-workbench-surface-200");
    expect(screen.getByRole("region", { name: "第 1 格" }).className).toContain("mc-workbench-surface-100");
    expect(container.querySelector<HTMLElement>("[data-split-grid]")?.className).toContain("mc-workbench-surface-300");
    expect(container.querySelector("[data-split-handle] .mc-workbench-surface-300")).not.toBeNull();
  });
});
