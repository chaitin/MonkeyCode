// composer 全功能的集成测试:经 ChatView 挂载(真实 useSessionFeed/
// useComposer 链路),假壳 IPC 断言发送面契约(载荷以壳侧 session.rs /
// uploads.rs 为准)。
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelInfo, SessionMeta } from "@/lib/ipc/sessions";
import { b64decode, b64encode } from "@/lib/protocol/codec";
import { pushEscLayer } from "@/lib/util/escLayer";
import { ChatView } from "../ChatView";
import { resetSendQueueMemoryForTests } from "./sendQueue";
import { resetStashForTests } from "./stash";

beforeEach(() => {
  localStorage.clear();
  resetSendQueueMemoryForTests();
  resetStashForTests();
});

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
  models = [],
  sessionCall,
}: {
  models?: ModelInfo[];
  sessionCall?: (args?: Record<string, unknown>) => Promise<unknown>;
} = {}) {
  const ops: Op[] = [];
  const listeners = new Map<string, (e: { payload: unknown }) => void>();
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        ops.push({ op: "invoke", cmd, args });
        if (cmd === "session_open") {
          return Promise.resolve({
            frames: [{ type: "user-input", data: { content: b64encode("帮我修 bug") }, timestamp: 1, seq: 1 }],
            cursor: 7,
            has_more: false,
          });
        }
        if (cmd === "models_list") return Promise.resolve(models);
        if (cmd === "session_call") return sessionCall ? sessionCall(args) : Promise.resolve({ result: {} });
        if (cmd === "upload_begin") return Promise.resolve({ handle: 9 });
        if (cmd === "upload_finish") return Promise.resolve({ path: ".monkeycode/uploads/shot.png" });
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

const COMMANDS_FRAME = {
  type: "task-running",
  kind: "acp_event",
  data: {
    update: {
      sessionUpdate: "available_commands_update",
      availableCommands: [
        { name: "add-context", description: "补充上下文" },
        { name: "compact", description: "压缩上下文" },
        { name: "review", description: "代码审查", input: { hint: "<范围>" } },
      ],
    },
  },
  timestamp: 2,
  seq: 2,
};

async function ready() {
  await waitFor(() => expect(screen.getByText("帮我修 bug")).toBeTruthy());
  return screen.getByRole("textbox", { name: "消息输入" });
}

const sends = (ops: Op[], ftype: string) =>
  ops.filter((o) => o.cmd === "session_send" && (o.args?.ftype as string) === ftype);
const calls = (ops: Op[], kind: string) =>
  ops.filter((o) => o.cmd === "session_call" && (o.args?.kind as string) === kind);

describe("斜杠指令面板", () => {
  it("敲 / 就地弹出;前缀过滤优先;↑↓ 循环;↩ 填入并保焦点;不发送消息", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    const box = await ready();
    emit("frames:s1", [COMMANDS_FRAME]);

    await userEvent.type(box, "/");
    const panel = await screen.findByRole("listbox", { name: "斜杠指令" });
    expect(panel).toBeTruthy();
    // 内置 /compact 排头(与引擎下发的同名条目去重),引擎清单接在其后
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("/compact"),
      expect.stringContaining("/add-context"),
      expect.stringContaining("/review"),
    ]);

    await userEvent.type(box, "co");
    // 前缀命中 compact 排前且默认高亮;add-context 子串命中垫底;review 出局
    const opts = screen.getAllByRole("option");
    expect(opts.map((o) => o.textContent)).toEqual([
      expect.stringContaining("/compact"),
      expect.stringContaining("/add-context"),
    ]);
    expect(opts[0]?.getAttribute("aria-selected")).toBe("true");

    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]?.getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{ArrowDown}"); // 底部回绕
    expect(screen.getAllByRole("option")[0]?.getAttribute("aria-selected")).toBe("true");

    await userEvent.keyboard("{Enter}");
    expect((box as HTMLTextAreaElement).value).toBe("/compact ");
    expect(screen.queryByRole("listbox")).toBeNull(); // 填入即收起
    expect(document.activeElement).toBe(box); // 焦点还给输入框
    expect(sends(ops, "user-input")).toHaveLength(0); // 这一下 ↩ 不是发送
  });

  it("本地内置 /compact:引擎不下发命令表也弹面板;确认后走 session_call session_compact,不进消息通道", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={META} />);
    const box = await ready();
    // 不喂 COMMANDS_FRAME:本地会话引擎不产 available_commands_update

    await userEvent.type(box, "/");
    expect(await screen.findByRole("listbox", { name: "斜杠指令" })).toBeTruthy();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("/compact"),
    ]);

    await userEvent.keyboard("{Enter}"); // 填入 "/compact "
    expect((box as HTMLTextAreaElement).value).toBe("/compact ");
    await userEvent.keyboard("{Enter}"); // 这一下才是执行
    await waitFor(() => expect(calls(ops, "session_compact")).toHaveLength(1));
    expect(calls(ops, "session_compact")[0]?.args?.id).toBe("s1");
    expect(sends(ops, "user-input")).toHaveLength(0); // 指令不发消息
    expect((box as HTMLTextAreaElement).value).toBe(""); // 已接受,清草稿
  });

  it("运行中 /compact:拦截外显错误、留住草稿,不上行也不排队", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    const box = await ready();
    emit("frames:s1", [{ type: "task-started", timestamp: 5, seq: 5 }]);
    await waitFor(() => expect(screen.getByText("思考中")).toBeTruthy());

    await userEvent.type(box, "/compact");
    await userEvent.keyboard("{Enter}"); // 面板确认,填入
    await userEvent.keyboard("{Enter}"); // 执行 → 忙碌拦截
    expect(await screen.findByText("任务执行中,无法压缩上下文")).toBeTruthy();
    expect(calls(ops, "session_compact")).toHaveLength(0);
    expect(sends(ops, "user-input")).toHaveLength(0);
    expect((box as HTMLTextAreaElement).value).toBe("/compact "); // 草稿不丢
    expect(screen.queryByText("已排队")).toBeNull(); // 不落排队槽
  });

  it("Esc 关闭(capture,阻断全局链:不误拒待决审批);段落清掉后恢复补全", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    const box = await ready();
    emit("frames:s1", [
      COMMANDS_FRAME,
      { type: "permission-req", data: { id: "p1", title: "npm test", tool: "Bash" }, timestamp: 3, seq: 3 },
    ]);
    await waitFor(() => expect(screen.getByText("需要确认")).toBeTruthy());

    await userEvent.type(box, "/re");
    await screen.findByRole("listbox", { name: "斜杠指令" });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "斜杠指令" })).toBeNull();
    // Esc 归面板,没有落到审批快捷键(deny 不可逆)
    expect(sends(ops, "permission-resp")).toHaveLength(0);

    // 同一段 /re 保持压制;清掉后再敲 / 恢复
    await userEvent.type(box, "v");
    expect(screen.queryByRole("listbox", { name: "斜杠指令" })).toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, "/");
    expect(await screen.findByRole("listbox", { name: "斜杠指令" })).toBeTruthy();
  });

  it("Esc 分层:先注册的视图级层抢不走面板的这一下(escLayer 按层序,不按注册时序)", async () => {
    // 视图级 Esc(设置页/新建任务)是**挂载即注册**的,而浮层只在打开时注册
    // ——同 target 同阶段按注册先后触发,自挂 window capture 的写法里视图永远
    // 先吃掉这一下(开着面板按 Esc 关掉的是整个视图)。收口到 escLayer 后由
    // 层序决定:后 push 的先拿到
    const viewLayer = vi.fn(() => true);
    const popView = pushEscLayer(viewLayer);
    try {
      const { ops, emit } = stubShell();
      render(<ChatView meta={META} />);
      const box = await ready();
      emit("frames:s1", [COMMANDS_FRAME]);
      await userEvent.type(box, "/re");
      await screen.findByRole("listbox", { name: "斜杠指令" });

      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("listbox", { name: "斜杠指令" })).toBeNull();
      expect(viewLayer).not.toHaveBeenCalled(); // 面板消费即截断,不再往下问
      expect(sends(ops, "permission-resp")).toHaveLength(0);

      // 面板收起后这一下才归视图层
      await userEvent.keyboard("{Escape}");
      expect(viewLayer).toHaveBeenCalledTimes(1);
    } finally {
      popView();
    }
  });
});

