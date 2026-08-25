import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionMeta } from "@/lib/ipc/sessions";
import {
  cloudSendQueueTarget,
  createSendQueueItem,
  enqueue,
  localSendQueueKey,
  localSendQueueTarget,
  readSendQueueLane,
  resetSendQueueMemoryForTests,
  updateSendQueueLane,
  writeSendQueueLane,
} from "@/features/chat/composer/sendQueue";
import { resetStashForTests } from "@/features/chat/composer/stash";
import { App } from "./App";

beforeEach(() => {
  resetSendQueueMemoryForTests();
  resetStashForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("壳骨架(工作台即主界面,2026-08-18 换代)", () => {
  it("启动即工作台:视图头 + 任务列(三 tab)+ 格区;旧 rail/侧栏不存在", () => {
    render(<App />);
    expect(screen.getByRole("complementary", { name: "选择任务" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "选择任务" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "本地" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "云端" })).toBeTruthy();
    // 「本地会话」tab 撤并(2026-08-18):chat 是本地列表里的「临时会话」组
    expect(screen.queryByRole("tab", { name: /本地会话/ })).toBeNull();
    expect(within(screen.getByRole("complementary", { name: "选择任务" })).getByText("临时会话")).toBeTruthy();
    // 旧三列壳退役:空间导航 rail 与旧会话侧栏都不再渲染
    expect(screen.queryByRole("navigation", { name: "空间导航" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "会话列表" })).toBeNull();
  });

  it("浏览器模式:不渲染 Windows 标题栏与 mac 小灯", () => {
    const { container } = render(<App />);
    expect(container.querySelector("[data-window-titlebar]")).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
    expect(screen.queryByRole("button", { name: "缩放" })).toBeNull();
  });

  // Windows 与 Linux 壳都走 decorations(false),UI 侧自绘同一条窗框
  it.each([
    ["Windows NT 10.0", "Windows"],
    ["X11; Linux x86_64", "Linux"],
  ])("%s 壳:渲染自绘窗框条三键", (ua) => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: () => Promise.resolve(false) },
      event: { listen: () => Promise.resolve(() => {}) },
    };
    vi.stubGlobal("navigator", { ...window.navigator, userAgent: ua });
    const { container } = render(<App />);
    expect(container.querySelector("[data-window-titlebar]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "最小化" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "最大化" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
  });

  it("mac 壳:自绘小灯回归(2026-08-20「原生太大」二次反转),固定左上、⌥ 绿点最大化;无 Windows 三键", async () => {
    const shell = stubShell();
    vi.stubGlobal("navigator", { ...window.navigator, userAgent: "Macintosh; Intel Mac OS X 10_15_7" });
    const { container } = render(<App />);
    expect(container.querySelector("[data-window-titlebar]")).toBeNull();
    expect(screen.queryByRole("button", { name: "最大化" })).toBeNull();
    // 三颗小灯在(全局固定左上,不随视图切换消失);贴角 chrome 带净空标记
    expect(screen.getByRole("button", { name: "缩放" })).toBeTruthy();
    expect(
      screen.getByRole("complementary", { name: "选择任务" }).querySelector("[data-mac-lights-clear]"),
    ).not.toBeNull();
    // 绿点默认切全屏(⌥ 才是最大化)
    await userEvent.click(screen.getByRole("button", { name: "缩放" }));
    await waitFor(() => expect(shell.count("plugin:window|is_fullscreen")).toBe(1));
  });

  // 2026-08-20 用户报障「两个操作空了一行,折叠后也空一行」:非 mac 下
  // 列顶 chrome 行(存在理由 = mac 灯净空)整行省掉;列收起时 ☰/新建
  // 借住自绘标题栏左端,不再单开 h-10 顶条
  it("Windows 壳列收起:☰/新建借住标题栏左端,不再单开一行顶条", async () => {
    stubShell();
    vi.stubGlobal("navigator", { ...window.navigator, userAgent: "Windows NT 10.0" });
    localStorage.setItem("mc.workbenchListHidden", "1");
    const { container } = render(<App />);
    const bar = container.querySelector("[data-window-titlebar]") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(document.querySelector("[data-view-header]")).toBeNull(); // 顶条免开
    await userEvent.click(within(bar).getByRole("button", { name: "展开任务列" }));
    const list = screen.getByRole("complementary", { name: "选择任务" });
    // 展开后双钮回列内品牌行,标题栏回归纯 chrome
    expect(within(bar).queryByRole("button", { name: "收起任务列" })).toBeNull();
    expect(within(list).getByRole("button", { name: "收起任务列" })).toBeTruthy();
  });
});

describe("设置入口(外观/语言/配置在 SettingsView,各有专测)", () => {
  it("Ctrl+, 以模态打开设置并保持幂等，工作台不卸载", () => {
    render(<App />);
    const workbench = screen.getByRole("main");
    fireEvent.keyDown(window, { key: ",", code: "Comma", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "设置" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.body.contains(workbench)).toBe(true);
    const background = workbench.closest("[inert]");
    expect(background?.getAttribute("aria-hidden")).toBe("true");
    fireEvent.keyDown(window, { key: ",", code: "Comma", ctrlKey: true });
    expect(screen.getAllByRole("dialog", { name: "设置" })).toHaveLength(1);
  });

  it("设置齿轮沉在任务列底部，关闭模态后恢复同一工作台", async () => {
    render(<App />);
    const aside = screen.getByRole("complementary", { name: "选择任务" });
    const settingsButton = within(aside).getByRole("button", { name: "设置" });
    await userEvent.click(settingsButton);
    expect(screen.getByRole("dialog", { name: "设置" })).toBeTruthy();
    expect(document.activeElement).toBe(within(screen.getByRole("dialog", { name: "设置" })).getByRole("button", { name: "关闭" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "设置" })).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
    expect(document.body.contains(aside)).toBe(true);
    expect(aside.closest("[inert]")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(settingsButton));
  });

  it("无有效返回焦点时关闭设置，回退聚焦当前 Composer", async () => {
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    stubShell({ sessions: [sess({ id: "s1", title: "任务一" })] });
    render(<App />);
    const composer = await screen.findByRole("textbox", { name: "消息输入" });
    composer.blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(window, { key: ",", code: "Comma", ctrlKey: true });
    await userEvent.click(within(screen.getByRole("dialog", { name: "设置" })).getByRole("button", { name: "关闭" }));

    await waitFor(() => expect(document.activeElement).toBe(composer));
  });

  it("返回目标仍挂载但已不可聚焦时，仍回退到当前 Composer", async () => {
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    stubShell({ sessions: [sess({ id: "s1", title: "任务一" })] });
    render(<App />);
    const composer = await screen.findByRole("textbox", { name: "消息输入" });
    const settingsButton = within(screen.getByRole("complementary", { name: "选择任务" })).getByRole("button", {
      name: "设置",
    }) as HTMLButtonElement;

    await userEvent.click(settingsButton);
    settingsButton.disabled = true;
    await userEvent.click(within(screen.getByRole("dialog", { name: "设置" })).getByRole("button", { name: "关闭" }));

    await waitFor(() => expect(document.activeElement).toBe(composer));
  });
});

/* ==================== 批 A:D1/D3/D5/D8/H9 的 App 级粘合 ==================== */

const sess = (over: Partial<SessionMeta> & { id: string }): SessionMeta => ({
  title: over.id,
  workdir: "/p/a",
  model: "m",
  turns: 0,
  status: "idle",
  ...over,
});

interface Call {
  cmd: string;
  args?: Record<string, unknown>;
}

/** 桌面壳桩:支持同名事件多监听(App 与 EngineBanner 都听 engine-status)。 */
function stubShell(
  opts: {
    sessions?: SessionMeta[];
    models?: unknown[];
    intent?: string | null;
    cloudTasks?: unknown[];
    /** 让指定命令直接回 Err(壳拒了写操作:运行中不许删、磁盘只读…) */
    fail?: Record<string, string>;
  } = {},
) {
  const calls: Call[] = [];
  // 壳的「配置应用中」闸门(driver/mod.rs::DriverHost::get):**每条**经引擎的
  // 命令都会被同一道锁拒掉,不只是 session_open。此前这里只给 session_open
  // 设闸,于是「Ready 后的重拉会不会被拒」这条路从来没被测到——而实现里
  // sessionsList 把拒绝吞成空数组,退避重试成了死代码,测试却一路全绿。
  // 各命令各计各的次数,互不消耗
  const gates = new Map<string, number>();
  const gateOf = (cmd: string): Promise<never> | null => {
    const left = gates.get(cmd) ?? 0;
    if (left <= 0) return null;
    gates.set(cmd, left - 1);
    return Promise.reject(new Error("引擎配置正在应用,请稍后重试"));
  };
  const listeners = new Map<string, Set<(e: { payload: unknown }) => void>>();
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        const gated = gateOf(cmd);
        if (gated) return gated;
        const failure = opts.fail?.[cmd];
        if (failure) return Promise.reject(new Error(failure));
        if (cmd === "sessions_list") return Promise.resolve(opts.sessions ?? []);
        if (cmd === "models_list") return Promise.resolve(opts.models ?? [{ name: "m", default: true }]);
        if (cmd === "todos_load") return Promise.resolve([]); // 侧栏待办组挂载即消费,回 null 会被判契约漂移
        if (cmd === "take_ui_intent") return Promise.resolve(opts.intent ?? null);
        if (cmd === "engine_status") return Promise.resolve({ phase: "ready", version: "1" });
        if (cmd === "session_open") return Promise.resolve({ frames: [], cursor: 0, has_more: false });
        if (cmd === "host_info") return Promise.resolve({ version: "1", engine_version: "1" });
        if (cmd === "sound_enabled") return Promise.resolve(true);
        if (cmd === "get_config") return Promise.resolve({ models: [], mcp_servers: {} });
        if (cmd === "mc_status") return Promise.resolve({ logged_in: true, host: "h", user: { id: "u" } });
        if (cmd === "mc_projects") return Promise.resolve({ projects: [] });
        if (cmd === "mc_tasks")
          return Promise.resolve({ tasks: opts.cloudTasks ?? [], page_info: { total: (opts.cloudTasks ?? []).length } });
        if (cmd === "mc_task_info") {
          const task = (opts.cloudTasks ?? []).find((x) => (x as { id?: string }).id === args?.id) as
            | Record<string, unknown>
            | undefined;
          return Promise.resolve(task ?? { id: args?.id, status: "pending" });
        }
        if (cmd === "mc_task_rounds") return Promise.resolve({ frames: [] });
        if (cmd === "mc_task_user_inputs") return Promise.resolve({ items: [] });
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
    /** 让随后 n 次指定命令撞闸门被拒(缺省:重启后必发的那两条) */
    armGate: (n: number, cmds: string[] = ["session_open", "sessions_list"]) => {
      for (const cmd of cmds) gates.set(cmd, n);
    },
    count: (cmd: string) => calls.filter((c) => c.cmd === cmd).length,
    emit: (name: string, payload: unknown) => listeners.get(name)?.forEach((cb) => cb({ payload })),
  };
}

/** 侧栏行(菜单/属性都挂在 button 上;同名文字在主区头部也有一份,取侧栏那份)。 */
const rowOf = (text: string) =>
  screen.getAllByText(text).map((el) => el.closest("button")).find(Boolean) as HTMLElement;

/** 行右键后取命令式菜单(backdrop + menu 追加在 body 末尾)。 */
const contextMenuOf = (el: HTMLElement): HTMLElement => {
  fireEvent.contextMenu(el);
  return document.body.lastElementChild as HTMLElement;
};

describe("D1 引擎重启自愈", () => {
  it("引擎曾不可用后转 ready:重拉会话列表并幂等重开当前会话", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    localStorage.setItem("mc.sidebarSpace", "local");
    const shell = stubShell({ sessions: [sess({ id: "s1", title: "任务一" })] });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(1));
    const listBefore = shell.count("sessions_list");

    act(() => shell.emit("engine-status", { phase: "crashed", detail: "x", log_tail: "", attempt: 1, retry_in_ms: 1000 }));
    act(() => shell.emit("engine-status", { phase: "ready", version: "1" }));
    await waitFor(() => expect(shell.count("session_open")).toBe(2)); // epoch 信号驱动重开
    expect(shell.count("sessions_list")).toBeGreaterThan(listBefore);
  });

  // 模型清单挂在 composer 自己的挂载期 effect 上(deps 是 []),epoch 只驱动
  // 数据面重连、碰不到它。保存设置那条路碰巧自愈(SettingsView 把 ChatView
  // 整个卸掉了),崩溃自愈与浏览器扩展配对却不会——模型菜单一直停在旧引擎
  // 那份,直到用户手动切一次会话。旧 UI 是在重连路径里直接重拉 models
  it("引擎自愈后模型清单重新拉取(不必等用户切会话)", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    localStorage.setItem("mc.sidebarSpace", "local");
    const shell = stubShell({ sessions: [sess({ id: "s1", title: "任务一" })] });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(1));
    const before = shell.count("models_list");

    act(() => shell.emit("engine-status", { phase: "crashed", detail: "x", log_tail: "", attempt: 1, retry_in_ms: 1000 }));
    act(() => shell.emit("engine-status", { phase: "ready", version: "2" }));
    await waitFor(() => expect(shell.count("models_list")).toBeGreaterThan(before));
  });

  it("一直 ready(没掉过)不空转:不重拉不重开", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    const shell = stubShell({ sessions: [sess({ id: "s1" })] });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(1));
    const listBefore = shell.count("sessions_list");
    act(() => shell.emit("engine-status", { phase: "ready", version: "1" }));
    await act(() => Promise.resolve());
    expect(shell.count("session_open")).toBe(1);
    expect(shell.count("sessions_list")).toBe(listBefore);
  });
});

