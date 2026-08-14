import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FrameSender } from "@/lib/ipc/approvals";
import { createChatState } from "@/lib/protocol/reduce";
import type { ChatItem, ChatState } from "@/lib/protocol/types";
import { LogList, reconcileFarRows } from "./LogList";

const mermaidRender = vi.hoisted(() => vi.fn(async () => ({ svg: "<svg></svg>" })));
vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: mermaidRender } }));

afterEach(() => {
  mermaidRender.mockClear();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

function withItems(items: ChatItem[]): ChatState {
  return { ...createChatState(), items };
}

const TOOL: Extract<ChatItem, { kind: "tool" }> = { kind: "tool", tcId: "t1", title: "Bash npm test", status: "run", out: "", rawInput: { command: "npm test" } };

describe("LogList 锚定分发", () => {
  it("perm 带 toolCallId 且有同 id 工具卡:按钮行嵌进工具卡,独立审批卡不渲染", () => {
    const state = withItems([
      TOOL,
      { kind: "perm", id: "p1", title: "npm test", tool: "Bash", state: "open", toolCallId: "t1" },
    ]);
    const { container } = render(<LogList state={state} sessionId="s1" />);
    // 按钮行只出现一次(在工具卡里),独立警示卡不存在
    expect(screen.getAllByRole("button", { name: "允许" })).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
    // 结构契约:直接子元素仍与 items 一一对应(被锚定项是占位 div)
    expect(container.firstElementChild?.children).toHaveLength(2);
  });

  it("无锚(缺 toolCallId / 找不到同 id 工具卡)渲染独立审批卡", () => {
    const state = withItems([
      { kind: "perm", id: "p1", title: "rm -rf x", tool: "Bash", state: "open" },
      { kind: "perm", id: "p2", title: "curl", tool: "Bash", state: "open", toolCallId: "不存在的卡" },
    ]);
    render(<LogList state={state} sessionId="s1" />);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "允许" })).toHaveLength(2);
  });

  it("已决的锚定 perm 不再独立渲染(工具卡状态代言),工具卡也无按钮行", () => {
    const state = withItems([
      { ...TOOL, status: "ok" },
      { kind: "perm", id: "p1", title: "npm test", tool: "Bash", state: "approved", toolCallId: "t1" },
    ]);
    render(<LogList state={state} sessionId="s1" />);
    expect(screen.queryByRole("button", { name: "允许" })).toBeNull();
    expect(screen.queryByText("已允许")).toBeNull();
  });

  it("提问卡与工具卡正常分发", () => {
    const state = withItems([
      TOOL,
      {
        kind: "ask",
        askId: "q1",
        state: "open",
        questions: [{ question: "选哪个?", multiSelect: false, custom: false, options: [{ label: "A" }] }],
      },
    ]);
    render(<LogList state={state} sessionId="s1" />);
    // 工具卡标题经 presentToolCall 拆成「动作 + 目标」
    expect(screen.getByText("执行命令")).toBeTruthy();
    expect(screen.getByText("npm test")).toBeTruthy();
    expect(screen.getByText("需要你的回答")).toBeTruthy();
    expect(screen.getByRole("button", { name: "提交回答" })).toBeTruthy();
  });
});

describe("LogList 系统行居中(H7)", () => {
  it("包裹 div 是 flex 列,sys 条目 self-center 有生效上下文", () => {
    const state = withItems([{ kind: "sys", text: "— 本轮结束 —" }]);
    render(<LogList state={state} sessionId="s1" />);
    const sys = screen.getByText("— 本轮结束 —");
    expect(sys.className).toContain("self-center");
    // 直接包裹层必须是 flex 列(块级包裹层会让 align-self 失效,居中丢失)
    expect(sys.parentElement?.className).toContain("flex");
    expect(sys.parentElement?.className).toContain("flex-col");
  });
});