describe("模型 / 思考深度 / 权限模式", () => {
  const MODELS: ModelInfo[] = [
    { name: "m", default: true, think: "medium" },
    { name: "gpt-x@baizhi", default: false },
    { name: "vip-model", default: false, locked: true },
  ];

  it("切模型:session_call session_set_model {model:原名};锁定项禁选", async () => {
    const { ops } = stubShell({ models: MODELS });
    render(<ChatView meta={META} />);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "m" }));
    const menu = await screen.findByRole("list", { name: "切换模型" });
    expect(menu).toBeTruthy();
    const locked = screen.getByRole("button", { name: /vip-model/ }) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "gpt-x" }));
    expect(calls(ops, "session_set_model").map((o) => o.args?.payload)).toEqual([{ model: "gpt-x@baizhi" }]);
    expect(screen.queryByRole("list", { name: "切换模型" })).toBeNull();
  });

  it("模型组合菜单显示生效思考档，固定四档选择发 session_set_think 且不关闭菜单", async () => {
    const { ops } = stubShell({ models: MODELS });
    render(<ChatView meta={META} />);
    await ready();
    // 会话未显式选档 → 触发器展示当前模型 m 配置的 medium
    const trigger = screen.getByRole("button", { name: "m" });
    expect(trigger.textContent).toContain("· 中");
    await userEvent.click(trigger);
    const group = await screen.findByRole("radiogroup", { name: "思考深度" });
    expect(within(group).getAllByRole("radio").map((item) => item.textContent)).toEqual(["关闭", "低", "中", "高"]);
    await userEvent.click(within(group).getByRole("radio", { name: "高" }));
    expect(calls(ops, "session_set_think").map((o) => o.args?.payload)).toEqual([{ think: "high" }]);
    expect(screen.getByRole("list", { name: "切换模型" })).toBeTruthy();
  });

  it("think_update 回写前快速改回原档，按点击顺序串行下发且最后选择不丢", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    let thinkCalls = 0;
    const { ops, emit } = stubShell({
      models: MODELS,
      sessionCall: (args) => {
        if (args?.kind === "session_set_think" && thinkCalls++ === 0) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve({ result: {} });
      },
    });
    render(<ChatView meta={META} />);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "m" }));
    const group = await screen.findByRole("radiogroup", { name: "思考深度" });

    await userEvent.click(within(group).getByRole("radio", { name: "高" }));
    await userEvent.click(within(group).getByRole("radio", { name: "中" }));
    expect(calls(ops, "session_set_think").map((o) => o.args?.payload)).toEqual([{ think: "high" }]);

    await act(async () => resolveFirst?.({ result: {} }));
    await waitFor(() =>
      expect(calls(ops, "session_set_think").map((o) => o.args?.payload)).toEqual([
        { think: "high" },
        { think: "medium" },
      ]),
    );

    const thinkFrame = (think: string, seq: number) => ({
      type: "task-running",
      kind: "acp_event",
      data: { update: { sessionUpdate: "think_update", think } },
      timestamp: seq,
      seq,
    });
    act(() => emit("frames:s1", [thinkFrame("high", 8)]));
    await screen.findByText("思考深度已调整为「高」"); // 确认旧回写已真正进入投影
    expect(screen.getByRole("button", { name: "m" }).textContent).toContain("· 中"); // 最新选择遮住旧回写
    act(() => emit("frames:s1", [thinkFrame("medium", 9)]));
    await screen.findByText("思考深度已调整为「中」");
    act(() => emit("frames:s1", [thinkFrame("off", 10)]));
    await waitFor(() => expect(screen.getByRole("button", { name: "m" }).textContent).toContain("· 关闭")); // 已撤掉临时值
  });

  it("≥2 来源出 tabs(会员→百智云→自定义序,默认跟随当前模型来源);切 tab 换列表,选中发原名", async () => {
    const SOURCED: ModelInfo[] = [
      { name: "m", default: true },
      { name: "gpt-x@baizhi", default: false, source: "baizhi" },
      { name: "monkeycode-basic/glm@monkeycode#c1", model: "monkeycode-basic/glm", source: "monkeycode", owner: "public", default: false },
    ];
    const { ops } = stubShell({ models: SOURCED });
    render(<ChatView meta={META} />);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "m" }));
    const tablist = await screen.findByRole("tablist", { name: "模型来源" });
    expect(within(tablist).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["会员", "百智云", "自定义"]);
    // 当前模型 m 是手工条目 → 活跃 tab「自定义」,其它来源的条目不在列表里
    expect(screen.getByRole("tab", { name: "自定义" }).getAttribute("aria-selected")).toBe("true");
    const menu = screen.getByRole("list", { name: "切换模型" });
    expect(within(menu).queryByRole("button", { name: "gpt-x" })).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "百智云" }));
    await userEvent.click(within(menu).getByRole("button", { name: "gpt-x" }));
    // onPick 用原始 name(引擎寻址键),展示层剥的后缀不能丢
    expect(calls(ops, "session_set_model").map((o) => o.args?.payload)).toEqual([{ model: "gpt-x@baizhi" }]);
  });

  it("会员 tab 分节:节头 + 资格徽标;locked 条目灰态禁选(title 说明);选中发原名", async () => {
    const MEMBER: ModelInfo[] = [
      { name: "m", default: true },
      { name: "monkeycode-basic/glm@monkeycode#c1", model: "monkeycode-basic/glm", source: "monkeycode", owner: "public", default: false },
      { name: "monkeycode-ultra/claude@monkeycode#c2", model: "monkeycode-ultra/claude", source: "monkeycode", owner: "public", locked: true, default: false },
      { name: "团队甲", model: "team-x", source: "monkeycode", owner: "team", default: false },
    ];
    const { ops } = stubShell({ models: MEMBER });
    render(<ChatView meta={META} />);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "m" }));
    await userEvent.click(await screen.findByRole("tab", { name: "会员" }));
    const menu = screen.getByRole("list", { name: "切换模型" });
    // 档位/团队分节的节头恒显,徽标是资格说明
    expect(within(menu).getByText("基础模型")).toBeTruthy();
    expect(within(menu).getByText("免费使用")).toBeTruthy();
    expect(within(menu).getByText("旗舰模型")).toBeTruthy();
    expect(within(menu).getByText("旗舰会员免费")).toBeTruthy();
    expect(within(menu).getByText("团队模型")).toBeTruthy();
    // locked:超档条目留在档位节内,灰态禁选 + 行尾可见「未解锁」徽标;
    // 解锁路径 title 挂 li(disabled 按钮不弹 tooltip,2026-08-06 报障)
    const locked = within(menu).getByRole("button", { name: /claude/ }) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    expect(within(locked).getByText("未解锁")).toBeTruthy();
    expect(locked.closest("li")?.title).toContain("当前会员档不可用");

    await userEvent.click(within(menu).getByRole("button", { name: "glm" }));
    expect(calls(ops, "session_set_model").map((o) => o.args?.payload)).toEqual([
      { model: "monkeycode-basic/glm@monkeycode#c1" },
    ]);
  });

  it("模型多(>6)出过滤框:按展示名过滤 tab 内条目,无命中给空态;单来源不出 tab 行", async () => {
    const many: ModelInfo[] = Array.from({ length: 7 }, (_, i) => ({ name: `model-${i + 1}`, default: i === 0 }));
    stubShell({ models: many });
    render(<ChatView meta={META} />);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "m" }));
    const input = await screen.findByRole("textbox", { name: "过滤模型…" });
    expect(screen.queryByRole("tablist", { name: "模型来源" })).toBeNull(); // 全是手工条目 = 单来源
    const menu = screen.getByRole("list", { name: "切换模型" });
    // 7 条配置 + 1 条兜底:会话在用的 "m" 不在清单里(模型被删/改名),
    // 不补这一条的话下拉里一项都选不中,用户看不出当前用的是哪个
    expect(within(menu).getAllByRole("button")).toHaveLength(8);
    expect(within(menu).getByRole("button", { name: "m" }).getAttribute("aria-current")).toBe("true");

    await userEvent.type(input, "model-7");
    expect(within(menu).getByRole("button", { name: "model-7" })).toBeTruthy();
    expect(within(menu).queryByRole("button", { name: "model-1" })).toBeNull();

    await userEvent.clear(input);
    await userEvent.type(input, "不存在的");
    expect(within(menu).getByText("无匹配模型")).toBeTruthy();
  });

  it("权限 pill:点击与 ⇧⇥ 互切;发送面 = session_set_mode,状态以帧回写为准", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "默认权限" }));
    expect(calls(ops, "session_set_mode").map((o) => o.args?.payload)).toEqual([{ mode: "yolo" }]);

    // 壳回写 permission_mode_update 帧后 pill 翻面;⇧⇥ 从新状态出发切回
    emit("frames:s1", [
      {
        type: "task-running",
        kind: "acp_event",
        data: { update: { sessionUpdate: "permission_mode_update", mode: "yolo" } },
        timestamp: 4,
        seq: 4,
      },
    ]);
    await waitFor(() => expect(screen.getByRole("button", { name: "YOLO" })).toBeTruthy());
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(calls(ops, "session_set_mode").map((o) => o.args?.payload)).toEqual([
      { mode: "yolo" },
      { mode: "default" },
    ]);
  });

  it("运行中:组合触发器禁用，已展开菜单也立即关闭", async () => {
    const { emit } = stubShell({ models: MODELS });
    render(<ChatView meta={META} />);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "m" }));
    expect(await screen.findByRole("radiogroup", { name: "思考深度" })).toBeTruthy();

    emit("frames:s1", [{ type: "task-started", timestamp: 5, seq: 5 }]);
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "m" }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByRole("radiogroup", { name: "思考深度" })).toBeNull();
    });
  });
});