describe("D3 后台会话提醒", () => {
  it("屏外会话等待审批:出可点击提示,点击装进空格(place 路由,人不离开工作台)", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    const shell = stubShell({
      sessions: [sess({ id: "s1", title: "任务一" }), sess({ id: "c1", title: "闲聊会话", kind: "chat" })],
    });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(1));

    act(() => shell.emit("session-event", { type: "session-ask", id: "c1", title: "闲聊会话", open: true }));
    const notice = await screen.findByText("「闲聊会话」等待审批");
    await userEvent.click(notice);
    await waitFor(() =>
      expect(shell.calls.some((c) => c.cmd === "session_open" && c.args?.id === "c1")).toBe(true),
    );
    expect(screen.getByRole("complementary", { name: "选择任务" })).toBeTruthy(); // 没切走
    expect(screen.queryByText("「闲聊会话」等待审批")).toBeNull(); // 装载即消
  });

  it("终态提醒可关闭,不跳转;当前会话的事件不提醒", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    const shell = stubShell({ sessions: [sess({ id: "s1", title: "任务一" }), sess({ id: "s2", title: "后台任务" })] });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(1));

    // 当前会话的事件:不出提示
    act(() => shell.emit("session-event", { type: "session-status", id: "s1", title: "任务一", status: "idle" }));
    await act(() => Promise.resolve());
    expect(screen.queryByText("「任务一」已回复")).toBeNull();

    act(() => shell.emit("session-event", { type: "session-status", id: "s2", title: "后台任务", status: "error" }));
    expect(await screen.findByText("「后台任务」出错了")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "关闭提醒" }));
    expect(screen.queryByText("「后台任务」出错了")).toBeNull();
    // 没跳转:当前会话还是 s1
    expect(shell.calls.some((c) => c.cmd === "session_open" && c.args?.id === "s2")).toBe(false);
  });
});

