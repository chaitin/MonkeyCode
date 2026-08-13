import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionMeta } from "@/lib/ipc/sessions";
import { App } from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("壳骨架(P1)", () => {
  it("三栏齐全:空间导航 / 会话列表 / 主区", () => {
    render(<App />);
    expect(screen.getByRole("navigation", { name: "空间导航" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "会话列表" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
  });

  it("浏览器模式:不渲染 Windows 标题栏与 mac 红绿灯", () => {
    render(<App />);
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

  // 曾对 Windows 开特例不留这一格,让第一个空间图标顶上去占位——尺寸恰好
  // 凑得上(size-11 + py-1 = 52px)所以没露馅,但三个图标整体比其余平台高
  // 一格,LAYOUT §2 也从没写过这条(2026-08-08 删除)
  // 角落格恒存在(与三列头部同高,基线才对得齐),里面按平台放不同东西:
  // mac 是红绿灯的家,其余平台放品牌标记——空着一整块深色方格在窗口左上角
  // 既浪费又难看(2026-08-09 用户报障)。标记**不可交互**:系统菜单是标题栏
  // 的东西,挂到侧栏图标上会变成「双击侧栏图标把应用关了」的陷阱。
  it.each([
    ["Windows NT 10.0", "Windows"],
    ["X11; Linux x86_64", "Linux"],
  ])("%s 壳:rail 角落格同高,里面是不可交互的品牌标记", (ua) => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: () => Promise.resolve(false) },
      event: { listen: () => Promise.resolve(() => {}) },
    };
    vi.stubGlobal("navigator", { ...window.navigator, userAgent: ua });
    render(<App />);
    const corner = screen.getByRole("navigation", { name: "空间导航" }).firstElementChild;
    expect(corner?.className).toContain("h-13");
    const brand = corner?.querySelector("[data-rail-brand]");
    expect(brand).not.toBeNull();
    expect(corner?.querySelector("button")).toBeNull();
    // 整格可拖窗(与 mac 的红绿灯格同待遇)
    expect(corner?.hasAttribute("data-tauri-drag-region")).toBe(true);
  });

  it("mac 壳:红绿灯在 rail 左上角(chrome 角落),无 Windows 三键", () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: () => Promise.resolve(false) },
      event: { listen: () => Promise.resolve(() => {}) },
    };
    vi.stubGlobal("navigator", { ...window.navigator, userAgent: "Macintosh; Intel Mac OS X 10_15_7" });
    render(<App />);
    const zoom = screen.getByRole("button", { name: "缩放" });
    // 骨架规范:红绿灯待在 rail 顶部的 chrome 角落(与各列 h-11 头部同基线)
    expect(screen.getByRole("navigation", { name: "空间导航" }).contains(zoom)).toBe(true);
    expect(screen.queryByRole("button", { name: "最大化" })).toBeNull();
  });
  // 启动落点恒为本地任务(用户定案 2026-08-09)。此前读 mc.sidebarSpace 恢复
  // 上次所在空间,于是只要建过一次云端任务(onCloudCreated 会 setSpace("cloud")),
  // 启动空间就被永久改成云端,直到用户手动点回来——云端可能未登录/断网,
  // 拿它当开机首屏每次都是一个坏屏幕。
  it("启动恒落本地任务:localStorage 里存着 cloud 也不恢复", () => {
    localStorage.setItem("mc.sidebarSpace", "cloud");
    render(<App />);
    expect(screen.getByRole("button", { name: "本地任务" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "云端任务" }).getAttribute("aria-pressed")).toBe("false");
    localStorage.removeItem("mc.sidebarSpace");
  });
});

describe("设置入口(外观/语言/配置在 SettingsView,各有专测)", () => {
  it("rail 齿轮打开设置页,关闭回到欢迎页", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "设置" }));
    // 设置页标志改认页头标题:初始分区已是「账号」(登录主路径),不再是通用
    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByText("开始一个任务")).toBeTruthy();
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

