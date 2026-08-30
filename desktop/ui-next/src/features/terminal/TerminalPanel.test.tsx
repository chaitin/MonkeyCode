// 终端面板 + termStore:stub xterm(真渲染层 jsdom 撑不住),钉四类契约——
// 传输(监听先于命令/base64 双向)、**持久化**(视图离场不杀 shell,
// 2026-08-30 用户定案)、多实例、tab 名跟随前台进程/OSC。
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const openSpy = vi.fn();
const disposeSpy = vi.fn();
const writeSpy = vi.fn();
let dataHandlers: ((input: string) => void)[] = [];
let titleHandlers: ((title: string) => void)[] = [];
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    options = {};
    open = openSpy;
    loadAddon = vi.fn();
    write = writeSpy;
    focus = vi.fn();
    dispose = disposeSpy;
    onData = vi.fn((cb: (input: string) => void) => {
      dataHandlers.push(cb);
      return { dispose: vi.fn() };
    });
    onTitleChange = vi.fn((cb: (title: string) => void) => {
      titleHandlers.push(cb);
      return { dispose: vi.fn() };
    });
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

import { b64encode } from "@/lib/protocol/codec";
import { TerminalPanel } from "./TerminalPanel";
import { disposeAllTerminals, disposeSessionTerminals, TITLE_POLL_MS } from "./termStore";