describe("LogList 系统行按 tag 分流", () => {
  it("turn-end 收敛为呼吸位:不渲染文字,全文留在 title", () => {
    const state = withItems([{ kind: "sys", text: "— 本轮结束 —", tag: "turn-end" }]);
    render(<LogList state={state} sessionId="s1" />);
    expect(screen.queryByText("— 本轮结束 —")).toBeNull();
    expect(screen.getByTitle("— 本轮结束 —")).toBeTruthy();
  });

  it("连续模型切换只渲最后一条;被合并行保占位,结构契约不平移", () => {
    const state = withItems([
      { kind: "sys", text: "模型已切换为 A", tag: "model" },
      { kind: "sys", text: "模型已切换为 B", tag: "model" },
      { kind: "sys", text: "模型已切换为 C", tag: "model" },
    ]);
    const { container } = render(<LogList state={state} sessionId="s1" />);
    expect(screen.queryByText("模型已切换为 A")).toBeNull();
    expect(screen.queryByText("模型已切换为 B")).toBeNull();
    expect(screen.getByText("模型已切换为 C")).toBeTruthy();
    // 直接子元素仍与 items 一一对应(被合并项是占位 div)
    expect(container.firstElementChild?.children).toHaveLength(3);
  });

  it("模型行被其他条目隔断即各自成段,不跨条目合并", () => {
    const state = withItems([
      { kind: "sys", text: "模型已切换为 A", tag: "model" },
      { kind: "agent", text: "中间正文" },
      { kind: "sys", text: "模型已切换为 B", tag: "model" },
    ]);
    render(<LogList state={state} sessionId="s1" />);
    expect(screen.getByText("模型已切换为 A")).toBeTruthy();
    expect(screen.getByText("模型已切换为 B")).toBeTruthy();
  });

  it("error 系统行按 text-error 着色,普通系统行不带", () => {
    const state = withItems([
      { kind: "sys", text: "✗ 配额耗尽", error: true },
      { kind: "sys", text: "📌 后台完成", tag: "notify" },
    ]);
    render(<LogList state={state} sessionId="s1" />);
    expect(screen.getByText("✗ 配额耗尽").className).toContain("text-error");
    expect(screen.getByText("📌 后台完成").className).not.toContain("text-error");
  });
});

describe("消息时间(悬停显影的 <time>)", () => {
  it("用户气泡与 agent 块渲染 dateTime 语义的 HH:MM;缺 timestamp 不渲染", () => {
    // 用「今天」的时刻:fmtClock 跨天会带日期前缀,固定历史日期会随运行日漂移
    const ts = new Date(new Date().setHours(9, 5, 0, 0)).getTime();
    const state = withItems([
      { kind: "user", text: "带时间的提问", seq: 1, timestamp: ts },
      { kind: "agent", text: "带时间的回答", timestamp: ts },
      { kind: "agent", text: "没有时间" },
    ]);
    const { container } = render(<LogList state={state} sessionId="s1" />);
    const times = Array.from(container.querySelectorAll("time"));
    expect(times).toHaveLength(2);
    for (const t of times) {
      expect(t.getAttribute("datetime")).toBe(new Date(ts).toISOString());
      expect(t.textContent).toBe("09:05");
    }
  });
});

describe("思考块(thoughtMarkdown 修复)", () => {
  it("流式连拼的相邻加粗标题拆开渲染,不吞成一个 strong", () => {
    const state = withItems([{ kind: "thought", text: "**先看日志****再改代码**" }]);
    render(<LogList state={state} sessionId="s1" />);
    // 修复生效 = 两个独立的加粗段(吞并时会渲成含 ** 字面量的单个 strong)
    expect(screen.getAllByText("先看日志").some((el) => el.tagName === "STRONG")).toBe(true);
    expect(screen.getAllByText("再改代码").some((el) => el.tagName === "STRONG")).toBe(true);
  });

  it("thought 流结束前暂缓 Mermaid 渲染", async () => {
    const item: ChatItem = { kind: "thought", text: "思考\n\n```mermaid\ngraph TD\nA-->B\n```" };
    const streaming = { ...withItems([item]), streamKind: "thought" as const };
    const { rerender } = render(<LogList state={streaming} sessionId="s1" />);
    await Promise.resolve();
    expect(mermaidRender).not.toHaveBeenCalled();

    rerender(<LogList state={{ ...streaming, streamKind: "" }} sessionId="s1" />);
    await waitFor(() => expect(mermaidRender).toHaveBeenCalledTimes(1));
  });

  it("折叠态摘要行也过 markdown:引擎首行几乎都是 **小标题**,当纯文本贴就是字面量星号", () => {
    const state = withItems([{ kind: "thought", text: "**看日志**\n\n然后改代码" }]);
    const { container } = render(<LogList state={state} sessionId="s1" />);
    const head = container.querySelector("summary")!;
    expect(head.textContent).not.toContain("**"); // 星号不得作为字面量出现在摘要行
    expect(head.querySelector("strong")?.textContent).toBe("看日志");
  });
});