describe("D5 首启向导", () => {
  it("桌面壳模型清单为空:自动打开设置页;关闭后不再纠缠", async () => {
    const shell = stubShell({ models: [] });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "设置" })).toBeTruthy();
    const opens = shell.count("models_list");
    await userEvent.click(within(screen.getByRole("dialog", { name: "设置" })).getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("complementary", { name: "选择任务" })).toBeTruthy();
    await act(() => Promise.resolve());
    // 不循环:关闭后不再自动弹回,也不反复探测
    expect(screen.queryByRole("heading", { name: "设置" })).toBeNull();
    expect(shell.count("models_list")).toBe(opens);
  });

  it("已有模型:不自动打开设置页", async () => {
    stubShell({ models: [{ name: "m", default: true }] });
    render(<App />);
    await act(() => Promise.resolve());
    expect(screen.queryByRole("heading", { name: "设置" })).toBeNull();
  });
});

describe("D8 列表增量与意图跳转", () => {
  it("session-event 携未知 id:重拉全表", async () => {
    const shell = stubShell({ sessions: [sess({ id: "s1" })] });
    render(<App />);
    await waitFor(() => expect(shell.count("sessions_list")).toBeGreaterThanOrEqual(1));
    const before = shell.count("sessions_list");
    act(() => shell.emit("session-event", { type: "session-status", id: "ghost", title: "新会话", status: "running" }));
    await waitFor(() => expect(shell.count("sessions_list")).toBe(before + 1));
  });

  it("壳意图指向本地快照没有的会话:先重拉再装载入格", async () => {
    const shell = stubShell({
      sessions: [sess({ id: "s1" }), sess({ id: "c1", title: "闲聊会话", kind: "chat" })],
      intent: "open-session:c1",
    });
    render(<App />);
    await waitFor(() =>
      expect(shell.calls.some((c) => c.cmd === "session_open" && c.args?.id === "c1")).toBe(true),
    );
    // 装进了格(槽位落盘含 c1)
    expect(JSON.parse(localStorage.getItem("mc.splitSlots") ?? "[]")).toContain("c1");
  });
});