describe("picker 关闭胶水(WebKitGTK 焦点语义回归)", () => {
  const MODELS: ModelInfo[] = [
    { name: "m", default: true },
    { name: "gpt-x@baizhi", default: false },
  ];

  it("焦点丢失(relatedTarget=null 的 focusout)不关菜单——壳内核点按钮不移焦点,blur 判外点必误关", async () => {
    stubShell({ models: MODELS });
    render(<ChatView meta={META} />);
    await ready();
    const trigger = screen.getByRole("button", { name: "m" });
    await userEvent.click(trigger);
    await screen.findByRole("list", { name: "切换模型" });
    // WebKitGTK:mousedown 菜单内按钮时焦点直接清到 body,focusout 不带去向
    fireEvent.blur(trigger, { relatedTarget: null });
    expect(screen.getByRole("list", { name: "切换模型" })).toBeTruthy();
  });

  it("外点(pointerdown)关闭;菜单内 pointerdown 不关", async () => {
    stubShell({ models: MODELS });
    render(<ChatView meta={META} />);
    const box = await ready();
    await userEvent.click(screen.getByRole("button", { name: "m" }));
    const group = await screen.findByRole("radiogroup", { name: "思考深度" });
    fireEvent.pointerDown(group); // 菜单内按下(还没 click)不许关——否则 click 落空
    expect(screen.getByRole("radiogroup", { name: "思考深度" })).toBeTruthy();
    fireEvent.pointerDown(box); // 点回输入框 = 外点
    expect(screen.queryByRole("radiogroup", { name: "思考深度" })).toBeNull();
  });

  it("Esc 关闭菜单(window capture),不落到全局审批链", async () => {
    const { ops, emit } = stubShell({ models: MODELS });
    render(<ChatView meta={META} />);
    await ready();
    emit("frames:s1", [
      { type: "permission-req", data: { id: "p1", title: "npm test", tool: "Bash" }, timestamp: 3, seq: 3 },
    ]);
    await waitFor(() => expect(screen.getByText("需要确认")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "m" }));
    await screen.findByRole("radiogroup", { name: "思考深度" });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("radiogroup", { name: "思考深度" })).toBeNull();
    expect(sends(ops, "permission-resp")).toHaveLength(0); // esc = deny 不可逆,不能漏
  });

  it("结构守卫:模型组合菜单不嵌进任何外层 dropdown(daisyUI 隐藏规则是后代选择器,外层关态会把内层菜单 display:none)", async () => {
    stubShell({ models: MODELS });
    render(<ChatView meta={META} />);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "m" }));
    const group = await screen.findByRole("radiogroup", { name: "思考深度" });
    const own = group.closest(".dropdown");
    expect(own?.classList.contains("dropdown-open")).toBe(true);
    // 自己的 picker 容器之上不得再有 .dropdown 祖先(输入卡不许当 dropdown 用)
    expect(own?.parentElement?.closest(".dropdown")).toBeNull();
  });
});