describe("LogList 只读回放(readonly,子会话浮层)", () => {
  it("独立 open 审批收成审计行:无按钮,标「需要确认」", () => {
    const state = withItems([
      { kind: "perm", id: "p1", title: "rm -rf x", tool: "Bash", state: "open" },
    ]);
    render(<LogList state={state} sessionId="c1" readonly />);
    expect(screen.queryByRole("button", { name: "允许" })).toBeNull();
    expect(screen.queryByRole("button", { name: "拒绝" })).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("需要确认")).toBeTruthy();
  });

  it("锚定 open 审批不产生内嵌按钮行,工具卡按常态渲染", () => {
    const state = withItems([
      TOOL,
      { kind: "perm", id: "p1", title: "npm test", tool: "Bash", state: "open", toolCallId: "t1" },
    ]);
    const { container } = render(<LogList state={state} sessionId="c1" readonly />);
    expect(screen.queryByRole("button", { name: "允许" })).toBeNull();
    expect(screen.queryByText("需要确认")).toBeNull();
    // 结构契约不平移:被锚定项仍是占位 div
    expect(container.firstElementChild?.children).toHaveLength(2);
  });

  it("open 提问卡按只读摘要渲染,不出作答表单", () => {
    const state = withItems([
      {
        kind: "ask",
        askId: "q1",
        state: "open",
        questions: [{ question: "选哪个?", multiSelect: false, custom: false, options: [{ label: "A" }] }],
      },
    ]);
    render(<LogList state={state} sessionId="c1" readonly />);
    expect(screen.queryByRole("button", { name: "提交回答" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("选哪个?")).toBeTruthy();
    expect(screen.getAllByText("未回答").length).toBeGreaterThan(0);
  });
});

describe("LogList 子会话入口(onOpenChildSession)", () => {
  it("工具卡带 childSessionId 且传了回调:入口可点并回传 id", async () => {
    const opened: string[] = [];
    const state = withItems([{ ...TOOL, childSessionId: "c1" }]);
    render(<LogList state={state} sessionId="s1" onOpenChildSession={(id) => opened.push(id)} />);
    await userEvent.click(screen.getByRole("button", { name: "查看子会话" }));
    expect(opened).toEqual(["c1"]);
  });

  it("缺 childSessionId 或缺回调:不渲染入口", () => {
    const { rerender } = render(
      <LogList state={withItems([TOOL])} sessionId="s1" onOpenChildSession={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "查看子会话" })).toBeNull();
    rerender(<LogList state={withItems([{ ...TOOL, childSessionId: "c1" }])} sessionId="s1" />);
    expect(screen.queryByRole("button", { name: "查看子会话" })).toBeNull();
  });
});