describe("H9 意图消费", () => {
  it("open-session / open-settings 事件送达即消费壳侧意图副本", async () => {
    const shell = stubShell({ sessions: [sess({ id: "s1" })] });
    render(<App />);
    await waitFor(() => expect(shell.count("take_ui_intent")).toBe(1)); // 启动补取

    act(() => shell.emit("open-session", "s1"));
    await waitFor(() => expect(shell.count("take_ui_intent")).toBe(2));

    act(() => shell.emit("open-settings", undefined));
    await waitFor(() => expect(shell.count("take_ui_intent")).toBe(3));
  });
});

describe("壳级提示(浏览器工具装载)", () => {
  it("browser-mcp-reloaded 出成功提示并自动消失;超时事件是警示且留到手动关闭", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const shell = stubShell();
      render(<App />);

      act(() => shell.emit("browser-mcp-reloaded", undefined));
      expect(await screen.findByText("浏览器工具已装载,引擎已按新配置重连")).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(6100);
      });
      expect(screen.queryByText("浏览器工具已装载,引擎已按新配置重连")).toBeNull();

      act(() => shell.emit("browser-mcp-refresh-timeout", undefined));
      const warn = await screen.findByText(/浏览器工具尚未装载/);
      await act(async () => {
        vi.advanceTimersByTime(20_000);
      });
      expect(screen.getByText(/浏览器工具尚未装载/)).toBe(warn); // 警示不自灭
    } finally {
      vi.useRealTimers();
    }
  });

  it("同一条重复推送只留最新一份,不叠成两条", async () => {
    const shell = stubShell();
    render(<App />);
    act(() => shell.emit("browser-mcp-refresh-timeout", undefined));
    act(() => shell.emit("browser-mcp-refresh-timeout", undefined));
    expect((await screen.findAllByText(/浏览器工具尚未装载/)).length).toBe(1);
  });
});

describe("覆盖视图让位(设置/新建盖着时,装载动作掀开覆盖回工作台)", () => {
  it("设置页开着:点任务列行装载 → 设置关、格挂上、输入框聚焦", async () => {
    const shell = stubShell({ sessions: [sess({ id: "s1", title: "任务一" })] });
    render(<App />);
    await waitFor(() => expect(shell.count("sessions_list")).toBeGreaterThanOrEqual(1));
    await userEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
    // 覆盖视图盖着时任务列不在场,装载走 toast/意图同一条 loadEntry:
    // 用屏外提醒模拟(设置盖着 → 可见集为空 → 一律提醒)
    act(() => shell.emit("session-event", { type: "session-ask", id: "s1", title: "任务一", open: true }));
    await userEvent.click(await screen.findByText("「任务一」等待审批"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "设置" })).toBeNull());
    expect(screen.getByRole("complementary", { name: "选择任务" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "消息输入" })));
  });
});

describe("MonkeyCode transport 切换", () => {
  it("壳事件立即重拉云任务 feed(换服务/登出后旧列表作废)", async () => {
    const shell = stubShell({ cloudTasks: [{ id: "ct1", title: "旧服务任务", status: "processing" }] });
    render(<App />);
    // 云端 tab 由同一份 feed 供数;transport 事件 → reloadKey 翻转 → 重拉
    await userEvent.click(screen.getByRole("tab", { name: "云端" }));
    expect(await screen.findByText("旧服务任务")).toBeTruthy();
    const before = shell.count("mc_tasks");
    act(() => shell.emit("monkeycode-transport-changed", 1));
    await waitFor(() => expect(shell.count("mc_tasks")).toBeGreaterThan(before));
  });

  it("推进 generation、刷新账号状态并清掉旧服务持久化云槽", async () => {
    localStorage.setItem("mc.splitTree", JSON.stringify({ leaf: 0 }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["c:ct1", null, null, null, null, null]));
    const shell = stubShell({ cloudTasks: [{ id: "ct1", title: "旧账号任务", status: "pending" }] });
    render(<App />);
    await waitFor(() => expect(shell.count("mc_task_info")).toBeGreaterThanOrEqual(1));

    await userEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeTruthy();
    await waitFor(() => expect(shell.count("mc_status")).toBeGreaterThanOrEqual(1));
    const statusBefore = shell.count("mc_status");

    act(() => shell.emit("monkeycode-transport-changed", 7));
    await waitFor(() => expect(shell.count("mc_status")).toBeGreaterThan(statusBefore));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("mc.splitSlots") ?? "[]")[0]).toBeNull());
  });
});

describe("引擎重启后的重开要撞得过壳的 apply 闸门", () => {
  // 壳 restart_engine_locked 在 adopt_engine 里就发 Ready,而调用方(保存设置 /
  // 浏览器配对刷新)仍持着 EngineApply 锁——UI 一收到 Ready 就发的命令必然
  // 落在这段窗口里被拒。不退避重试的话,浏览器配对后这次重开静默失败,对话
  // 继续挂在旧引擎上、拿不到 browser MCP 工具集(2026-08-07 用户报障)
  it("Ready 后首发 session_open 被闸门拒:退避重试直到成功", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    localStorage.setItem("mc.sidebarSpace", "local");
    const shell = stubShell({ sessions: [sess({ id: "s1", title: "任务一" })] });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(1));

    shell.armGate(2); // 前两发拒,第三发放行
    act(() => shell.emit("engine-status", { phase: "starting", attempt: 0 }));
    act(() => shell.emit("engine-status", { phase: "ready", version: "2" }));
    // 1(首挂)+ 3(重开:拒/拒/成)
    await waitFor(() => expect(shell.count("session_open")).toBe(4), { timeout: 3000 });
  });
});