describe("运行态 / 停止 / 排队", () => {
  it("裸 Esc 停止运行；有待审批时仍由审批优先", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    await ready();
    emit("frames:s1", [{ type: "task-started", timestamp: 5, seq: 5 }]);
    await screen.findByText("思考中");
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(sends(ops, "user-cancel")).toHaveLength(1);

    emit("frames:s1", [
      { type: "permission-req", data: { id: "p-stop", title: "npm test", tool: "Bash" }, timestamp: 6, seq: 6 },
    ]);
    await screen.findByText("需要确认");
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(sends(ops, "permission-resp")).toHaveLength(1);
    expect(sends(ops, "user-cancel")).toHaveLength(1);
  });

  it("运行条:思考中 + 停止(user-cancel 帧);工具执行中换文案", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    await ready();
    emit("frames:s1", [{ type: "task-started", timestamp: 5, seq: 5 }]);
    await waitFor(() => expect(screen.getByText("思考中")).toBeTruthy());

    emit("frames:s1", [
      {
        type: "task-running",
        kind: "acp_event",
        data: { update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Bash", status: "in_progress" } },
        timestamp: 6,
        seq: 6,
      },
    ]);
    await waitFor(() => expect(screen.getByText("执行中")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "停止" }));
    const cancels = sends(ops, "user-cancel");
    expect(cancels).toHaveLength(1);
    expect(cancels[0]?.args?.payload).toEqual({});
  });

  it("运行中连续发送追加队列；轮结束只补投一个队首", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    const box = await ready();
    emit("frames:s1", [{ type: "task-started", timestamp: 5, seq: 5 }]);
    await waitFor(() => expect(screen.getByText("思考中")).toBeTruthy());

    await userEvent.type(box, "补充问题{Enter}");
    expect(screen.getByRole("region", { name: "待发送消息队列" })).toBeTruthy();
    expect(screen.getByText("补充问题")).toBeTruthy();
    expect((box as HTMLTextAreaElement).value).toBe("");
    expect(sends(ops, "user-input")).toHaveLength(0); // 运行中不直发

    // 后发追加，不覆盖先发
    await userEvent.type(box, "换个问法{Enter}");
    expect(screen.getByText("补充问题")).toBeTruthy();
    expect(screen.getByText("换个问法")).toBeTruthy();

    emit("frames:s1", [{ type: "task-ended", timestamp: 7, seq: 7 }]);
    await waitFor(() => {
      const sent = sends(ops, "user-input");
      expect(sent).toHaveLength(1);
      expect(b64decode((sent[0]?.args?.payload as { content: string }).content)).toBe("补充问题");
    });
    expect(screen.getByText("换个问法")).toBeTruthy();
    expect(screen.getByText("发送中")).toBeTruthy();

    // 首帧即发送回执：该项已进入时间线，只保留内部逐轮锁，不再重复显示“发送中”。
    emit("frames:s1", [{ type: "task-started", timestamp: 8, seq: 8 }]);
    await waitFor(() => expect(screen.queryByText("发送中")).toBeNull());
    expect(screen.getByText("换个问法")).toBeTruthy();
  });

  it("排队可取消:清掉后轮结束不补投", async () => {
    const { ops, emit } = stubShell();
    render(<ChatView meta={META} />);
    const box = await ready();
    emit("frames:s1", [{ type: "task-started", timestamp: 5, seq: 5 }]);
    await waitFor(() => expect(screen.getByText("思考中")).toBeTruthy());
    await userEvent.type(box, "先排着{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "删除待发送消息" }));
    expect(screen.queryByRole("region", { name: "待发送消息队列" })).toBeNull();
    emit("frames:s1", [{ type: "task-ended", timestamp: 7, seq: 7 }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(sends(ops, "user-input")).toHaveLength(0);
  });
});

describe("输入与发送键", () => {
  it("Ctrl+Enter 插入换行且不发送,随后普通 Enter 发送多行正文", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={META} />);
    const box = await ready();

    await userEvent.type(box, "第一行");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect((box as HTMLTextAreaElement).value).toBe("第一行\n");
    expect(sends(ops, "user-input")).toHaveLength(0);

    await userEvent.type(box, "第二行{Enter}");
    await waitFor(() => expect(sends(ops, "user-input")).toHaveLength(1));
    expect(b64decode((sends(ops, "user-input")[0]?.args?.payload as { content: string }).content)).toBe("第一行\n第二行");
  });

  it("Ctrl+Alt+Enter 不冒充 Ctrl+Enter,按原普通 Enter 路径发送", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={META} />);
    const box = await ready();
    await userEvent.type(box, "AltGr 输入");

    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true, altKey: true });
    await waitFor(() => expect(sends(ops, "user-input")).toHaveLength(1));
    expect(b64decode((sends(ops, "user-input")[0]?.args?.payload as { content: string }).content)).toBe("AltGr 输入");
  });
});