describe("LogList 上行管道注入(sendFrame)", () => {
  it("审批(工具卡锚定)与提问答复都走注入的 sendFrame,不触本地 IPC", async () => {
    const sent: { ftype: string; payload: Record<string, unknown> }[] = [];
    const sendFrame: FrameSender = (ftype, payload) => {
      sent.push({ ftype, payload });
      return Promise.resolve();
    };
    const state = withItems([
      TOOL,
      { kind: "perm", id: "p1", title: "npm test", tool: "Bash", state: "open", toolCallId: "t1" },
      {
        kind: "ask",
        askId: "q1",
        state: "open",
        questions: [{ question: "选哪个?", multiSelect: false, custom: false, options: [{ label: "A" }] }],
      },
    ]);
    render(<LogList state={state} sessionId="cloud-task-1" sendFrame={sendFrame} />);

    await userEvent.click(screen.getByRole("button", { name: "允许" }));
    await userEvent.click(screen.getByRole("radio", { name: "A" }));
    await userEvent.click(screen.getByRole("button", { name: "提交回答" }));

    expect(sent).toEqual([
      { ftype: "permission-resp", payload: { id: "p1", approved: true, remember: false, persist: false } },
      {
        ftype: "reply-question",
        payload: { request_id: "q1", answers_json: JSON.stringify({ "选哪个?": "A" }), cancelled: false },
      },
    ]);
    // 乐观置态成立 = 走的确是注入 sender:本地 IPC 在非壳环境必 reject 回滚
    expect(screen.getByText("已允许")).toBeTruthy();
    expect(screen.getByText("A").closest(".chat-end")).toBeTruthy(); // 答案按用户消息形态收卡
  });
});

describe("用户气泡附件呈现(附件行约定)", () => {
  const TEXT = "看看这个\n[图片] .monkeycode/uploads/a.png\n[文件] .monkeycode/uploads/b.txt";

  it("有 uploadUrl:附件行剥离,图片缩略图 + 文件 chip;点图开大图浮层", async () => {
    const uploadUrl = (p: string) => Promise.resolve(`data:image/png;base64,${p.length}`);
    const state = withItems([{ kind: "user", text: TEXT, seq: 1 }]);
    render(<LogList state={state} sessionId="s1" uploadUrl={uploadUrl} />);

    expect(screen.getByText("看看这个")).toBeTruthy();
    // 附件行不再出现在气泡正文
    expect(screen.queryByText(/\[图片\]/)).toBeNull();
    expect(screen.queryByText(/\[文件\]/)).toBeNull();
    // 图片按路径为 alt 异步渲染;文件 chip 以文件名成钮
    const img = await screen.findByRole("img", { name: ".monkeycode/uploads/a.png" });
    expect(img.getAttribute("src")).toMatch(/^data:image\/png/);
    expect(screen.getByRole("button", { name: "b.txt" })).toBeTruthy();

    await userEvent.click(img);
    expect(await screen.findByRole("dialog", { name: ".monkeycode/uploads/a.png" })).toBeTruthy();
  });

  it("无 uploadUrl(云端/无通道):正文原样,不剥附件行", () => {
    const state = withItems([{ kind: "user", text: TEXT, seq: 1 }]);
    render(<LogList state={state} sessionId="s1" />);
    expect(screen.getByText(/\[图片\] \.monkeycode\/uploads\/a\.png/)).toBeTruthy();
  });

  it("云端 attachments:图片直链渲染,文件 chip 走浏览器打开语义", () => {
    const state = withItems([
      {
        kind: "user",
        text: "带附件",
        seq: 2,
        attachments: [
          { url: "https://oss/x.png", filename: "x.png" },
          { url: "https://oss/y.pdf", filename: "y.pdf" },
        ],
      },
    ]);
    render(<LogList state={state} sessionId="cloud-1" />);
    const img = screen.getByRole("img", { name: "x.png" });
    expect(img.getAttribute("src")).toBe("https://oss/x.png");
    expect(screen.getByRole("button", { name: "y.pdf" })).toBeTruthy();
  });
});