describe("会话列表拉取失败不能清空侧栏", () => {
  // 壳在 apply 闸门期间对 sessions_list 回的是 Err「引擎配置正在应用,请稍后
  // 重试」,而 adopt_engine 在闸门内就 emit 了 Ready ——这一拉必然撞上。此前
  // sessionsList 把拒绝吞成 [],于是:退避重试永远等不到拒绝(死代码),而
  // 空列表被下游读成「会话都没了」——侧栏清空、current 变 null、开着的对话
  // 卸载回欢迎页,还得等下一条 session-event 才可能恢复
  it("Ready 后的重拉撞闸门:退避重试补上,列表全程不空、对话不掉线", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    localStorage.setItem("mc.sidebarSpace", "local");
    const shell = stubShell({ sessions: [sess({ id: "s1", title: "任务一" })] });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(1));
    const before = shell.count("sessions_list");

    shell.armGate(1, ["sessions_list"]); // 下一发 sessions_list 被闸门拒
    act(() => shell.emit("engine-status", { phase: "crashed", detail: "x", log_tail: "", attempt: 1, retry_in_ms: 1000 }));
    act(() => shell.emit("engine-status", { phase: "ready", version: "2" }));

    // 拒 1 次 + 重试成功 1 次 = 两发(吞错的实现只会有一发)
    await waitFor(() => expect(shell.count("sessions_list")).toBe(before + 2), { timeout: 3000 });
    expect(rowOf("任务一")).toBeTruthy(); // 侧栏没被空结果洗掉
    expect(screen.queryByText("开始一个任务")).toBeNull(); // 主区没退回欢迎页
  });

  it("models_list 失败 ≠ 没配模型:不弹首启向导", async () => {
    stubShell({ fail: { models_list: "引擎配置正在应用,请稍后重试" } });
    render(<App />);
    await act(() => Promise.resolve());
    await act(() => Promise.resolve());
    expect(screen.queryByRole("heading", { name: "设置" })).toBeNull();
  });
});

describe("本地持久队列的 App 级接线", () => {
  it("后台 session-status 严格逐轮：一个轮末事件只投一个队首", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    localStorage.setItem("mc.sidebarSpace", "local");
    const target = localSendQueueTarget("s2");
    updateSendQueueLane(target, (lane) => enqueue(lane, createSendQueueItem("第一条", [])));
    updateSendQueueLane(target, (lane) => enqueue(lane, createSendQueueItem("第二条", [])));
    const shell = stubShell({
      sessions: [sess({ id: "s1", title: "当前任务" }), sess({ id: "s2", title: "后台任务" })],
    });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(1));

    act(() => shell.emit("session-event", { type: "session-status", id: "s2", status: "idle" }));
    await waitFor(() => expect(shell.count("session_send")).toBe(1));
    act(() => shell.emit("session-event", { type: "session-status", id: "s2", status: "idle" }));
    await act(() => Promise.resolve());
    expect(shell.count("session_send")).toBe(1);

    act(() => shell.emit("session-event", { type: "session-status", id: "s2", status: "running" }));
    act(() => shell.emit("session-event", { type: "session-status", id: "s2", status: "idle" }));
    await waitFor(() => expect(shell.count("session_send")).toBe(2));
  });

  it("会话删除成功清持久 lane", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    localStorage.setItem("mc.sidebarSpace", "local");
    const target = localSendQueueTarget("s1");
    updateSendQueueLane(target, (lane) => enqueue(lane, createSendQueueItem("删除时清理", [])));
    const shell = stubShell({ sessions: [sess({ id: "s1", title: "任务一" })] });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(1));

    const menu = contextMenuOf(rowOf("任务一"));
    await userEvent.click(within(menu).getByText("删除"));
    await userEvent.click(within(menu).getByText(/确认删除/));
    await waitFor(() => expect(shell.count("session_delete")).toBe(1));
    await waitFor(() => expect(localStorage.getItem(localSendQueueKey("s1"))).toBeNull());
    expect(readSendQueueLane(target).pending).toEqual([]);
  });
});

describe("会话操作失败必须外显(壳拒了就别装作成功)", () => {
  it("删除被拒:给出原因,且不撤选中、不重拉(旧 UI 同款:notify 后 return)", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    localStorage.setItem("mc.sidebarSpace", "local");
    const target = localSendQueueTarget("s1");
    updateSendQueueLane(target, (lane) => enqueue(lane, createSendQueueItem("失败时保留", [])));
    const shell = stubShell({
      sessions: [sess({ id: "s1", title: "任务一" })],
      fail: { session_delete: "会话正在运行,请先停止" },
    });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(1));
    const listBefore = shell.count("sessions_list");

    const menu = contextMenuOf(rowOf("任务一"));
    await userEvent.click(within(menu).getByText("删除"));
    await userEvent.click(within(menu).getByText(/确认删除/));

    expect(await screen.findByText("删除失败:会话正在运行,请先停止")).toBeTruthy();
    // 没有装作成功:会话还在、当前会话没被撤掉,也没有多余的一次重拉
    expect(rowOf("任务一")).toBeTruthy();
    expect(screen.queryByText("开始一个任务")).toBeNull();
    expect(shell.count("sessions_list")).toBe(listBefore);
    const retained = readSendQueueLane(target);
    expect([retained.inFlight?.item.content, ...retained.pending.map((item) => item.content)]).toContain("失败时保留");
    expect(localStorage.getItem(localSendQueueKey("s1"))).not.toBeNull();
  });

  it("归档 / 重命名被拒:各自给出原因", async () => {
    const shell = stubShell({
      sessions: [sess({ id: "s1", title: "任务一" })],
      fail: { session_patch: "磁盘只读" },
    });
    render(<App />);
    await waitFor(() => expect(shell.count("sessions_list")).toBeGreaterThanOrEqual(1));

    let menu = contextMenuOf(rowOf("任务一"));
    await userEvent.click(within(menu).getByText("归档"));
    expect(await screen.findByText("归档失败:磁盘只读")).toBeTruthy();

    menu = contextMenuOf(rowOf("任务一"));
    await userEvent.click(within(menu).getByText("重命名"));
    const input = await screen.findByRole("textbox", { name: "重命名" });
    await userEvent.clear(input);
    await userEvent.type(input, "新名字{Enter}");
    expect(await screen.findByText("重命名失败:磁盘只读")).toBeTruthy();
  });
});

