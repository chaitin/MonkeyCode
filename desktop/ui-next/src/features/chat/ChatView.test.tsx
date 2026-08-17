import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionMeta } from "@/lib/ipc/sessions";
import { b64encode } from "@/lib/protocol/codec";
import { ChatView } from "./ChatView";

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

const META: SessionMeta = { id: "s1", title: "修复登录", workdir: "/p/a", model: "m", turns: 2, status: "idle" };

interface Op {
  op: string;
  cmd?: string;
  args?: Record<string, unknown>;
}

function stubShell({
  hasMore = false,
  outline,
  frames,
  changes,
  historyPages,
}: {
  hasMore?: boolean;
  outline?: unknown[];
  /** session_open 回放窗口帧覆写(空态用例给 []) */
  frames?: unknown[];
  /** session_call repo_file_changes 的应答(改动徽标用例) */
  changes?: unknown;
  /** session_history 逐次应答队列(offset 补页用例);耗尽/缺省走单页默认 */
  historyPages?: unknown[];
} = {}) {
  const ops: Op[] = [];
  const listeners = new Map<string, (e: { payload: unknown }) => void>();
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        ops.push({ op: "invoke", cmd, args });
        if (cmd === "session_outline") return Promise.resolve(outline ?? null);
        if (cmd === "session_call" && args?.kind === "repo_file_changes") {
          return Promise.resolve(changes ?? { result: [], is_git_repo: true });
        }
        if (cmd === "session_call") return Promise.resolve({ result: [] });
        if (cmd === "session_open") {
          return Promise.resolve({
            frames: frames ?? [
              { type: "user-input", data: { content: b64encode("帮我修 bug") }, timestamp: 1, seq: 1 },
              {
                type: "task-running",
                kind: "acp_event",
                data: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "先看**日志**" } } },
                timestamp: 2,
                seq: 2,
              },
            ],
            cursor: 7,
            has_more: hasMore,
          });
        }
        if (cmd === "session_history") {
          // 真实壳形状:session_history 的游标叫 next_cursor(≠ session_open 的 cursor)
          return Promise.resolve(
            historyPages?.shift() ?? {
              frames: [{ type: "user-input", data: { content: b64encode("更早的问题") }, timestamp: 0, seq: 0 }],
              next_cursor: 3,
              has_more: false,
            },
          );
        }
        return Promise.resolve(null);
      },
    },
    event: {
      listen: (name: string, cb: (e: { payload: unknown }) => void) => {
        ops.push({ op: "listen", cmd: name });
        listeners.set(name, cb);
        return Promise.resolve(() => listeners.delete(name));
      },
    },
  };
  return { ops, emit: (name: string, payload: unknown) => listeners.get(name)?.({ payload }) };
}