describe("思考块", () => {
  it("带首片时间(hover 显影 <time>);展开指示与工具卡同语言(无 collapse-arrow)", () => {
    const ts = new Date(new Date().setHours(9, 5, 0, 0)).getTime();
    const state = withItems([{ kind: "thought", text: "先看日志", timestamp: ts }]);
    const { container } = render(<LogList state={state} sessionId="s1" />);
    expect(container.querySelector("time")?.textContent).toBe("09:05");
    expect(container.querySelector(".collapse-arrow")).toBeNull(); // 统一为行尾 chevron
  });

  it("正文引用条内嵌一层,不挂 collapse-content 自身(大圆角主题下不戳出卡片轮廓)", () => {
    const state = withItems([{ kind: "thought", text: "先看日志" }]);
    const { container } = render(<LogList state={state} sessionId="s1" />);
    const content = container.querySelector(".collapse-content");
    expect(content).toBeTruthy();
    // 挂在 collapse-content 上 = 与卡片边缘齐平,而 daisyUI .collapse 有圆角却不裁剪子元素,
    // --radius-box 大的主题下这条直线会戳出左下圆角轮廓(形态与 ToolCard 子代理结果一致)
    expect(content!.classList.contains("border-s-2")).toBe(false);
    expect(content!.querySelector(".border-s-2")).toBeTruthy();
  });

  it("行首 Sparkles 与工具行状态点同轴:必须覆盖 collapse-title 自带的 1rem 左内距", () => {
    const state = withItems([{ kind: "thought", text: "先看日志" }]);
    const { container } = render(<LogList state={state} sessionId="s1" />);
    const summary = container.querySelector(".collapse-title");
    // daisyUI .collapse-title 是 padding:1rem;只覆 py/pe 会留 16px 左内距,
    // 而工具卡/组头是 px-3(12px)+ 8px 点 → 点心落 16px。12px 图标要同轴,
    // 左内距必须是 16-6=10px(ps-2.5),否则两种行首图标错位
    expect(summary!.classList.contains("ps-2.5")).toBe(true);
  });
});

describe("工具组聚合(摘要头 + 开合)", () => {
  const tools = (n: number, runLast = false): ChatItem[] =>
    Array.from({ length: n }, (_, i) => ({
      kind: "tool" as const,
      tcId: `t${i + 1}`,
      title: "Bash",
      status: runLast && i === n - 1 ? ("run" as const) : ("ok" as const),
      out: "",
      rawInput: { command: `step${i + 1}` },
    }));

  it("≥3 张终态组:默认收成摘要头「N 步 · 动作 ×N」;点开合", async () => {
    const state = withItems(tools(4));
    const { container } = render(<LogList state={state} sessionId="s1" />);
    // 结构契约:包裹层仍与 items 一一对应
    expect(container.firstElementChild?.children).toHaveLength(4);
    const header = screen.getByRole("button", { name: "工具调用组" });
    expect(header.textContent).toContain("4 步");
    expect(header.textContent).toContain("执行命令 ×4");
    expect(screen.queryByText("step1")).toBeNull(); // 成员收起

    await userEvent.click(header);
    expect(screen.getByText("step1")).toBeTruthy();
    expect(screen.getByText("step4")).toBeTruthy();
    expect(container.firstElementChild?.children).toHaveLength(4);

    await userEvent.click(screen.getByRole("button", { name: "工具调用组" }));
    expect(screen.queryByText("step1")).toBeNull();
  });

  it("摘要头状态点走降调口径:不吃全强度语义色,也不留 --depth 的高光/投影", () => {
    const state = withItems(tools(4));
    const { container } = render(<LogList state={state} sessionId="s1" />);
    const dot = container.querySelector(".status");
    expect(dot).toBeTruthy();
    // status-success 一类是 background-color:var(--color-success) 直上,主题里
    // 这个值可以是 oklch(84% .143) 那种荧光薄荷,8px 的点亮得刺眼(报障 2026-08-06)
    expect(dot!.className).not.toMatch(/status-(success|error|warning|primary|neutral)\b/);
    expect(dot!.classList.contains("bg-none")).toBe(true); // 关掉 --depth:1 主题的白高光
    expect(dot!.classList.contains("shadow-none")).toBe(true); // 关掉同色投影
  });

  it("组内有运行中的卡:默认展开(当前动作要看得到)", () => {
    const { container } = render(<LogList state={withItems(tools(4, true))} sessionId="s1" />);
    expect(screen.getByText("step4")).toBeTruthy(); // 运行中的那张可见
    expect(screen.getByRole("button", { name: "工具调用组" })).toBeTruthy();
    // 运行态的闪动是「还在跑」的唯一动态提示,降调配色不能顺手把它抹掉
    const dots = [...container.querySelectorAll(".status")];
    expect(dots.some((d) => d.classList.contains("animate-pulse"))).toBe(true);
  });

  it("2 张不聚合(普通共享外框)", () => {
    render(<LogList state={withItems(tools(2))} sessionId="s1" />);
    expect(screen.queryByRole("button", { name: "工具调用组" })).toBeNull();
    expect(screen.getByText("step1")).toBeTruthy();
    expect(screen.getByText("step2")).toBeTruthy();
  });
});