describe("附件与 IME", () => {
  it("粘贴文件:分块上传后 chip 入列;发送按附件行并入正文(壳只解 content)", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={META} />);
    const box = await ready();

    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    fireEvent.paste(box, { clipboardData: { items: [{ kind: "file", getAsFile: () => file }] } });
    await waitFor(() => expect(screen.getByText("shot.png")).toBeTruthy());
    // 分块契约:begin → chunk → finish
    expect(ops.filter((o) => o.cmd === "upload_begin")).toHaveLength(1);
    expect(ops.filter((o) => o.cmd === "upload_chunk")).toHaveLength(1);
    expect(ops.filter((o) => o.cmd === "upload_finish")).toHaveLength(1);

    await userEvent.type(box, "看这张图{Enter}");
    const sent = sends(ops, "user-input");
    expect(sent).toHaveLength(1);
    expect(b64decode((sent[0]?.args?.payload as { content: string }).content)).toBe(
      "看这张图\n[图片] .monkeycode/uploads/shot.png",
    );
    // 发送后附件 chip 清空
    await waitFor(() => expect(screen.queryByText("shot.png")).toBeNull());
  });

  it("移除附件:chip 上的 ✕ 出列,不进正文", async () => {
    stubShell();
    render(<ChatView meta={META} />);
    const box = await ready();
    const file = new File([new Uint8Array([1])], "a.txt", { type: "text/plain" });
    fireEvent.paste(box, { clipboardData: { items: [{ kind: "file", getAsFile: () => file }] } });
    await waitFor(() => expect(screen.getByText("a.txt")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "移除附件" }));
    expect(screen.queryByText("a.txt")).toBeNull();
  });

  it("WKWebView 时序:compositionend 后 100ms 内的 Enter 是选字不发送,过窗后照常", async () => {
    const { ops } = stubShell();
    render(<ChatView meta={META} />);
    const box = await ready();
    await userEvent.type(box, "你好");
    fireEvent.compositionEnd(box);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(sends(ops, "user-input")).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 120));
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(sends(ops, "user-input")).toHaveLength(1));
  });
});