describe("提醒的生命周期与失效跳转", () => {
  // LAYOUT §1 把后台提醒归在「角落瞬态」。此前 SessionNotice 只增不减(唯一
  // 一个定时器被 `if (kind !== "info") return` 挡在壳级提示那条路上),三个
  // 后台任务 = 三条永久钉在主区右上角的横幅
  it("后台提醒到点自动消退;侧栏 attention 不跟着走(未读是持久状态)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      localStorage.setItem("mc.lastSession", "s1");
      localStorage.setItem("mc.sidebarSpace", "local");
      const shell = stubShell({
        sessions: [sess({ id: "s1", title: "任务一" }), sess({ id: "s2", title: "后台任务" })],
      });
      render(<App />);
      await waitFor(() => expect(shell.count("session_open")).toBe(1));

      act(() => shell.emit("session-event", { type: "session-status", id: "s2", title: "后台任务", status: "idle" }));
      expect(await screen.findByText("「后台任务」已回复")).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(8100);
      });
      expect(screen.queryByText("「后台任务」已回复")).toBeNull();
      expect(rowOf("后台任务").dataset.attention).toBeDefined(); // 未读留着,打开才算读过
    } finally {
      vi.useRealTimers();
    }
  });

  // 多格在场口径(2026-08-20 用户「一轮结束/审批/提问得让人知道」):
  // 「可见 = 在场」只对焦点格成立——此前非焦点格的这些事件被整个静默,
  // 一轮结束了没有任何信号
  it("可见非焦点格轮结束:不弹 toast,格头亮未读警示;落焦即消", async () => {
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    localStorage.setItem("mc.sidebarSpace", "local");
    const shell = stubShell({
      sessions: [sess({ id: "s1", title: "任务一" }), sess({ id: "s2", title: "后台任务" })],
    });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(2));

    act(() => shell.emit("session-event", { type: "session-status", id: "s2", title: "后台任务", status: "idle" }));
    const pane2 = screen.getByRole("region", { name: "第 2 格" });
    await waitFor(() => expect(pane2.querySelector("[data-attention]")).not.toBeNull()); // 格头警示条
    expect(screen.queryByText("「后台任务」已回复")).toBeNull(); // 格就在眼前,不弹 toast
    expect(within(pane2).getByRole("img", { name: "有未读更新" })).toBeTruthy(); // 状态点走 attention 语义
    expect(rowOf("后台任务").dataset.attention).toBeDefined(); // 任务列行同源高亮

    fireEvent.pointerDown(pane2); // 落焦即已读
    await waitFor(() => expect(pane2.querySelector("[data-attention]")).toBeNull());
    expect(rowOf("后台任务").dataset.attention).toBeUndefined();
  });

  // 引擎崩溃时壳对每个顶层会话发 interrupted(driver/session.rs 的
  // reconcile-all)。此前 notices.ts 漏了这一档,于是"跑着的后台任务全被打断"
  // 在界面上一声不吭:行是静默态(无点),提醒也没有
  it("interrupted 出警示提醒(引擎崩溃时后台任务的唯一信号)", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    const shell = stubShell({
      sessions: [sess({ id: "s1", title: "任务一" }), sess({ id: "s2", title: "后台任务" })],
    });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(1));

    act(() =>
      shell.emit("session-event", { type: "session-status", id: "s2", title: "后台任务", status: "interrupted" }),
    );
    const alert = await screen.findByText("「后台任务」已中断");
    expect(alert.closest(".alert")?.className).toContain("alert-warning");
  });

  it("点击指向已删会话的提醒:给出解释,而不是把用户扔进空白主区", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    localStorage.setItem("mc.sidebarSpace", "local");
    const shell = stubShell({ sessions: [sess({ id: "s1", title: "任务一" })] });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(1));

    // 事件带来一个壳里也已经不存在的 id(提醒发出后会话被删)
    act(() => shell.emit("session-event", { type: "session-ask", id: "ghost", title: "幽灵任务", open: true }));
    await userEvent.click(await screen.findByText("「幽灵任务」等待审批"));

    expect(await screen.findByText("无法打开:对应的任务或会话可能已被删除")).toBeTruthy();
    expect(screen.queryByText("「幽灵任务」等待审批")).toBeNull(); // 过期提醒点完即消
    expect(screen.queryByText("开始一个任务")).toBeNull(); // 当前会话没被顶掉
    expect(shell.calls.some((c) => c.cmd === "session_open" && c.args?.id === "ghost")).toBe(false);
  });
});