describe("块上方消息时间(悬停显影)", () => {
  it("工具块:组首卡上方有时间线,组中卡不插时间(不撕共享外框)", () => {
    const ts = new Date(new Date().setHours(14, 30, 0, 0)).getTime();
    const state = withItems([
      { kind: "tool", tcId: "t1", title: "Bash", status: "ok", out: "", rawInput: { command: "a" }, timestamp: ts },
      { kind: "tool", tcId: "t2", title: "Bash", status: "ok", out: "", rawInput: { command: "b" }, timestamp: ts + 60000 },
    ]);
    const { container } = render(<LogList state={state} sessionId="s1" />);
    const times = container.querySelectorAll("time");
    expect(times).toHaveLength(1); // 只有组首
    expect(times[0]?.textContent).toBe("14:30");
  });
});

describe("行级 memo(性能契约,2026-08-10 用户报障「长会话非常卡」)", () => {
  // 流式期间壳每 ~30ms 换一次 state,行组件必须按条目引用比对跳过。这里用
  // markdown 产物的 DOM 节点身份做探针:agent 行若被重渲染,dangerouslySetInnerHTML
  // 的容器会换新子树;memo 打中则整棵子树原样保留(同一个节点对象)。
  it("追加新条目重渲染:未变的行保持同一 DOM 子树(memo 打中)", () => {
    const agent: ChatItem = { kind: "agent", text: "**旧消息**不该被重渲染" };
    const first = withItems([agent]);
    const { container, rerender } = render(<LogList state={first} sessionId="s1" />);
    const probe = container.querySelector(".md strong");
    expect(probe?.textContent).toBe("旧消息");

    // 归约层契约:追加只换 items 数组,未触碰的条目对象引用不变(reduce.ts
    // pushItem)。新 state 整体换新——只有这样才测得到「行没跟着整列重渲」
    const second: ChatState = { ...first, items: [...first.items, { kind: "sys", text: "轮次结束", tag: "turn-end" }] };
    rerender(<LogList state={second} sessionId="s1" />);
    expect(container.querySelector(".md strong")).toBe(probe);
  });

  it("流式尾部条目变了:该行重渲染,前面的行仍不动", async () => {
    const agent: ChatItem = { kind: "agent", text: "**首段**" };
    const first: ChatState = { ...withItems([agent, { kind: "agent", text: "尾段" }]), streamKind: "agent" };
    const { container, rerender } = render(<LogList state={first} sessionId="s1" />);
    const probe = container.querySelector(".md strong");

    // appendStream 语义:尾项换新对象,首项引用照旧
    const second: ChatState = { ...first, items: [agent, { kind: "agent", text: "尾段又长了一截" }] };
    rerender(<LogList state={second} sessionId="s1" />);
    // 尾段文字要等 Markdown 的流式节流放行(useThrottled 150ms,防每批帧
    // 全文重解析)——异步断言,不钉具体时长
    expect(await screen.findByText("尾段又长了一截")).toBeTruthy();
    expect(container.querySelector(".md strong")).toBe(probe);
  });

  it("工具组组首:成员引用未变时不重算摘要(GroupHead memo 打中)", () => {
    const group: ChatItem[] = [1, 2, 3].map((i) => ({
      kind: "tool",
      tcId: `t${i}`,
      title: `Read step${i}`,
      status: "ok",
      out: "",
      rawInput: { file_path: `/a/step${i}` },
    }));
    const first = withItems(group);
    const { rerender } = render(<LogList state={first} sessionId="s1" />);
    const head = screen.getByRole("button", { name: "工具调用组" });
    const label = head.querySelector("span.truncate");

    const second: ChatState = { ...first, items: [...group, { kind: "agent", text: "组后新消息" }] };
    rerender(<LogList state={second} sessionId="s1" />);
    // 组首整行未重渲染:摘要 span 还是同一个节点
    expect(screen.getByRole("button", { name: "工具调用组" }).querySelector("span.truncate")).toBe(label);
  });
});