describe("运行条 detail 与上下文用量", () => {
  it("运行中给出「第 N 轮 · tokens」摘要(轮数 = user 项计数)", async () => {
    const { emit } = stubShell();
    render(<ChatView meta={META} />);
    await ready();
    emit("frames:s1", [
      { type: "task-started", timestamp: 5, seq: 5 },
      {
        type: "task-running",
        kind: "acp_event",
        data: { update: { sessionUpdate: "usage_update", used: 45_678, size: 200_000 } },
        timestamp: 6,
        seq: 6,
      },
    ]);
    await waitFor(() => expect(screen.getByText("第 1 轮 · 45.7k tokens")).toBeTruthy());
  });

  it("还没有 usage 帧时圆环照旧占位,并说明「暂无数据」", async () => {
    // 旧 UI 的 ContextRing 是恒显的(chat.tsx:1203,空态文案「暂无数据,
    // 本轮请求后更新」);ui-next 首版把整个圆环 gate 掉了——元素时有时无
    // 本身是干扰,用户也无从知道"这里本该有个东西、只是还没数据"
    stubShell();
    render(<ChatView meta={META} />);
    await ready();
    const ring = await screen.findByRole("img", { name: "上下文用量" });
    expect(ring.closest("[data-tip]")?.getAttribute("data-tip")).toBe("暂无数据,本轮请求后更新");
    // 空态只有轨道,没有用量弧
    expect(screen.queryByRole("progressbar", { name: "上下文用量" })).toBeNull();
  });

  it("上下文用量:radial-progress 语义 + tooltip 紧凑摘要(pct+fmtK);>85% 示警", async () => {
    const { emit } = stubShell();
    render(<ChatView meta={META} />);
    await ready();
    emit("frames:s1", [
      {
        type: "task-running",
        kind: "acp_event",
        data: { update: { sessionUpdate: "usage_update", used: 180_000, size: 200_000 } },
        timestamp: 6,
        seq: 6,
      },
    ]);
    const bar = await screen.findByRole("progressbar", { name: "上下文用量" });
    expect(bar.getAttribute("aria-valuenow")).toBe("90");
    expect(bar.closest("[data-tip]")?.getAttribute("data-tip")).toBe("上下文 90% · 180k/200k");

    // 弧线底下必须垫一整圈轨道(--value:100 的同几何层,aria-hidden 不进无障碍树):
    // daisyUI radial-progress 未填充段全透明,缺轨道时低用量看着像半截残环
    const track = bar.parentElement?.querySelector("[aria-hidden].radial-progress");
    expect(track).toBeTruthy();
    expect((track as HTMLElement).style.getPropertyValue("--value")).toBe("100");
    expect((track as HTMLElement).style.getPropertyValue("--size")).toBe(
      (bar as HTMLElement).style.getPropertyValue("--size"),
    );
    expect((track as HTMLElement).style.getPropertyValue("--thickness")).toBe(
      (bar as HTMLElement).style.getPropertyValue("--thickness"),
    );
  });
});