describe("任务列排序跟得上后台活动", () => {
  // 项目组按「组内最近 updated_at」排(util/projects.groupSessions),而
  // 增量补丁此前只改状态不动时间戳。壳侧契约:session-status 恒紧跟一次
  // 刷新 updated_at 的 write_sidecar;session-ask/summary 走 keep_updated
  // (「临时会话」哨兵组头也带 aria-expanded 且默认居首,活跃度排序只看
  // 项目组,滤掉它)
  const groups = () =>
    [...document.querySelectorAll('aside button[aria-expanded]')]
      .map((el) => el.textContent ?? "")
      .filter((tx) => !tx.includes("临时会话"));

  it("后台任务有进展:所在项目组浮到列表顶,且不为此重拉全表", async () => {
    const shell = stubShell({
      sessions: [
        sess({ id: "新的", workdir: "/p/alpha", updated_at: "2026-08-08T00:00:00Z" }),
        sess({ id: "旧的", workdir: "/p/beta", updated_at: "2026-08-01T00:00:00Z" }),
      ],
    });
    render(<App />);
    await waitFor(() => expect(groups()[0]).toContain("alpha"));
    const listBefore = shell.count("sessions_list");

    // idle 也是 session-status(时间戳照壳侧契约刷新);running 会进
    // 「运行中」置顶区,组头浮顶的观察窗口用 idle 这一档
    act(() => shell.emit("session-event", { type: "session-status", id: "旧的", title: "旧的", status: "idle" }));
    await waitFor(() => expect(groups()[0]).toContain("beta"));
    expect(shell.count("sessions_list")).toBe(listBefore); // 就地补丁,没有重拉风暴
  });

  it("已归档任务重新发言:状态事件将其立即移回活跃列表,且不重拉全表", async () => {
    const shell = stubShell({ sessions: [sess({ id: "归档任务", archived: true })] });
    render(<App />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    await waitFor(() => expect(shell.count("sessions_list")).toBeGreaterThanOrEqual(1));
    expect(within(list).queryByText("归档任务")).toBeNull();
    const listBefore = shell.count("sessions_list");

    act(() =>
      shell.emit("session-event", {
        type: "session-status",
        id: "归档任务",
        title: "归档任务",
        status: "running",
        archived: false,
      }),
    );

    expect(await within(list).findByText("归档任务")).toBeTruthy();
    expect(shell.count("sessions_list")).toBe(listBefore);
  });

  it("session-ask / session-summary 不动时间戳(壳侧走的是 keep_updated 那条)", async () => {
    const shell = stubShell({
      sessions: [
        sess({ id: "新的", workdir: "/p/alpha", updated_at: "2026-08-08T00:00:00Z" }),
        sess({ id: "旧的", workdir: "/p/beta", updated_at: "2026-08-01T00:00:00Z" }),
      ],
    });
    render(<App />);
    await waitFor(() => expect(groups()[0]).toContain("alpha"));

    act(() => shell.emit("session-event", { type: "session-ask", id: "旧的", title: "旧的", open: true }));
    await waitFor(() => expect(shell.count("sessions_list")).toBeGreaterThanOrEqual(1));
    expect(groups()[0]).toContain("alpha");
  });
});

describe("新建入口", () => {
  it("云端 tab 时列顶「新建任务」:格内创建表单预选云端页签(整页新建 2026-08-18 退役,创建即新格)", async () => {
    stubShell();
    render(<App />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    await userEvent.click(within(list).getByRole("tab", { name: "云端" }));
    await userEvent.click(within(list).getByRole("button", { name: "新建任务" }));
    const heading = await screen.findByRole("heading", { name: "新建任务" });
    const pane = heading.closest("section") as HTMLElement;
    expect(pane).not.toBeNull(); // 表单住在格里,不是整页覆盖
    expect(within(pane).getByRole("tab", { name: "云端任务" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("点格与任务列联动(2026-08-19)", () => {
  it("云端删除失败时 App 保留 runtime lane 与用户队列", async () => {
    const target = cloudSendQueueTarget("h|u", "ct-delete");
    writeSendQueueLane(target, enqueue(readSendQueueLane(target), createSendQueueItem("稍后发送", [])));
    stubShell({
      cloudTasks: [{ id: "ct-delete", title: "待删云端任务", status: "processing" }],
      fail: { mc_task_delete: "仍有资源占用" },
    });
    render(<App />);
    await userEvent.click(screen.getByRole("tab", { name: "云端" }));
    const row = (await screen.findByText("待删云端任务")).closest("button") as HTMLElement;
    fireEvent.contextMenu(row);
    const menu = document.body.lastElementChild as HTMLElement;
    await userEvent.click(within(menu).getByText("删除任务"));
    await userEvent.click(within(menu).getByText("确认删除"));
    await waitFor(() => expect(readSendQueueLane(target).pending).toHaveLength(1));
  });

  it("云端删除成功后 App 统一 dropTask 清 lane/index 并弹出工作台格", async () => {
    const target = cloudSendQueueTarget("h|u", "ct-delete-ok");
    writeSendQueueLane(target, enqueue(readSendQueueLane(target), createSendQueueItem("稍后发送", [])));
    stubShell({ cloudTasks: [{ id: "ct-delete-ok", title: "可删云端任务", status: "processing" }] });
    render(<App />);
    await userEvent.click(screen.getByRole("tab", { name: "云端" }));
    const row = (await screen.findByText("可删云端任务")).closest("button") as HTMLElement;
    fireEvent.contextMenu(row);
    const menu = document.body.lastElementChild as HTMLElement;
    await userEvent.click(within(menu).getByText("删除任务"));
    await userEvent.click(within(menu).getByText("确认删除"));
    await waitFor(() => expect(readSendQueueLane(target).pending).toHaveLength(0));
    expect(screen.getByRole("region", { name: "第 1 格" })).toBeTruthy();
  });

  it("云端 tab 下点本地格:tab 切回「本地」", async () => {
    stubShell({ sessions: [sess({ id: "s1", title: "任务一" })] });
    render(<App />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    await userEvent.click(await within(list).findByText("任务一"));
    await userEvent.click(within(list).getByRole("tab", { name: "云端" }));
    expect(within(list).getByRole("tab", { name: "云端" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(within(screen.getByRole("region", { name: "第 1 格" })).getByTitle(/任务一/));
    await waitFor(() => expect(within(list).getByRole("tab", { name: "本地" }).getAttribute("aria-selected")).toBe("true"));
  });

  it("点格切焦点 → composer 自动得焦(2026-08-20)", async () => {
    const shell = stubShell({ sessions: [sess({ id: "s1", title: "任务一" }), sess({ id: "s2", title: "任务二" })] });
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    render(<App />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    await userEvent.click(await within(list).findByText("任务一"));
    await userEvent.click(within(list).getByText("任务二"));
    void shell;
    const pane1 = screen.getByRole("region", { name: "第 1 格" });
    const title = within(pane1).getByTitle(/任务一/);
    fireEvent.pointerDown(title);
    // 模拟桌面 WebView 在 pointerdown 的 React effect 之后执行默认失焦；
    // 只发 pointerdown 会掩盖「effect 聚焦后又被 blur」的真机问题。
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(title);
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(document.activeElement).toBe(within(pane1).getByRole("textbox", { name: "消息输入" }));
  });

  it("云端任务行可拖(LOAD_MIME 装载协议,与本地行同款)", async () => {
    stubShell({ cloudTasks: [{ id: "ct1", title: "云端任务一", status: "processing" }] });
    render(<App />);
    await userEvent.click(screen.getByRole("tab", { name: "云端" }));
    const row = (await screen.findByText("云端任务一")).closest("button")!;
    expect(row.getAttribute("draggable")).toBe("true");
  });
});

describe("格细头改名(旧单会话头能力回归 2026-08-19)", () => {
  it("本地格 ⋯ 含 归档/删除(与云端格对称,旧详情页三件套齐了 2026-08-20)", async () => {
    stubShell({ sessions: [sess({ id: "s1", title: "任务一" })] });
    render(<App />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    await userEvent.click(await within(list).findByText("任务一"));
    const pane = screen.getByRole("region", { name: "第 1 格" });
    await userEvent.click(within(pane).getByRole("button", { name: "格操作" }));
    const menu = document.body.lastElementChild as HTMLElement;
    expect(within(menu).getByText("重命名")).toBeTruthy();
    expect(within(menu).getByText("归档")).toBeTruthy();
    expect(within(menu).getByText("删除")).toBeTruthy();
  });

  it("双击格标题 → 行内输入,Enter 走 session_patch", async () => {
    const shell = stubShell({ sessions: [sess({ id: "s1", title: "老名字" })] });
    render(<App />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    await userEvent.click(await within(list).findByText("老名字"));
    const pane = screen.getByRole("region", { name: "第 1 格" });
    fireEvent.doubleClick(within(pane).getByTitle(/老名字/));
    const input = within(pane).getByRole("textbox", { name: "重命名" });
    fireEvent.change(input, { target: { value: "新名字" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(shell.count("session_patch")).toBe(1));
  });
});

describe("工作台常驻壳(2026-08-18 升级为主界面)", () => {
  it("mc.lastSession(旧壳契约键)播种首叶:升级不丢「上次看的那个」", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    const shell = stubShell({ sessions: [sess({ id: "s1", title: "任务一" }), sess({ id: "s2", title: "任务二" })] });
    render(<App />);
    // 首叶装载 s1(session_open 自然发生);另一格是轻提示/装载卡
    await waitFor(() => expect(shell.calls.some((c) => c.cmd === "session_open" && c.args?.id === "s1")).toBe(true));
    expect(JSON.parse(localStorage.getItem("mc.splitSlots") ?? "[]")[0]).toBe("s1");
  });

  it("提醒口径:格内会话抑制,屏外照发且点击装格", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    const shell = stubShell({ sessions: [sess({ id: "s1", title: "任务一" }), sess({ id: "s2", title: "任务二" })] });
    render(<App />);
    await waitFor(() => expect(shell.count("session_open")).toBe(1));

    // 格内会话(首叶的 s1)就在眼前:等待审批不再出角落 toast
    act(() => shell.emit("session-event", { type: "session-ask", id: "s1", title: "任务一", open: true }));
    await act(() => Promise.resolve());
    expect(screen.queryByText("「任务一」等待审批")).toBeNull();

    // 屏外会话照常提醒;点击 = 装进第一个空格,人留在工作台
    act(() => shell.emit("session-event", { type: "session-ask", id: "s2", title: "任务二", open: true }));
    await userEvent.click(await screen.findByText("「任务二」等待审批"));
    await waitFor(() =>
      expect(shell.calls.some((c) => c.cmd === "session_open" && c.args?.id === "s2")).toBe(true),
    );
    expect(screen.getByRole("complementary", { name: "选择任务" })).toBeTruthy();
    expect(screen.queryByText("「任务二」等待审批")).toBeNull(); // 装载即已读
  });

  it("云端任务列出在云端 tab,行可见(feed 与格内视图同一份数据)", async () => {
    stubShell({ cloudTasks: [{ id: "ct1", title: "云端任务一", status: "processing" }] });
    render(<App />);
    await userEvent.click(screen.getByRole("tab", { name: "云端" }));
    expect(await screen.findByText("云端任务一")).toBeTruthy();
  });

  it("云端格头动作走通用插槽与唯一 ⋯(2026-08-19「panel 都是通用的」+「怎么还有两个」):文件钮入细头,任务操作并入格操作菜单", async () => {
    stubShell({ cloudTasks: [{ id: "ct1", title: "云端任务一", status: "processing" }] });
    render(<App />);
    await userEvent.click(screen.getByRole("tab", { name: "云端" }));
    await userEvent.click(await screen.findByText("云端任务一"));
    const pane = screen.getByRole("region", { name: "第 1 格" });
    // portal 时序:插槽落点先挂、视图随后注入
    await waitFor(() => expect(within(pane).getByRole("button", { name: "云端文件" })).toBeTruthy());
    // 双 ⋯ 沙雕修正:格里没有第二颗菜单钮,任务操作项并入「格操作」
    expect(within(pane).queryByRole("button", { name: "任务操作" })).toBeNull();
    await userEvent.click(within(pane).getByRole("button", { name: "格操作" }));
    const menu = document.body.lastElementChild as HTMLElement;
    expect(within(menu).getByText("删除任务")).toBeTruthy();
    expect(within(menu).getByText("右分屏")).toBeTruthy();
  });
});