describe("远行降档(data-far 分带,性能契约)", () => {
  // c-v:auto 的视口相关性跟踪按元素计费,几千行会话打字每键 70~180ms
  // (2026-08-10 定案,机制见 LogList 分带 effect 头注)。这里 mock 行几何
  // 钉住分带行为:视口 ±2 屏内保留 auto(无属性),更远打 data-far。
  it("视口带内的行无 data-far,远行有;滚动语义由 rect 决定", async () => {
    const items: ChatItem[] = Array.from({ length: 8 }, (_, i) => ({
      kind: "agent" as const,
      text: `第 ${i} 条`,
    }));
    const { container } = render(<LogList state={withItems(items)} sessionId="s1" />);
    const root = container.firstElementChild!;
    expect(root.children).toHaveLength(8);
    // jsdom innerHeight=768;带 = [-1536, 2304]。行高 400,按 top 摆位:
    // bottom < -1536 的远上方(0~3)与 top > 2304 的远下方(7)打标,
    // 4/5/6 在带内保留 auto
    const tops = [-9000, -8600, -5000, -3000, 0, 300, 700, 2500];
    [...root.children].forEach((el, i) => {
      (el as HTMLElement).getBoundingClientRect = () =>
        ({ top: tops[i]!, bottom: tops[i]! + 400, left: 0, right: 100, width: 100, height: 400 }) as DOMRect;
    });
    window.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const marked = [...root.children].map((el) => el.hasAttribute("data-far"));
    expect(marked).toEqual([true, true, true, true, false, false, false, true]);
  });

  it("jsdom 默认零几何 = 全部视作带内,不打标(测试环境 no-op 契约)", async () => {
    const items: ChatItem[] = [{ kind: "agent", text: "甲" }, { kind: "agent", text: "乙" }];
    const { container } = render(<LogList state={withItems(items)} sessionId="s1" />);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    expect(container.querySelectorAll("[data-far]")).toHaveLength(0);
  });
});