afterEach(() => {
  // 库是模块级常驻:必须显式清场,否则实例(与 term_close 桩调用)串进
  // 下一个用例;先清库再清 mock,dispose 的计数不外溢
  disposeAllTerminals();
  vi.useRealTimers();
  vi.clearAllMocks();
  dataHandlers = [];
  titleHandlers = [];
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

interface Call {
  cmd: string;
  args?: Record<string, unknown>;
}

/** 壳桩:invoke 记录 + 可触发的事件监听表;term_open 时留档「监听是否已
 *  注册」(铁律 2 的机检点)。 */
function stubShell(opts: { failOpen?: string; title?: () => string | null } = {}) {
  const calls: Call[] = [];
  const listeners = new Map<string, Set<(e: { payload: unknown }) => void>>();
  let listenedAtOpen: boolean | null = null;
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        if (cmd === "term_open") {
          const id = String(args?.id);
          listenedAtOpen =
            (listeners.get(`term-data:${id}`)?.size ?? 0) > 0 && (listeners.get(`term-exit:${id}`)?.size ?? 0) > 0;
          if (opts.failOpen) return Promise.reject(new Error(opts.failOpen));
        }
        if (cmd === "term_title") return Promise.resolve(opts.title?.() ?? null);
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
  const emit = (name: string, payload: unknown) => {
    for (const cb of [...(listeners.get(name) ?? [])]) cb({ payload });
  };
  return { calls, emit, listenedAt: () => listenedAtOpen };
}

const openCalls = (calls: Call[]) => calls.filter((c) => c.cmd === "term_open");
const closeCalls = (calls: Call[]) => calls.filter((c) => c.cmd === "term_close");
/** 显式新建(2026-08-30 用户定案「不要默认启动一个」):空态 CTA 与头部
 *  「+」同名,任一时刻只存在一个。 */
const newTerm = () => userEvent.click(screen.getByRole("button", { name: "新建终端" }));

describe("TerminalPanel 传输契约", () => {
  it("进 tab 不自动起 shell:空态等用户新建;新建后监听先于命令(带 cwd/行列),输出分片喂 xterm", async () => {
    const shell = stubShell();
    render(<TerminalPanel sessionId="s1" workdir="/proj/alpha" />);
    // 不自动播种:面板挂载不落任何 term_open,空态 + 新建入口;
    // 实例页签行整行退场(空 header 条是纯占位噪音,2026-08-30 用户报障)
    expect(screen.getByText("没有打开的终端")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(openCalls(shell.calls)).toHaveLength(0);

    await newTerm();
    await waitFor(() => expect(openCalls(shell.calls)).toHaveLength(1));
    const open = openCalls(shell.calls)[0]!;
    expect(open.args).toMatchObject({ cwd: "/proj/alpha", cols: 80, rows: 24 });
    expect(shell.listenedAt()).toBe(true); // 铁律 2:先监听再开(否则首屏丢提示符)
    expect(openSpy).toHaveBeenCalledTimes(1); // xterm 已挂进面板宿主

    const id = String(open.args?.id);
    act(() => shell.emit(`term-data:${id}`, b64encode("hi$ ")));
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull(); // 启动覆盖层退场
  });

  it("输入经 base64 上行 term_write;点实例 × 才 term_close + dispose", async () => {
    const shell = stubShell();
    render(<TerminalPanel sessionId="s1" />);
    await newTerm();
    await waitFor(() => expect(openCalls(shell.calls)).toHaveLength(1));
    const id = String(openCalls(shell.calls)[0]!.args?.id);

    dataHandlers[0]!("ls\n");
    expect(shell.calls).toContainEqual({ cmd: "term_write", args: { id, data: b64encode("ls\n") } });

    await userEvent.click(screen.getByRole("button", { name: "关闭终端 1" }));
    expect(closeCalls(shell.calls)).toEqual([{ cmd: "term_close", args: { id } }]);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("term_open 失败:状态覆盖层外显原因;shell 退出:状态置为已退出", async () => {
    stubShell({ failOpen: "PTY 起不来" });
    const failedView = render(<TerminalPanel sessionId="s1" />);
    await newTerm();
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toContain("PTY 起不来"));
    disposeAllTerminals();
    failedView.unmount(); // s1 空态的新建 CTA 让位,下面 s2 的不撞名

    const shell = stubShell();
    render(<TerminalPanel sessionId="s2" />);
    await newTerm();
    await waitFor(() => expect(openCalls(shell.calls)).toHaveLength(1));
    const id = String(openCalls(shell.calls)[0]!.args?.id);
    act(() => shell.emit(`term-exit:${id}`, null));
    expect((await screen.findByRole("status")).textContent).toContain("终端已退出");
  });
});

describe("终端持久化(2026-08-30 用户定案:视图离场不杀 shell)", () => {
  it("卸载面板(收侧边栏/切会话):不 term_close、xterm 不 dispose;重挂原样回来不新开", async () => {
    const shell = stubShell();
    const view = render(<TerminalPanel sessionId="s1" workdir="/p" />);
    await newTerm();
    await waitFor(() => expect(openCalls(shell.calls)).toHaveLength(1));

    view.unmount();
    expect(closeCalls(shell.calls)).toHaveLength(0);
    expect(disposeSpy).not.toHaveBeenCalled();

    render(<TerminalPanel sessionId="s1" workdir="/p" />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /终端 1/ })).toBeTruthy());
    expect(openCalls(shell.calls)).toHaveLength(1); // 同一实例回归,不再播种
    expect(openSpy).toHaveBeenCalledTimes(1); // xterm.open 只在首次 attach(buffer 不重建)
  });

  it("会话隔离:各会话各自成组;切会话不动旧会话的 shell、也不替新会话自动开", async () => {
    const shell = stubShell();
    const view = render(<TerminalPanel sessionId="s1" />);
    await newTerm();
    await waitFor(() => expect(openCalls(shell.calls)).toHaveLength(1));
    view.unmount();

    render(<TerminalPanel sessionId="s2" />);
    expect(screen.getByText("没有打开的终端")).toBeTruthy(); // s2 是独立空组
    expect(openCalls(shell.calls)).toHaveLength(1); // 不自动开
    expect(closeCalls(shell.calls)).toHaveLength(0); // s1 的 shell 原地活着
  });

  it("会话删除:disposeSessionTerminals 杀掉整组(孤儿 shell 不许跑到退出)", async () => {
    const shell = stubShell();
    render(<TerminalPanel sessionId="s1" />);
    await newTerm();
    await waitFor(() => expect(openCalls(shell.calls)).toHaveLength(1));
    const id = String(openCalls(shell.calls)[0]!.args?.id);

    act(() => disposeSessionTerminals("s1"));
    expect(closeCalls(shell.calls)).toEqual([{ cmd: "term_close", args: { id } }]);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("多实例与 tab 标题", () => {
  it("新建开新 PTY 并落焦;关闭只杀对应 PTY;全关留空态不复活", async () => {
    const shell = stubShell();
    render(<TerminalPanel sessionId="s1" workdir="/p" />);
    await newTerm();
    await waitFor(() => expect(openCalls(shell.calls)).toHaveLength(1));
    const firstId = String(openCalls(shell.calls)[0]!.args?.id);

    await newTerm(); // 此刻空态 CTA 已让位,点的是头部「+」
    await waitFor(() => expect(openCalls(shell.calls)).toHaveLength(2));
    const secondId = String(openCalls(shell.calls)[1]!.args?.id);
    expect(secondId).not.toBe(firstId);
    expect(screen.getByRole("tab", { name: /终端 2/ }).getAttribute("aria-selected")).toBe("true");

    // 切回 1:实例 2 只是藏起来,不 term_close(后台 shell 继续跑)
    await userEvent.click(screen.getByRole("tab", { name: /终端 1/ }));
    expect(closeCalls(shell.calls)).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "关闭终端 2" }));
    expect(closeCalls(shell.calls)).toEqual([{ cmd: "term_close", args: { id: secondId } }]);
    expect(screen.getByRole("tab", { name: /终端 1/ }).getAttribute("aria-selected")).toBe("true");

    await userEvent.click(screen.getByRole("button", { name: "关闭终端 1" }));
    expect(screen.getByText("没有打开的终端")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull(); // 页签行随全关退场
    expect(openCalls(shell.calls)).toHaveLength(2); // 不自动复活
  });

  it("tab 名跟随前台进程(轮询 term_title);shell 发 OSC 后以 OSC 为准、轮询让位", async () => {
    vi.useFakeTimers();
    let polled = "npm";
    stubShell({ title: () => polled });
    render(<TerminalPanel sessionId="s1" />);
    // 假时钟下不用 userEvent(它内部等真实时钟会挂):fireEvent 直点空态 CTA
    fireEvent.click(screen.getByRole("button", { name: "新建终端" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // start() 的微任务链落定
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TITLE_POLL_MS + 50);
    });
    expect(screen.getByRole("tab", { name: /npm/ })).toBeTruthy();

    // OSC 到来(oh-my-zsh 等自己管标题):以它为准
    act(() => titleHandlers[0]!("vim main.rs"));
    expect(screen.getByRole("tab", { name: /vim main\.rs/ })).toBeTruthy();

    // 此后轮询不再覆盖(两个来源交替写会闪)
    polled = "zsh";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TITLE_POLL_MS + 50);
    });
    expect(screen.getByRole("tab", { name: /vim main\.rs/ })).toBeTruthy();
  });
});