/** 侧栏行(菜单/属性都挂在 <a> 上;同名文字在主区头部也有一份,取侧栏那份)。 */
const rowOf = (text: string) =>
  screen.getAllByText(text).map((el) => el.closest("a")).find(Boolean) as HTMLElement;

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
  it("非当前会话等待审批:出可点击提示,点击跳转并按 kind 切空间", async () => {
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
    expect(screen.getByRole("button", { name: "本地会话" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("「闲聊会话」等待审批")).toBeNull(); // 打开即消
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

// 用户报障 2026-08-10:①「本地会话的等待审批好像没有计数提示」——徽标此前
// 硬编码只挂 local,chat 会话停在等待确认上时导轨毫无外显;②「太偏右上角了,
// 不靠近图标」——indicator-item 默认钉在 44px 命中区的角上,而图标只有 18px
// 居中,徽标于是飘在图标斜上方 13px 开外。
describe("空间导轨的等待确认徽标", () => {
  const badgeOf = (name: string) =>
    screen.getByRole("button", { name }).closest(".indicator")?.querySelector(".indicator-item") ?? null;

  it("本地任务与本地会话各自计数,云端不出", async () => {
    stubShell({
      sessions: [
        sess({ id: "s1", title: "任务一", waiting_ask: true }),
        sess({ id: "s2", title: "任务二", waiting_ask: true }),
        sess({ id: "s3", title: "任务三" }),
        sess({ id: "c1", title: "会话一", kind: "chat", waiting_ask: true }),
        sess({ id: "c2", title: "会话二", kind: "chat" }),
      ],
    });
    render(<App />);
    await waitFor(() => expect(badgeOf("本地任务")?.textContent).toBe("2"));
    expect(badgeOf("本地会话")?.textContent).toBe("1");
    expect(badgeOf("云端任务")).toBeNull();
  });

  it("锚点收进按钮内,徽标贴着图标而不是飘在命中区角上", async () => {
    stubShell({ sessions: [sess({ id: "s1", waiting_ask: true })] });
    render(<App />);
    await waitFor(() => expect(badgeOf("本地任务")).not.toBeNull());
    const cls = badgeOf("本地任务")?.className ?? "";
    expect(cls).toContain("[--indicator-e:9px]");
    expect(cls).toContain("[--indicator-t:9px]");
    // 收进来之后徽标压在按钮上,不放行点击就成了「点数字没反应」
    expect(cls).toContain("pointer-events-none");
  });
});

describe("D5 首启向导", () => {
  it("桌面壳模型清单为空:自动打开设置页;关闭后不再纠缠", async () => {
    const shell = stubShell({ models: [] });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "设置" })).toBeTruthy();
    const opens = shell.count("models_list");
    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByText("开始一个任务")).toBeTruthy();
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

  it("壳意图指向本地快照没有的会话:先重拉再选中,chat kind 切 chat 空间", async () => {
    const shell = stubShell({
      sessions: [sess({ id: "s1" }), sess({ id: "c1", title: "闲聊会话", kind: "chat" })],
      intent: "open-session:c1",
    });
    render(<App />);
    await waitFor(() =>
      expect(shell.calls.some((c) => c.cmd === "session_open" && c.args?.id === "c1")).toBe(true),
    );
    expect(screen.getByRole("button", { name: "本地会话" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("在此项目新建任务(侧栏组头 → 新建视图预填目录)", () => {
  it("点组头 + 打开新建视图,项目目录预填", async () => {
    const shell = stubShell({ sessions: [sess({ id: "s1", workdir: "/proj/alpha" })] });
    render(<App />);
    await waitFor(() => expect(shell.count("sessions_list")).toBeGreaterThanOrEqual(1));
    await userEvent.click(await screen.findByRole("button", { name: "在此项目新建任务" }));
    // 目录输入框收进「最近目录」下拉(卡头句式触发器),取值前先展开
    await userEvent.click(await screen.findByRole("button", { name: "最近目录" }));
    const dirInput = await screen.findByRole("textbox", { name: "项目目录" });
    expect((dirInput as HTMLInputElement).value).toBe("/proj/alpha");
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

describe("覆盖视图开着时点侧栏(设置/新建永远让位)", () => {
  const openSettings = () => userEvent.click(screen.getByRole("button", { name: "设置" }));
  const openCreate = async () => userEvent.click(await screen.findByRole("button", { name: "新建任务" }));

  it("本地空间:设置页/新建页开着时点任务,都切到该任务", async () => {
    stubShell({ sessions: [sess({ id: "s1", title: "任务一" })] });
    render(<App />);
    await openSettings();
    await userEvent.click(await screen.findByText("任务一"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "设置" })).toBeNull());

    await openCreate();
    await userEvent.click(await screen.findByText("任务一"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "新建任务" })).toBeNull());
  });

  // 云端 onSelect 曾只 setCloudTask、不收覆盖视图,于是设置页开着时点云端任务
  // 毫无反应(主区分支 settingsOpen/creating 优先级在前)——用户报障 2026-08-07
  it("云端空间:设置页/新建页开着时点云端任务,都切到该任务", async () => {
    stubShell({ cloudTasks: [{ id: "c1", title: "云端任务一", status: "processing" }] });
    render(<App />);
    // 启动恒落本地(见「壳骨架」那条),要测云端就点 rail 切过去——这也更贴近
    // 用户实际路径,比塞 localStorage 让 App"记得"上次在云端可靠
    await userEvent.click(screen.getByRole("button", { name: "云端任务" }));
    await openSettings();
    await userEvent.click(await screen.findByText("云端任务一"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "设置" })).toBeNull());

    await openCreate();
    await userEvent.click(await screen.findByText("云端任务一"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "新建任务" })).toBeNull());
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

describe("会话操作失败必须外显(壳拒了就别装作成功)", () => {
  it("删除被拒:给出原因,且不撤选中、不重拉(旧 UI 同款:notify 后 return)", async () => {
    localStorage.setItem("mc.lastSession", "s1");
    localStorage.setItem("mc.sidebarSpace", "local");
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

describe("侧栏排序跟得上后台活动", () => {
  // 侧栏项目组按「组内最近 updated_at」排(util/projects.groupSessions),而
  // 增量补丁此前只改状态不动时间戳,于是后台任务跑起来、它所在的项目组不会
  // 浮上去。旧 UI 是每来一条事件重拉全表,顺序自然跟着走
  it("后台任务有进展:所在项目组浮到列表顶,且不为此重拉全表", async () => {
    localStorage.setItem("mc.sidebarSpace", "local");
    const shell = stubShell({
      sessions: [
        sess({ id: "新的", workdir: "/p/alpha", updated_at: "2026-08-08T00:00:00Z" }),
        sess({ id: "旧的", workdir: "/p/beta", updated_at: "2026-08-01T00:00:00Z" }),
      ],
    });
    render(<App />);
    const groups = () =>
      [...document.querySelectorAll("aside details > summary")]
        .map((el) => el.textContent ?? "")
        .filter((s) => !s.includes("待办")); // 待办组恒定置顶(2026-08-12),项目「浮顶」语义在其后
    await waitFor(() => expect(groups()[0]).toContain("alpha"));
    const listBefore = shell.count("sessions_list");

    act(() => shell.emit("session-event", { type: "session-status", id: "旧的", title: "旧的", status: "running" }));
    await waitFor(() => expect(groups()[0]).toContain("beta"));
    expect(shell.count("sessions_list")).toBe(listBefore); // 就地补丁,没有重拉风暴
  });

  it("session-ask / session-summary 不动时间戳(壳侧走的是 keep_updated 那条)", async () => {
    localStorage.setItem("mc.sidebarSpace", "local");
    const shell = stubShell({
      sessions: [
        sess({ id: "新的", workdir: "/p/alpha", updated_at: "2026-08-08T00:00:00Z" }),
        sess({ id: "旧的", workdir: "/p/beta", updated_at: "2026-08-01T00:00:00Z" }),
      ],
    });
    render(<App />);
    const groups = () =>
      [...document.querySelectorAll("aside details > summary")]
        .map((el) => el.textContent ?? "")
        .filter((s) => !s.includes("待办")); // 待办组恒定置顶(2026-08-12),项目「浮顶」语义在其后
    await waitFor(() => expect(groups()[0]).toContain("alpha"));

    act(() => shell.emit("session-event", { type: "session-ask", id: "旧的", title: "旧的", open: true }));
    await waitFor(() => expect(shell.count("sessions_list")).toBeGreaterThanOrEqual(1));
    expect(groups()[0]).toContain("alpha");
  });
});

describe("侧栏 ＋ 的默认页签跟随当前空间", () => {
  const openCreate = async () => userEvent.click(await screen.findByRole("button", { name: "新建任务" }));
  const tabOn = (name: string) =>
    (screen.getByRole("tab", { name }) as HTMLElement).getAttribute("aria-selected") === "true";

  it("停在「本地会话」空间时点 ＋:开出来就是会话页签", async () => {
    stubShell();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "本地会话" }));
    await openCreate();
    expect(tabOn("本地会话")).toBe(true);
    expect(tabOn("本地任务")).toBe(false);
  });

  it("停在「云端任务」空间时点 ＋:开出来是云端页签", async () => {
    stubShell();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "云端任务" }));
    await openCreate();
    expect(tabOn("云端任务")).toBe(true);
  });

  it("本地空间照旧落本地任务页签", async () => {
    stubShell();
    render(<App />); // 启动恒落本地,不用再摆布 localStorage
    await openCreate();
    expect(tabOn("本地任务")).toBe(true);
  });

  it("项目组头「+」带目录:比空间更强,即便停在会话空间也落本地任务页签", async () => {
    stubShell({ sessions: [sess({ id: "s1", workdir: "/proj/alpha" })] });
    render(<App />);
    // 组头的 ＋ 只在本地空间可见,先切过去
    await userEvent.click(screen.getByRole("button", { name: "本地任务" }));
    await userEvent.click(await screen.findByRole("button", { name: "在此项目新建任务" }));
    expect(tabOn("本地任务")).toBe(true);
  });
});