describe("LogList 远行高度兑现", () => {
  function fixture(top = 100, height = 500) {
    const log = document.createElement("div");
    log.dataset.chatLog = "";
    const root = document.createElement("div");
    root.dataset.chatItems = "";
    log.append(root);
    document.body.append(log);
    Object.defineProperty(log, "getBoundingClientRect", {
      value: () => ({ top, bottom: top + height, height }),
    });
    return { log, root };
  }

  it("非零 top 日志容器中，上方长行兑现后视觉锚点不变且恢复 overflowAnchor", () => {
    const { log, root } = fixture();
    const upper = document.createElement("div");
    const anchor = document.createElement("div");
    upper.dataset.far = "";
    anchor.dataset.near = "";
    root.append(upper, anchor);
    log.scrollTop = 100;
    log.style.overflowAnchor = "auto";
    Object.defineProperty(upper, "getBoundingClientRect", {
      value: () => ({ top: 20, bottom: upper.hasAttribute("data-near") ? 280 : 80 }),
    });
    Object.defineProperty(anchor, "getBoundingClientRect", {
      value: () => {
        const top = 120 + (upper.hasAttribute("data-near") ? 200 : 0) - (log.scrollTop - 100);
        return { top, bottom: top + 80 };
      },
    });

    reconcileFarRows(root, 9999);

    expect(log.scrollTop).toBe(300);
    expect(anchor.getBoundingClientRect().top).toBe(120);
    expect(log.style.overflowAnchor).toBe("auto");
    log.remove();
  });

  it("探顶的未兑现占位行自身长高时,钉视口内首条行界补偿(上滚回滚报障)", () => {
    const { log, root } = fixture();
    const poke = document.createElement("div"); // 60px 占位,顶部探进视口
    const reading = document.createElement("div"); // 用户正在读的行
    poke.dataset.far = "";
    reading.dataset.near = "";
    root.append(poke, reading);
    log.scrollTop = 100;
    Object.defineProperty(poke, "getBoundingClientRect", {
      value: () => {
        const top = 60 - (log.scrollTop - 100);
        return { top, bottom: top + (poke.hasAttribute("data-near") ? 1000 : 60) };
      },
    });
    Object.defineProperty(reading, "getBoundingClientRect", {
      value: () => {
        const top = 120 + (poke.hasAttribute("data-near") ? 940 : 0) - (log.scrollTop - 100);
        return { top, bottom: top + 80 };
      },
    });

    reconcileFarRows(root, 9999);

    // 锚点若取首个相交行(poke),其 top 不因自身长高移动,delta 恒为 0,
    // reading 会被推到视口外——正是报障的「突然回滚」。
    expect(log.scrollTop).toBe(1040);
    expect(reading.getBoundingClientRect().top).toBe(120);
    log.remove();
  });

  it("一次读取所有行后才批量写，多行分类不受前行兑现影响且使用日志视口高度", () => {
    const { log, root } = fixture(200, 100);
    const first = document.createElement("div");
    const second = document.createElement("div");
    first.dataset.far = "";
    second.dataset.far = "";
    root.append(first, second);
    Object.defineProperty(first, "getBoundingClientRect", { value: () => ({ top: 50, bottom: 80 }) });
    Object.defineProperty(second, "getBoundingClientRect", {
      value: () => ({
        // 若实现边测边写，first 已 near，第二行会漂进带内；快照应保持原始 550。
        top: first.hasAttribute("data-near") ? 250 : 550,
        bottom: first.hasAttribute("data-near") ? 280 : 580,
      }),
    });

    reconcileFarRows(root, 10_000);

    expect(first.hasAttribute("data-near")).toBe(true);
    expect(second.hasAttribute("data-far")).toBe(true);
    expect(second.hasAttribute("data-near")).toBe(false);
    log.remove();
  });

  it("稳定 pass 不写 scrollTop，也不触发二次布局", () => {
    const { log, root } = fixture();
    const row = document.createElement("div");
    row.dataset.near = "";
    root.append(row);
    let rectReads = 0;
    Object.defineProperty(row, "getBoundingClientRect", {
      value: () => {
        rectReads++;
        return { top: 120, bottom: 180 };
      },
    });
    let scrollWrites = 0;
    Object.defineProperty(log, "scrollTop", {
      get: () => 40,
      set: () => { scrollWrites++; },
    });

    reconcileFarRows(root);

    expect(rectReads).toBe(1);
    expect(scrollWrites).toBe(0);
    expect(log.style.overflowAnchor).toBe("");
    log.remove();
  });

  it("锚点跳过 display:none 的零盒", () => {
    const { log, root } = fixture();
    const zero = document.createElement("div");
    const visible = document.createElement("div");
    root.append(zero, visible);
    Object.defineProperty(zero, "getBoundingClientRect", { value: () => ({ top: 0, bottom: 0 }) });
    Object.defineProperty(visible, "getBoundingClientRect", { value: () => ({ top: 120, bottom: 180 }) });
    reconcileFarRows(root);
    expect(visible.hasAttribute("data-near")).toBe(true);
    expect(log.style.overflowAnchor).toBe("");
    log.remove();
  });
});