describe("聊天视图", () => {
  it("铁律:frames/conn 监听注册先于 session_open;回放窗口渲染用户气泡与 agent markdown", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    // markdown 经视口懒渲染升格(Markdown.tsx::useNearViewport),窗口
    // transition 落地后还有一跳被动 effect,断言要等它
    await waitFor(() => expect(screen.getByText("日志").tagName).toBe("STRONG"));

    const openAt = ops.findIndex((o) => o.op === "invoke" && o.cmd === "session_open");
    const framesAt = ops.findIndex((o) => o.op === "listen" && o.cmd === "frames:s1");
    const connAt = ops.findIndex((o) => o.op === "listen" && o.cmd === "conn-status:s1");
    expect(framesAt).toBeGreaterThanOrEqual(0);
    expect(framesAt).toBeLessThan(openAt);
    expect(connAt).toBeLessThan(openAt);
  });

  it("实时帧经事件继续归约(流式追加)", async () => {
    const { emit } = stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    emit("frames:s1", [
      {
        type: "task-running",
        kind: "acp_event",
        data: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: ",再跑测试" } } },
        timestamp: 3,
        seq: 3,
      },
    ]);
    await waitFor(() => expect(screen.getByText(/再跑测试/)).toBeTruthy());
  });

  it("加载更早:前插历史且 cursor 前移,原条目仍在", async () => {
    const { ops } = stubShell({ hasMore: true });
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "加载更早" }));
    await waitFor(() => expect(screen.getByText("更早的问题")).toBeTruthy());
    expect(screen.getByText("帮我修 bug")).toBeTruthy();
    const hist = ops.find((o) => o.cmd === "session_history");
    expect(hist?.args).toEqual({ id: "s1", cursor: 7, limit: 3 });
  });

  it("滚近顶部(一屏内)自动补一页更早历史,无需点按钮", async () => {
    const { ops } = stubShell({ hasMore: true });
    const { container } = render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    const log = container.querySelector<HTMLElement>("[data-chat-log]")!;
    // happy-dom 无布局:手动给出几何。自动补页只服务真正离底看历史的人
    // (贴底跟随中不触发,否则会窃取 pinned 旗标),所以要先滚到底建立
    // 方向基线,再向上滚进「距顶不足一屏」
    Object.defineProperty(log, "clientHeight", { value: 500, configurable: true });
    Object.defineProperty(log, "scrollHeight", { value: 2000, configurable: true });
    log.scrollTop = 1500;
    fireEvent.scroll(log);
    log.scrollTop = 100;
    fireEvent.scroll(log);
    await waitFor(() => expect(screen.getByText("更早的问题")).toBeTruthy());
    expect(ops.find((o) => o.cmd === "session_history")).toBeTruthy();
    // 没有更早历史后(has_more:false)不再重复触发
    const calls = ops.filter((o) => o.cmd === "session_history").length;
    fireEvent.scroll(log);
    await new Promise((r) => setTimeout(r, 30));
    expect(ops.filter((o) => o.cmd === "session_history").length).toBe(calls);
  });

  it("贴底跟随中不自动补页(内容不足两屏时进场贴底就距顶不足一屏)", async () => {
    const { ops } = stubShell({ hasMore: true });
    const { container } = render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    const log = container.querySelector<HTMLElement>("[data-chat-log]")!;
    // 内容 800 / 视口 500:贴底位 scrollTop=300,天然落在「距顶不足一屏」;
    // 自动补页若不豁免贴底态,onLoadEarlier 第一行会清掉 pinnedRef,
    // 流式新内容从此不再跟随
    Object.defineProperty(log, "clientHeight", { value: 500, configurable: true });
    Object.defineProperty(log, "scrollHeight", { value: 800, configurable: true });
    log.scrollTop = 300;
    fireEvent.scroll(log); // 距底 0px,dy 向下:贴底跟随成立
    await new Promise((r) => setTimeout(r, 30));
    expect(ops.some((o) => o.cmd === "session_history")).toBe(false);
    // 手动兜底入口仍在
    expect(screen.getByRole("button", { name: "加载更早" })).toBeTruthy();
  });

  it("发送:user-input 帧 content 走 base64;失败不丢草稿", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    const box = screen.getByRole("textbox", { name: "消息输入" });
    await userEvent.type(box, "第二个问题");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    const sent = ops.find((o) => o.cmd === "session_send");
    expect(sent?.args).toEqual({ id: "s1", ftype: "user-input", payload: { content: b64encode("第二个问题") } });
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("Enter 发送、Shift+Enter 换行", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    const box = screen.getByRole("textbox", { name: "消息输入" });
    await userEvent.type(box, "甲{Shift>}{Enter}{/Shift}乙");
    expect(ops.some((o) => o.cmd === "session_send")).toBe(false);
    await userEvent.type(box, "{Enter}");
    const sent = ops.find((o) => o.cmd === "session_send");
    expect(sent?.args?.payload).toEqual({ content: b64encode("甲\n乙") });
  });

  it("全局键盘审批:待决审批时 ⏎ 允许(permission-resp 载荷对表壳侧)", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    emit("frames:s1", [
      { type: "permission-req", data: { id: "p1", title: "npm test", tool: "Bash" }, timestamp: 4, seq: 4 },
    ]);
    await waitFor(() => expect(screen.getByText("需要确认")).toBeTruthy());
    await userEvent.keyboard("{Enter}");
    const sent = ops.find((o) => o.cmd === "session_send" && (o.args?.ftype as string) === "permission-resp");
    expect(sent?.args?.payload).toEqual({ id: "p1", approved: true, remember: false, persist: false });
  });

  it("全局键盘审批:esc 拒绝;无待决审批时 ⏎/esc 不发任何帧", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    await userEvent.keyboard("{Enter}{Escape}");
    expect(ops.some((o) => o.cmd === "session_send")).toBe(false);

    emit("frames:s1", [
      { type: "permission-req", data: { id: "p2", title: "curl", tool: "Bash" }, timestamp: 4, seq: 4 },
    ]);
    await waitFor(() => expect(screen.getByText("需要确认")).toBeTruthy());
    await userEvent.keyboard("{Escape}");
    const sent = ops.find((o) => o.cmd === "session_send" && (o.args?.ftype as string) === "permission-resp");
    expect(sent?.args?.payload).toEqual({ id: "p2", approved: false, remember: false, persist: false });
  });

  it("键盘审批不抢正在写的消息:composer 有草稿时 ⏎ 走发送,不是允许", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    emit("frames:s1", [
      { type: "permission-req", data: { id: "p3", title: "npm test", tool: "Bash" }, timestamp: 4, seq: 4 },
    ]);
    await waitFor(() => expect(screen.getByText("需要确认")).toBeTruthy());
    const box = screen.getByRole("textbox", { name: "消息输入" });
    await userEvent.type(box, "先等等{Enter}");
    expect(ops.some((o) => o.cmd === "session_send" && (o.args?.ftype as string) === "permission-resp")).toBe(false);
    expect(ops.some((o) => o.cmd === "session_send" && (o.args?.ftype as string) === "user-input")).toBe(true);
  });

  it("布局契约:头部非交互子节点全带拖拽属性;按钮与改名 span 不带", async () => {
    stubShell();
    render(<ChatView meta={META} epoch={0} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    const header = document.querySelector("[data-view-header]") as HTMLElement;
    expect(header.hasAttribute("data-tauri-drag-region")).toBe(true);
    const h1 = header.querySelector("h1") as HTMLElement;
    expect(h1.hasAttribute("data-tauri-drag-region")).toBe(true);
    // 双击改名的文字 span 必须留在拖拽区之外(拖拽区双击=窗口最大化)
    expect(h1.querySelector("span")?.hasAttribute("data-tauri-drag-region")).toBe(false);
    for (const btn of header.querySelectorAll("button")) {
      expect(btn.hasAttribute("data-tauri-drag-region")).toBe(false);
    }
  });

  it("卸载即 session_close(会话切换不漏连接)", async () => {
    const { ops } = stubShell();
    const { unmount } = render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    unmount();
    expect(ops.some((o) => o.cmd === "session_close")).toBe(true);
  });

  it("单行标题优先级:用户改名 > 轮末摘要 > 首句自动标题(2026-08-06 定案,撤两行)", async () => {
    // 有摘要且未改名:标题位显摘要
    stubShell();
    const { unmount } = render(<ChatView meta={{ ...META, summary: "正在修复登录页闪退" }} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    expect(screen.getByRole("heading").textContent).toBe("正在修复登录页闪退");
    unmount();
    // 用户改过名:改名压过摘要
    stubShell();
    const r2 = render(<ChatView meta={{ ...META, summary: "正在修复登录页闪退", title_custom: true }} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    expect(screen.getByRole("heading").textContent).toBe("修复登录");
    r2.unmount();
    // 都没有:回落首句自动标题;头部不再有副标题行
    stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    expect(screen.getByRole("heading").textContent).toBe("修复登录");
    expect(screen.queryByText("a")).toBeNull(); // workdir 末段不再单独成行
  });

  it("任务面板:plan 帧非空时钉在 composer 上方,收起态一行摘要", async () => {
    const { emit } = stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    expect(screen.queryByText(/任务 \d/)).toBeNull();
    emit("frames:s1", [
      {
        type: "task-running",
        kind: "acp_event",
        data: {
          update: {
            sessionUpdate: "plan",
            entries: [
              { content: "读代码", status: "completed" },
              { content: "改代码", status: "in_progress" },
            ],
          },
        },
        timestamp: 5,
        seq: 5,
      },
    ]);
    await waitFor(() => expect(screen.getByText("任务 1/2")).toBeTruthy());
    expect(screen.getByText(/正在:改代码/)).toBeTruthy();
  });

  it("H1 浮层优先:抽屉开 + 待审批,一次 Esc 只关抽屉不发 permission-resp;再按才拒绝", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "会话文件" }));
    expect(screen.getByRole("region", { name: "会话文件" })).toBeTruthy();
    emit("frames:s1", [
      { type: "permission-req", data: { id: "p9", title: "npm test", tool: "Bash" }, timestamp: 4, seq: 4 },
    ]);
    await waitFor(() => expect(screen.getByText("需要确认")).toBeTruthy());

    const permResp = () => ops.filter((o) => o.cmd === "session_send" && (o.args?.ftype as string) === "permission-resp");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "会话文件" })).toBeNull(); // 抽屉关了
    expect(permResp()).toHaveLength(0); // 同一下按键没顺手拒绝(deny 不可逆)

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(permResp()).toHaveLength(1));
    expect(permResp()[0]?.args?.payload).toEqual({ id: "p9", approved: false, remember: false, persist: false });
  });

  it("D4 双击标题改名:Enter 提交 session_patch,不乐观改 meta(等 session-event 回写)", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    fireEvent.doubleClick(screen.getByText("修复登录"));
    const input = screen.getByRole("textbox", { name: "会话标题" }) as HTMLInputElement;
    expect(input.value).toBe("修复登录");
    fireEvent.change(input, { target: { value: "登录闪退修复" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const patches = ops.filter((o) => o.cmd === "session_patch");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.args).toEqual({ id: "s1", patch: { title: "登录闪退修复" } });
    // 输入态退出;标题不乐观改(列表 patch 经 session-event 回写才换)
    expect(screen.queryByRole("textbox", { name: "会话标题" })).toBeNull();
    expect(screen.getByText("修复登录")).toBeTruthy();
  });

  it("D4 改名守卫:Esc 放弃;未变不提交;失焦提交;IME 选字回车不提交", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={{ ...META, title_custom: true }} />);
    await waitFor(() => expect(screen.getByText("修复登录")).toBeTruthy());
    const patches = () => ops.filter((o) => o.cmd === "session_patch");
    const open = () => {
      fireEvent.doubleClick(screen.getByText("修复登录"));
      return screen.getByRole("textbox", { name: "会话标题" }) as HTMLInputElement;
    };

    // Esc 放弃:不发 patch
    let input = open();
    fireEvent.change(input, { target: { value: "不要这个名字" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(patches()).toHaveLength(0);
    expect(screen.queryByRole("textbox", { name: "会话标题" })).toBeNull();

    // 未变:Enter 收编辑态但不发 patch
    input = open();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(patches()).toHaveLength(0);

    // IME 选字回车(compositionend 时间窗内)不提交
    input = open();
    fireEvent.change(input, { target: { value: "拼音标题" } });
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(patches()).toHaveLength(0);
    expect(screen.getByRole("textbox", { name: "会话标题" })).toBeTruthy(); // 仍在编辑态

    // 失焦提交(上面的编辑态直接失焦)
    fireEvent.blur(screen.getByRole("textbox", { name: "会话标题" }));
    expect(patches()).toHaveLength(1);
    expect(patches()[0]?.args).toEqual({ id: "s1", patch: { title: "拼音标题" } });
  });

  it("D2 子会话回放:入口打开只读浮层(先监听后 open),关闭即 session_close", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    emit("frames:s1", [
      {
        type: "task-running",
        kind: "acp_event",
        data: { update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Agent 子任务", status: "in_progress" } },
        timestamp: 4,
        seq: 4,
      },
      {
        type: "task-running",
        kind: "acp_event",
        data: {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "t1",
            status: "in_progress",
            progress: { kind: "child_session", childSessionId: "c1" },
          },
        },
        timestamp: 5,
        seq: 5,
      },
    ]);
    await userEvent.click(await screen.findByRole("button", { name: "查看子会话" }));

    // 浮层出现,子会话遵守铁律:frames:c1 监听先于 session_open(id=c1)
    const childDialog = await screen.findByRole("dialog", { name: "子代理会话" });
    // 子会话也可能有上千行；滚动层必须加入动态窗口协议，否则只挂载尾窗，
    // 向上滚动时 LogList 收不到事件，较早内容永远不可达。
    expect(childDialog.querySelector("[data-chat-log]")).toBeTruthy();
    const childOpenAt = ops.findIndex((o) => o.op === "invoke" && o.cmd === "session_open" && o.args?.id === "c1");
    const childFramesAt = ops.findIndex((o) => o.op === "listen" && o.cmd === "frames:c1");
    expect(childOpenAt).toBeGreaterThanOrEqual(0);
    expect(childFramesAt).toBeGreaterThanOrEqual(0);
    expect(childFramesAt).toBeLessThan(childOpenAt);
    // 只读回放:无第二个 composer(浮层里没有消息输入)
    expect(screen.getAllByRole("textbox", { name: "消息输入" })).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "子代理会话" })).toBeNull();
    expect(ops.some((o) => o.cmd === "session_close" && o.args?.id === "c1")).toBe(true);
  });

  it("D2 浮层 Esc:浮层优先关闭,不落到审批热键(不发 permission-resp)", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    emit("frames:s1", [
      {
        type: "task-running",
        kind: "acp_event",
        data: {
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "t1",
            title: "Agent 子任务",
            status: "in_progress",
            progress: { kind: "child_session", childSessionId: "c1" },
          },
        },
        timestamp: 4,
        seq: 4,
      },
      { type: "permission-req", data: { id: "p8", title: "npm test", tool: "Bash" }, timestamp: 5, seq: 5 },
    ]);
    await userEvent.click(await screen.findByRole("button", { name: "查看子会话" }));
    await screen.findByRole("dialog", { name: "子代理会话" });

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "子代理会话" })).toBeNull();
    expect(ops.some((o) => o.cmd === "session_send" && (o.args?.ftype as string) === "permission-resp")).toBe(false);
  });

  it("提问大纲:锚不在窗口时按条目 offset ensureLoaded 精确补页(offset 为终点,不盲翻),补齐后跳转", async () => {
    const { ops } = stubShell({
      hasMore: true,
      // 两页历史:目标那轮(offset 0)要翻到第二页;两页都自称 has_more,
      // 翻页只认「cursor 已越过 offset」这个终点,不再按锚在不在 DOM 盲翻
      historyPages: [
        {
          frames: [{ type: "user-input", data: { content: b64encode("中间的问题") }, timestamp: 0, seq: 3 }],
          next_cursor: 4,
          has_more: true,
        },
        {
          frames: [{ type: "user-input", data: { content: b64encode("最早的问题") }, timestamp: 0, seq: 1 }],
          next_cursor: 0,
          has_more: true,
        },
      ],
      frames: [{ type: "user-input", data: { content: b64encode("帮我修 bug") }, timestamp: 1, seq: 5 }],
      outline: [
        { seq: 1, offset: 0, content: b64encode("最早的问题"), timestamp: 0 },
        { seq: 3, offset: 4, content: b64encode("中间的问题"), timestamp: 0 },
        { seq: 5, offset: 7, content: b64encode("帮我修 bug"), timestamp: 1 },
      ],
    });
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    const nav = await screen.findByRole("navigation", { name: "提问大纲" });
    fireEvent.mouseEnter(nav.querySelector("[data-outline-dot]")!);
    // 目录条目在,正文里还没有(在更早的历史页里)
    expect(screen.getByText("最早的问题")).toBeTruthy();
    expect(ops.some((o) => o.cmd === "session_history")).toBe(false);
    fireEvent.click(screen.getByText("最早的问题"));
    // ensureLoaded(0):cursor 7 → 4 → 0,两页即止;目标气泡随第二页渲染
    await waitFor(() => expect(screen.getByText("最早的问题")).toBeTruthy());
    expect(screen.getByText("中间的问题")).toBeTruthy();
    const hist = ops.filter((o) => o.cmd === "session_history");
    expect(hist.map((o) => o.args?.cursor)).toEqual([7, 4]);
    // has_more 仍为 true 也不再翻第三页:session_history 以 outline 的
    // offset 为终点(旧的 80 页盲翻上限机制已退役)
    await new Promise((r) => setTimeout(r, 50));
    expect(ops.filter((o) => o.cmd === "session_history")).toHaveLength(2);
  });

  it("提问大纲:连续跳转由同一日志容器执行两次不同目标滚动", async () => {
    stubShell({
      frames: [
        { type: "user-input", data: { content: b64encode("第一问") }, timestamp: 1, seq: 1 },
        { type: "user-input", data: { content: b64encode("第二问") }, timestamp: 2, seq: 9 },
      ],
      outline: [
        { seq: 1, offset: 0, content: b64encode("第一问"), timestamp: 1 },
        { seq: 9, offset: 4, content: b64encode("第二问"), timestamp: 2 },
      ],
    });
    const { container } = render(<ChatView meta={{ ...META, id: "s-outline-scroll" }} />);
    await screen.findByText("第一问");
    const log = container.querySelector("[data-chat-log]") as HTMLElement;
    const first = log.querySelector('[data-user-seq="1"]') as HTMLElement;
    const second = log.querySelector('[data-user-seq="9"]') as HTMLElement;
    let currentTop = 20;
    const assignedTops: number[] = [];
    Object.defineProperty(log, "scrollTop", {
      configurable: true,
      get: () => currentTop,
      set: (top: number) => { currentTop = top; assignedTops.push(top); },
    });
    vi.spyOn(log, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue({ top: 180 } as DOMRect);
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue({ top: 360 } as DOMRect);
    const nav = await screen.findByRole("navigation", { name: "提问大纲" });
    fireEvent.mouseEnter(nav.querySelector("[data-outline-dot]")!);
    await userEvent.click(within(nav).getByText("第一问"));
    fireEvent.mouseEnter(nav.querySelector("[data-outline-dot]")!);
    await userEvent.click(within(nav).getByText("第二问"));

    expect(assignedTops).toEqual([100, 360]);
  });

  it("提问大纲:跳到早期消息后切走再切回,自动补回该历史锚点而不是只剩顶部空白", async () => {
    const first = { ...META, id: "s-outline-return", title: "长任务" };
    const other = { ...META, id: "s-outline-other", title: "另一个任务" };
    // 超过虚拟窗口上限:若恢复锚点仍拿本次打开才稳定的 row key,切回后会
    // 渲染尾窗 + 顶部大块 spacer；scrollTop 又停在 0,画面就只剩「加载更早」。
    const tail = Array.from({ length: 200 }, (_, index) => ({
      type: "user-input",
      data: { content: b64encode(`尾部问题 ${index}`) },
      timestamp: 100 + index,
      seq: 100 + index,
    }));
    const earlyPage = {
      frames: [{ type: "user-input", data: { content: b64encode("最早的问题") }, timestamp: 1, seq: 1 }],
      next_cursor: 0,
      has_more: false,
    };
    const { ops } = stubShell({
      hasMore: true,
      frames: tail,
      outline: [
        { seq: 1, offset: 0, content: b64encode("最早的问题"), timestamp: 1 },
        { seq: 299, offset: 7, content: b64encode("尾部问题 199"), timestamp: 299 },
      ],
      historyPages: [{ ...earlyPage }, { ...earlyPage }],
    });
    const view = render(<ChatView meta={first} />);
    await screen.findByText("尾部问题 199");
    const nav = await screen.findByRole("navigation", { name: "提问大纲" });
    fireEvent.mouseEnter(nav.querySelector("[data-outline-dot]")!);
    await userEvent.click(within(nav).getByText("最早的问题"));

    const earlyBubble = await waitFor(() => {
      const node = view.container.querySelector<HTMLElement>('[data-user-seq="1"]');
      expect(node).toBeTruthy();
      return node!;
    });
    const earlyRow = earlyBubble.closest<HTMLElement>("[data-virtual-row]")!;
    const log = view.container.querySelector<HTMLElement>("[data-chat-log]")!;
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 20_000 },
    });
    vi.spyOn(log, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 600, height: 600 } as DOMRect);
    vi.spyOn(earlyRow, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 60, height: 60 } as DOMRect);
    fireEvent.scroll(log);
    await act(() => new Promise((resolve) => setTimeout(resolve, 30))); // rAF 节流的滚动记忆落盘

    view.rerender(<ChatView meta={other} />);
    await waitFor(() =>
      expect(ops.filter((o) => o.cmd === "session_open" && o.args?.id === other.id)).toHaveLength(1),
    );
    // 等另一个任务的尾窗真正提交；否则 A→B→A 三次 transition 会在测试里
    // 合并成一次，观察不到用户实际已经切走后的恢复路径。
    await waitFor(() => expect(view.container.querySelector('[data-user-seq="1"]')).toBeNull());
    view.rerender(<ChatView meta={first} />);

    await waitFor(() =>
      expect(ops.filter((o) => o.cmd === "session_history" && o.args?.id === first.id)).toHaveLength(2),
    );
    await waitFor(() => expect(view.container.querySelector('[data-user-seq="1"]')).toBeTruthy());
  });

  it("提问大纲 activeSeq 冒烟:面板给当前项 aria-current(jsdom 几何全 0 → 最后一条已加载提问)", async () => {
    stubShell({
      outline: [
        { seq: 1, offset: 0, content: b64encode("第一问"), timestamp: 1 },
        { seq: 9, offset: 40, content: b64encode("第二问"), timestamp: 2 },
      ],
    });
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    const nav = await screen.findByRole("navigation", { name: "提问大纲" });
    fireEvent.mouseEnter(nav.querySelector("[data-outline-dot]")!);
    // DOM 里只有 seq=1 的气泡(seq=9 未加载),它就是滚动跟踪的当前项
    await waitFor(() =>
      expect(screen.getByText("第一问").closest("button")?.getAttribute("aria-current")).toBe("true"),
    );
    expect(screen.getByText("第二问").closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  // 滚动几何 jsdom 验不了(rect 全 0),可测部分在 lib/util/scrollAnchor.test;
  // 这里只冒烟结构路径:wheel 上滚解除跟随 → 卸载写档 → 再挂载走锚点恢复
  // (startRestore 轮询/RO 守卫)全程不炸,回放内容照常渲染
  it("滚动记忆:上滚离底后卸载再挂载,恢复路径不炸且回放内容仍在", async () => {
    stubShell();
    const { unmount, container } = render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    const log = container.querySelector("[data-chat-log]") as HTMLElement;
    expect(log).toBeTruthy();
    fireEvent.wheel(log, { deltaY: -120 }); // 只有真实用户上滚才解除贴底跟随
    fireEvent.mouseDown(log, { clientX: 0 }); // 左侧按下:不属于滚动条带,不应炸
    unmount(); // 卸载 cleanup:旧会话写档 + 定时器清理

    stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
  });

  // 任务面板钉在 composer 上方的 footer 里,footer 是 shrink-0、日志视口是
  // flex-1:plan 帧一到,面板撑高 footer 就把视口压矮同样多。内容没变、
  // scrollTop 不动,于是停在离底「正好一个面板高」的位置(用户报障 2026-08-06)。
  // 几何在 happy-dom 里全 0,这里桩住 scrollHeight 才能断言贴底动作发生。
  it("任务面板到达后重新贴底(plan 撑高 footer 会压矮日志视口)", async () => {
    const { emit } = stubShell();
    // 用新会话 id:scrollMemo 是模块级留档,同文件先前用例给 s1 存过
    // pinned:false,复用会走锚点恢复而非贴底——这里要的正是"首次进会话"
    const meta = { ...META, id: "s-plan" };
    const { container } = render(<ChatView meta={meta} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    const log = container.querySelector("[data-chat-log]") as HTMLElement;
    Object.defineProperty(log, "scrollHeight", { value: 1234, configurable: true });
    log.scrollTop = 0;

    emit("frames:s-plan", [
      {
        type: "task-running",
        kind: "acp_event",
        data: {
          update: {
            sessionUpdate: "plan",
            entries: [
              { content: "第一步", status: "completed" },
              { content: "第二步", status: "in_progress" },
            ],
          },
        },
        timestamp: 3,
        seq: 3,
      },
    ]);

    await waitFor(() => expect(screen.getByText("任务 1/2")).toBeTruthy()); // 面板已挂
    expect(log.scrollTop).toBe(1234); // plan 变化也要触发对齐,否则短一个面板高
  });

  it("空态:items 空且非 running 给欢迎信息;本地版主句含 mono workdir,chat 版另一套文案", async () => {
    stubShell({ frames: [] });
    const { unmount } = render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText(/开始新任务/)).toBeTruthy());
    expect(screen.getByText("/p/a")).toBeTruthy(); // 主句内嵌 workdir
    expect(screen.getByText(/描述你想做的事/)).toBeTruthy();
    expect(screen.queryByText("开始一段新会话")).toBeNull();
    unmount();

    stubShell({ frames: [] });
    render(<ChatView meta={{ ...META, kind: "chat", workdir: "" }} />);
    await waitFor(() => expect(screen.getByText("开始一段新会话")).toBeTruthy());
    expect(screen.getByText(/记录想法、讨论方案/)).toBeTruthy();
    expect(screen.queryByText(/开始新任务/)).toBeNull();
  });

  it("空态只在真空会话出现:有回放内容时不渲染欢迎信息", async () => {
    stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    expect(screen.queryByText(/开始新任务/)).toBeNull();
    expect(screen.queryByText(/描述你想做的事/)).toBeNull();
  });

  it("改名:铅笔钮进编辑态,提交发 patch 并回调 onPatched(壳不广播事件,不拉就不生效)", async () => {
    const { ops } = stubShell();
    let patched = 0;
    render(<ChatView meta={META} onPatched={() => (patched += 1)} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    // hover 才浮现的铅笔钮(双击是隐藏交互,单击入口必须在)
    await userEvent.click(screen.getByRole("button", { name: "会话标题" }));
    const input = screen.getByRole("textbox", { name: "会话标题" });
    await userEvent.clear(input);
    await userEvent.type(input, "新标题{Enter}");
    const patches = ops.filter((o) => o.cmd === "session_patch");
    expect(patches[0]?.args).toEqual({ id: "s1", patch: { title: "新标题" } });
    await waitFor(() => expect(patched).toBe(1)); // 落盘后主动重拉,meta 才会流回来
  });

  it("未自定义标题时清空输入不提交", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={META} />);
    await userEvent.click(screen.getByRole("button", { name: "会话标题" }));
    const input = screen.getByRole("textbox", { name: "会话标题" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ops.filter((o) => o.cmd === "session_patch")).toHaveLength(0);
  });

  it("旧版自定义标题缺 title_custom:重新确认已有标题仍发 patch 补标记", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={{ ...META, title: "用户设置的标题", summary: "引擎生成的摘要" }} />);
    await waitFor(() => expect(screen.getByText("引擎生成的摘要")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "会话标题" }));
    const input = screen.getByRole("textbox", { name: "会话标题" }) as HTMLInputElement;
    expect(input.value).toBe("用户设置的标题");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(ops.filter((o) => o.cmd === "session_patch")[0]?.args).toEqual({
      id: "s1",
      patch: { title: "用户设置的标题" },
    });
  });

  it("铅笔的悬停区贴合标题,不横跨整条 header", async () => {
    stubShell();
    const { container } = render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    const h1 = container.querySelector("h1")!;
    // group/title 挂在 h1 上,而 h1 是块级、父层 flex-1:不收窄就横跨整个 header,
    // 鼠标停在标题右侧空白处也会浮出铅笔(用户报障 2026-08-06)
    expect(h1.classList.contains("group/title")).toBe(true);
    expect(h1.classList.contains("w-fit")).toBe(true);
  });

  it("清空标题:改过名的会话发 patch{title:\"\"}(壳摘 title_custom 回落 summary);没改过名的空提交是空转", async () => {
    const shell = stubShell();
    const { unmount } = render(<ChatView meta={{ ...META, title_custom: true }} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "会话标题" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "会话标题" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "会话标题" }), { key: "Enter" });
    expect(shell.ops.filter((o) => o.cmd === "session_patch")[0]?.args).toEqual({ id: "s1", patch: { title: "" } });
    unmount();

    const plain = stubShell();
    render(<ChatView meta={META} />); // 没改过名:标题本就是自动的,清空无事可撤
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "会话标题" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "会话标题" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "会话标题" }), { key: "Enter" });
    expect(plain.ops.filter((o) => o.cmd === "session_patch")).toHaveLength(0);
  });

  it("头部 ⋯ 菜单:重命名触发标题输入态;归档发 session_patch(archived)", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    expect(screen.queryByRole("menu")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    expect(screen.queryByRole("menu")).toBeNull(); // 选中即收
    const input = screen.getByRole("textbox", { name: "会话标题" });
    fireEvent.keyDown(input, { key: "Escape" }); // 放弃改名,不发 patch

    await userEvent.click(screen.getByRole("button", { name: "更多操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "归档" }));
    const patches = ops.filter((o) => o.cmd === "session_patch");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.args).toEqual({ id: "s1", patch: { archived: true } });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("头部 ⋯ 菜单:已归档会话给「取消归档」,patch archived:false", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={{ ...META, archived: true }} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "更多操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "取消归档" }));
    const patch = ops.find((o) => o.cmd === "session_patch");
    expect(patch?.args).toEqual({ id: "s1", patch: { archived: false } });
  });

  it("头部 ⋯ 菜单删除二段确认:首点只变「确认删除?」,再点才经 onDeleted 通知", async () => {
    stubShell();
    const onDeleted = vi.fn();
    render(<ChatView meta={META} onDeleted={onDeleted} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "更多操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(onDeleted).not.toHaveBeenCalled(); // 首点只进确认态
    expect(screen.getByRole("menu")).toBeTruthy();

    await userEvent.click(screen.getByRole("menuitem", { name: "确认删除?" }));
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    // 确认态不粘滞:重开菜单回到普通「删除」
    await userEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "确认删除?" })).toBeNull();
  });

  it("运行中不许删:⋯ 菜单里的删除置灰并说明原因(旧 UI DeleteMenuItem 随迁)", async () => {
    const { emit } = stubShell();
    const onDeleted = vi.fn();
    render(<ChatView meta={META} onDeleted={onDeleted} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    emit("frames:s1", [{ type: "task-started", timestamp: 9, seq: 9 }]);

    await userEvent.click(screen.getByRole("button", { name: "更多操作" }));
    const del = await screen.findByRole("menuitem", { name: "删除" });
    await waitFor(() => expect((del as HTMLButtonElement).disabled).toBe(true));
    // 理由挂 li:多数 webview 不给 disabled 按钮弹 tooltip,挂按钮上等于没写
    expect(del.closest("li")?.getAttribute("title")).toBe("运行中,请先停止");
    fireEvent.click(del);
    expect(screen.queryByRole("menuitem", { name: "确认删除?" })).toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();

    // 轮结束即恢复可删
    emit("frames:s1", [{ type: "task-ended", timestamp: 10, seq: 10 }]);
    await waitFor(() => expect((screen.getByRole("menuitem", { name: "删除" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("打开会话失败:原因进 header 之下的内嵌条(§3),不进 header", async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string) =>
          cmd === "session_open" ? Promise.reject(new Error("引擎没起来")) : Promise.resolve(null),
      },
      event: { listen: () => Promise.resolve(() => {}) },
    };
    render(<ChatView meta={META} />);
    // 壳只在成功路径 emit conn-status:这条不显,用户拿到的是不解释的空会话
    const strip = await screen.findByText("打开会话失败:引擎没起来", undefined, { timeout: 3000 });
    const header = document.querySelector("[data-view-header]") as HTMLElement;
    expect(header.contains(strip)).toBe(false);
    expect(strip.closest("[role=status]")).toBeTruthy();
  });

  it("改动徽标:轮末拉 repo_file_changes 计数;点文件钮直达「改动」页;§7 徽标带拖拽属性", async () => {
    const { ops, emit } = stubShell({ changes: { result: [{ path: "src/a.ts", status: "M" }], is_git_repo: true } });
    render(<ChatView meta={META} />);
    await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
    const header = document.querySelector("[data-view-header]") as HTMLElement;
    expect(header.querySelector(".indicator-item")).toBeNull(); // 轮末前无徽标
    const changesCalls = () =>
      ops.filter((o) => o.cmd === "session_call" && (o.args?.kind as string) === "repo_file_changes").length;
    expect(changesCalls()).toBe(0);

    emit("frames:s1", [{ type: "task-ended", timestamp: 6, seq: 6 }]);
    await waitFor(() => expect(within(header).getByText("1")).toBeTruthy());
    expect(changesCalls()).toBe(1);

    // turnEnded 是轮次级状态:下一轮开始复位,轮末边沿每轮都触发重拉
    emit("frames:s1", [{ type: "task-started", timestamp: 7, seq: 7 }]);
    await waitFor(() => expect(changesCalls()).toBe(1)); // 运行中不拉
    emit("frames:s1", [{ type: "task-ended", timestamp: 8, seq: 8 }]);
    await waitFor(() => expect(changesCalls()).toBe(2));
    // §7:indicator 壳与徽标是头部非交互子节点,必须带拖拽属性;按钮不带
    expect(header.querySelector(".indicator")?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(header.querySelector(".indicator-item")?.hasAttribute("data-tauri-drag-region")).toBe(true);
    for (const btn of header.querySelectorAll("button")) {
      expect(btn.hasAttribute("data-tauri-drag-region")).toBe(false);
    }
    // 用户报障 2026-08-10「太偏右上角」:锚点收进按钮内,徽标贴着文件夹图标;
    // 收进来就压在按钮上,故放行点击(否则点数字变成拖窗口)
    const badgeCls = header.querySelector(".indicator-item")?.className ?? "";
    expect(badgeCls).toContain("[--indicator-e:5px]");
    expect(badgeCls).toContain("[--indicator-t:5px]");
    expect(badgeCls).toContain("pointer-events-none");

    // 徽标存在时点文件钮:抽屉直达「改动」页,改动列表直出
    await userEvent.click(within(header).getByRole("button", { name: "会话文件" }));
    const tab = await screen.findByRole("tab", { name: /改动/ });
    expect(tab.className).toContain("tab-active");
    expect(await screen.findByRole("button", { name: /a\.ts/ })).toBeTruthy();
  });
});