describe("输入框自增高(影子副本,无 JS 量高)", () => {
  // 打字路径禁同步布局读的性能契约(composerKit/ComposerTextarea 头注,
  // 2026-08-10 recording4):量高改纯 CSS 副本,这里钉两件事——
  // 副本与 textarea 度量类逐项一致(不一致高度就是错的),以及打字不再
  // 往 style.height 写任何东西(写了说明 JS 量高回魂)。
  it("副本与 textarea 共用度量类;内容跟手(尾附空格);不写 style.height", async () => {
    stubShell();
    render(<ChatView meta={META} />);
    const box = (await ready()) as HTMLTextAreaElement;
    expect(box.closest(".mc-workbench-material-interactive")).toBeTruthy();

    const replica = box.previousElementSibling as HTMLElement;
    expect(replica).toBeTruthy();
    expect(replica.getAttribute("aria-hidden")).toBe("true");
    for (const cls of ["textarea", "min-h-10", "w-full", "border-0", "text-sm"]) {
      expect(box.classList.contains(cls)).toBe(true);
      expect(replica.classList.contains(cls)).toBe(true);
    }
    // 副本必须按 textarea 的换行语义排版,量出的行数才一致
    expect(replica.classList.contains("whitespace-pre-wrap")).toBe(true);
    expect(replica.classList.contains("invisible")).toBe(true);

    fireEvent.change(box, { target: { value: "第一行\n第二行\n" } });
    // 尾附空格:值以换行收尾时 pre-wrap 的裸尾换行不渲染,空格把末行撑出来
    await waitFor(() => expect(replica.textContent).toBe("第一行\n第二行\n "));
    expect(box.style.height).toBe("");
  });
});

describe("切会话焦点", () => {
  it("切换任务后焦点落到输入框;重点当前任务不抢焦点", async () => {
    stubShell();
    const { rerender } = render(<ChatView meta={META} />);
    const box = (await ready()) as HTMLTextAreaElement;
    expect(document.activeElement).not.toBe(box); // 首挂载不抢焦点

    // 切到另一任务:焦点落到输入框,可直接开打
    rerender(<ChatView meta={{ ...META, id: "s2", title: "部署" }} />);
    await waitFor(() => expect(document.activeElement).toBe(box));

    // 重点当前任务(同 id 再点一次侧栏行):不抢焦点
    box.blur();
    expect(document.activeElement).not.toBe(box);
    rerender(<ChatView meta={{ ...META, id: "s2", title: "部署" }} />);
    expect(document.activeElement).not.toBe(box);
  });
});
