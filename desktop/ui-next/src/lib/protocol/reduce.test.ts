// reduce.ts 归约器单测:帧 → 对话流渲染项的全部状态转移。
// 用例移植自旧工程 ui/src/reduce.test.ts(行为契约资产,覆盖一条不能少),
// 断言按新状态模型改写;文末追加新实现的边界用例(seq 去重/itemKey)。
// 帧构造与壳下行新格式一致(data = 内联 JSON 对象);旧格式(base64(JSON)
// 字符串)的容错回归用例见「旧格式帧兼容」。
import { describe, expect, it } from "vitest";

import { b64encode } from "./codec";
import {
  answerAsk,
  answerPerm,
  createChatState,
  itemKey,
  permAnchors,
  permStateKey,
  prependHistory,
  reduceBatch,
  reduceFrame,
  timelineDeltaOf,
} from "./reduce";
import type { AcpUpdate, AskItem, ChatItem, ChatState, Frame, PermItem, SysItem, ToolItem, ToolProgress } from "./types";

const frame = (type: string, data?: unknown, kind?: string): Frame => ({
  type,
  ...(kind ? { kind } : {}),
  ...(data !== undefined ? { data } : {}),
});

const acp = (update: Partial<AcpUpdate>): Frame => frame("task-running", { update }, "acp_event");

const run = (frames: Frame[]) => reduceBatch(createChatState(), frames);

const toolItem = (s: ChatState, tcId: string) =>
  s.items.find((it) => it.kind === "tool" && it.tcId === tcId) as ToolItem;

describe("流式文本聚合", () => {
  it("连续 agent 块合并为一项", () => {
    const s = run([
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "你好" } }),
      acp({ sessionUpdate: "agent_message_chunk", content: { text: ",世界" } }),
    ]);
    expect(s.items).toEqual([{ kind: "agent", text: "你好,世界" }]);
  });

  it("流式 agent 消息保留首个分片的时间", () => {
    const s = run([
      { ...acp({ sessionUpdate: "agent_message_chunk", content: { text: "你好" } }), timestamp: 1_000 },
      { ...acp({ sessionUpdate: "agent_message_chunk", content: { text: ",世界" } }), timestamp: 2_000 },
    ]);
    expect(s.items).toEqual([{ kind: "agent", text: "你好,世界", timestamp: 1_000 }]);
  });

  it("thought 与 agent 互不合并", () => {
    const s = run([
      acp({ sessionUpdate: "agent_thought_chunk", content: { text: "想" } }),
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "说" } }),
      acp({ sessionUpdate: "agent_thought_chunk", content: { text: "再想" } }),
    ]);
    expect(s.items.map((it) => it.kind)).toEqual(["thought", "agent", "thought"]);
  });

  it("被非流式项打断后新开一项,不并入旧项", () => {
    const s = run([
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "前" } }),
      acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "读取 a.txt" }),
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "后" } }),
    ]);
    expect(s.items.map((it) => it.kind)).toEqual(["agent", "tool", "agent"]);
    expect((s.items[2] as Extract<ChatItem, { kind: "agent" }>).text).toBe("后");
  });
});

describe("时间线增量 sidecar", () => {
  it("纯流式批次精确标记尾行，不为万级历史重新做全量投影", () => {
    const items: ChatItem[] = [
      ...Array.from({ length: 10_000 }, (_, index) => ({ kind: "sys" as const, text: String(index) })),
      { kind: "agent", text: "前" },
    ];
    const previous: ChatState = { ...createChatState(), items, streamKind: "agent" };
    const next = reduceBatch(previous, [
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "后" } }),
    ]);
    expect(next.items.at(-1)).toEqual({ kind: "agent", text: "前后" });
    expect(timelineDeltaOf(next)).toEqual({
      from: previous,
      kind: "update",
      changed: [10_000],
    });
  });

  it("只改会话元数据时标记 meta 且 changed 为空", () => {
    const previous: ChatState = {
      ...createChatState(),
      items: Array.from({ length: 2_000 }, (_, index) => ({ kind: "sys" as const, text: String(index) })),
    };
    const next = reduceBatch(previous, [acp({ sessionUpdate: "usage_update", used: 1, size: 10 })]);
    expect(timelineDeltaOf(next)).toEqual({ from: previous, kind: "meta", changed: [] });
  });

  it("连续快照只保留直接前驱，不把流式状态串成强引用长链", () => {
    const first = reduceBatch(createChatState(), [
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "一" } }),
    ]);
    const second = reduceBatch(first, [
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "二" } }),
    ]);
    expect(timelineDeltaOf(first)).toBeUndefined();
    expect(timelineDeltaOf(second)?.from).toBe(first);
  });
});

describe("工具调用生命周期", () => {
  it("tool_call 创建运行中卡片,标题缺省回退", () => {
    const s = run([acp({ sessionUpdate: "tool_call", toolCallId: "t1", kind: "read" })]);
    expect(toolItem(s, "t1")).toMatchObject({ title: "read", status: "run", out: "" });
  });

  it("tool_call 保留完整 rawInput 供展示层使用", () => {
    const rawInput = { file_path: "/repo/.ohmyagent/worktrees/wt/internal/agent/loop.go" };
    const s = run([acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Read /repo/.ohmyagent", rawInput })]);
    expect(toolItem(s, "t1").rawInput).toEqual(rawInput);
  });

  it("云端工具跨状态帧保留结构化详情并合并 metadata", () => {
    const content = [{ type: "content", content: { type: "text", text: "流式正文" } }];
    const rawOutput = { output: "文件正文\n第二行" };
    const locations = [{ path: "/workspace/src/app.ts", line: 3 }];
    const s = run([
      acp({
        sessionUpdate: "tool_call",
        toolCallId: "cloud-read",
        title: "opencode_read",
        kind: "read",
        rawInput: { filePath: "/workspace/src/app.ts" },
        _meta: { provider: { requestId: "req-1" } },
      }),
      acp({
        sessionUpdate: "tool_call_update",
        toolCallId: "cloud-read",
        status: "in_progress",
        content,
        _meta: { provider: { phase: "reading" } },
      }),
      acp({
        sessionUpdate: "tool_call_update",
        toolCallId: "cloud-read",
        status: "completed",
        rawOutput,
        locations,
      }),
    ]);
    expect(toolItem(s, "cloud-read")).toMatchObject({
      toolKind: "read",
      rawInput: { filePath: "/workspace/src/app.ts" },
      rawOutput,
      content,
      locations,
      _meta: { provider: { requestId: "req-1", phase: "reading" } },
      status: "ok",
      out: "文件正文",
      result: "文件正文\n第二行",
    });
  });

  it("云端历史把终态直接放在 tool_call 时立即闭合卡片", () => {
    const s = run([
      acp({
        sessionUpdate: "tool_call",
        toolCallId: "cloud-complete",
        title: "read",
        kind: "read",
        status: "completed",
        rawInput: { filePath: "/workspace/a.ts" },
        rawOutput: { output: "const a = 1" },
      }),
    ]);
    expect(toolItem(s, "cloud-complete")).toMatchObject({ status: "ok", out: "const a = 1", result: "const a = 1" });
  });

  it("起止帧都有时间时记录工具最终耗时", () => {
    const s = run([
      { ...acp({ sessionUpdate: "tool_call", toolCallId: "timed", title: "Read a.txt" }), timestamp: 1_000 },
      { ...acp({ sessionUpdate: "tool_call_update", toolCallId: "timed", status: "completed" }), timestamp: 2_250 },
    ]);
    expect(toolItem(s, "timed")).toMatchObject({ startedAt: 1_000, durationMs: 1_250 });
  });

  it("completed 置 ok,rawOutput 取首行且截断 160 字符", () => {
    const long = "x".repeat(200) + "\n第二行";
    const s = run([
      acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "执行 ls" }),
      acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: long }),
    ]);
    expect(toolItem(s, "t1").status).toBe("ok");
    expect(toolItem(s, "t1").out).toBe("x".repeat(160));
  });

  it("completed 保留完整 rawOutput 到 result(子代理卡全文 markdown 展示)", () => {
    const full = "# 结论\n第一行摘要\n完整正文…";
    const s = run([
      acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Agent 排查问题" }),
      acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: full }),
    ]);
    expect(toolItem(s, "t1").result).toBe(full);
    expect(toolItem(s, "t1").out).toBe("# 结论");
  });

  it("非 completed 终态置 fail;结束时清掉 lastLine", () => {
    const progress: ToolProgress = { kind: "output", line: "运行中输出…" };
    const s = run([
      acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "执行 job" }),
      acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress", progress }),
      acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed", rawOutput: "boom" }),
    ]);
    expect(toolItem(s, "t1")).toMatchObject({ status: "fail", out: "boom", lastLine: undefined });
  });

  it("更新只落在匹配 tcId 的卡片上", () => {
    const s = run([
      acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "A" }),
      acp({ sessionUpdate: "tool_call", toolCallId: "t2", title: "B" }),
      acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" }),
    ]);
    expect(toolItem(s, "t1").status).toBe("ok");
    expect(toolItem(s, "t2").status).toBe("run");
  });
});

describe("执行期进度(in_progress progress)", () => {
  const open = acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "task 子代理" });
  const prog = (progress: ToolProgress): Frame =>
    acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress", progress });

  it("subagent_tool 按 id 追加与原地更新,标题缺省保留旧值", () => {
    const rawInput = { file_path: "/repo/internal/agent/loop.go" };
    const s = run([
      open,
      prog({ kind: "subagent_tool", id: "s1", title: "读取 a.txt", rawInput, status: "run" }),
      prog({ kind: "subagent_tool", id: "s1", status: "ok" }),
    ]);
    expect(toolItem(s, "t1").feed).toEqual([{ kind: "tool", id: "s1", title: "读取 a.txt", rawInput, status: "ok" }]);
  });

  it("subagent_text 追加文本行,空行忽略", () => {
    const s = run([open, prog({ kind: "subagent_text", line: "第一行" }), prog({ kind: "subagent_text" })]);
    expect(toolItem(s, "t1").feed).toEqual([{ kind: "text", text: "第一行" }]);
  });

  it("进度窗口封顶 200 条,旧条目滚出", () => {
    const frames: Frame[] = [open];
    for (let i = 0; i < 205; i++) frames.push(prog({ kind: "subagent_text", line: "line" + i }));
    const feed = toolItem(run(frames), "t1").feed!;
    expect(feed).toHaveLength(200);
    expect(feed[0]).toEqual({ kind: "text", text: "line5" });
    expect(feed[199]).toEqual({ kind: "text", text: "line204" });
  });

  it("output 覆写 lastLine;child_session 记录子会话 ID", () => {
    const s = run([
      open,
      prog({ kind: "output", line: "旧行" }),
      prog({ kind: "output", line: "新行" }),
      prog({ kind: "child_session", childSessionId: "c1" }),
    ]);
    expect(toolItem(s, "t1")).toMatchObject({ lastLine: "新行", childSessionId: "c1" });
  });

  it("找不到对应工具卡时不改状态", () => {
    const s0 = run([open]);
    const s1 = reduceFrame(s0, prog({ kind: "output", line: "x" }));
    const miss = reduceFrame(
      s1,
      acp({
        sessionUpdate: "tool_call_update",
        toolCallId: "无此ID",
        status: "in_progress",
        progress: { kind: "output", line: "y" },
      }),
    );
    expect(miss).toBe(s1);
  });
});

describe("SendMessage 后台续跑", () => {
  const open = acp({
    sessionUpdate: "tool_call",
    toolCallId: "sm1",
    title: "SendMessage",
    status: "in_progress",
    rawInput: { to: "worker", summary: "继续实现" },
  });
  const running = acp({
    sessionUpdate: "tool_call_update",
    toolCallId: "sm1",
    status: "in_progress",
    progress: { kind: "background_agent", agentId: "a1", status: "running" },
  });
  const launched = acp({
    sessionUpdate: "tool_call_update",
    toolCallId: "sm1",
    status: "completed",
    rawOutput: "后台代理已继续执行，完成后将在对话中显示结果卡",
  });

  it("派发回执保留运行态和 agentId", () => {
    const s = run([open, running, launched]);
    expect(toolItem(s, "sm1")).toMatchObject({
      status: "run",
      background: true,
      backgroundAgentId: "a1",
      outKey: "chat.tool.bgRunning",
    });
  });

  it("匹配的完成通知关闭运行卡并在到达位置追加结果卡", () => {
    const before = acp({ sessionUpdate: "agent_message_chunk", content: { text: "主代理继续工作" } });
    const notification = acp({
      sessionUpdate: "task_notification",
      agentId: "a1",
      agentName: "worker",
      description: "继续实现",
      status: "completed",
      result: "续跑完成",
      text: "后台代理已完成",
    });
    const s = run([open, running, launched, before, notification]);
    expect(toolItem(s, "sm1")).toMatchObject({
      status: "ok",
      background: true,
      backgroundAgentId: "a1",
      outKey: "chat.tool.bgDone",
    });
    expect(toolItem(s, "sm1").result).toBeUndefined();
    expect(s.items.map((it) => it.kind)).toEqual(["tool", "agent", "background-result"]);
  });

  it("其他 agent 的通知不会关闭当前运行卡", () => {
    const s = run([
      open,
      running,
      launched,
      acp({
        sessionUpdate: "task_notification",
        agentId: "a2",
        status: "error",
        result: "另一个任务失败",
        text: "后台代理执行失败",
      }),
    ]);
    expect(toolItem(s, "sm1")).toMatchObject({ status: "run", backgroundAgentId: "a1" });
    expect(s.items.at(-1)).toMatchObject({ kind: "background-result", agentId: "a2" });
  });
});

describe("后台子代理(Agent 显式转后台)", () => {
  const open = acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Agent 后台调查" });
  // 驱动侧 async_launched 的友好文案闭卡
  const launched = acp({
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
    rawOutput: "⏳ 子代理已转入后台继续执行(bd),完成后结果将回填此卡",
  });

  it("结构化 task_notification 独立成结果卡,不并入流式中的正文气泡", () => {
    const notification = acp({
      sessionUpdate: "task_notification",
      agentId: "bd",
      agentName: "调查员",
      description: "调查依赖",
      status: "completed",
      result: "最终结论",
      text: "后台代理已完成",
    });
    notification.timestamp = 1234;
    const s = run([
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "我先做别的" } }),
      notification,
      acp({ sessionUpdate: "agent_message_chunk", content: { text: ",继续" } }),
    ]);
    expect(s.items.map((it) => it.kind)).toEqual(["agent", "background-result", "agent"]);
    expect(s.items[1]).toMatchObject({
      kind: "background-result",
      agentId: "bd",
      agentName: "调查员",
      description: "调查依赖",
      status: "completed",
      result: "最终结论",
      text: "后台代理已完成",
      timestamp: 1234,
    });
  });

  it("旧版纯 text task_notification 仍渲染独立系统行", () => {
    const s = run([
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "前" } }),
      acp({ sessionUpdate: "task_notification", text: "📌 后台代理 bd 已完成" }),
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "后" } }),
    ]);
    expect(s.items.map((it) => it.kind)).toEqual(["agent", "sys", "agent"]);
    expect((s.items[1] as SysItem).text).toContain("bd");
    // 无结构字段也无 text 时忽略
    expect(reduceFrame(s, acp({ sessionUpdate: "task_notification" })).items).toHaveLength(3);
  });

  it("转后台后卡片保持运行态并继续接受进度直播", () => {
    const s = run([
      open,
      launched,
      acp({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "in_progress",
        progress: { kind: "subagent_text", line: "后台仍在跑" },
      }),
      acp({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "in_progress",
        progress: { kind: "child_session", childSessionId: "c1" },
      }),
    ]);
    expect(toolItem(s, "t1")).toMatchObject({ status: "run", outKey: "chat.tool.bgRunning", background: true, childSessionId: "c1" });
    expect(toolItem(s, "t1").result).toBeUndefined();
    expect(toolItem(s, "t1").feed).toEqual([{ kind: "text", text: "后台仍在跑" }]);
  });

  it("后台终态保留工具卡并追加独立结构化结果卡", () => {
    const s = run([
      open,
      launched,
      acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: "最终结论正文" }),
      acp({
        sessionUpdate: "task_notification",
        agentId: "bd",
        agentName: "调查员",
        description: "调查依赖",
        status: "completed",
        result: "最终结论正文",
        text: "📌 后台代理 bd 已完成",
      }),
    ]);
    expect(toolItem(s, "t1")).toMatchObject({
      status: "ok",
      outKey: "chat.tool.bgDone",
      result: "最终结论正文",
      backgroundNoticePending: false,
    });
    expect(s.items.map((it) => it.kind)).toEqual(["tool", "background-result"]);
    expect(s.items[1]).toMatchObject({
      kind: "background-result",
      agentId: "bd",
      description: "调查依赖",
      result: "最终结论正文",
    });
  });

  it("后台失败正文同样只保留在卡片数据里,重复终态不追加渲染项", () => {
    const s = run([
      open,
      launched,
      acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed", rawOutput: "第一次错误" }),
      acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed", rawOutput: "最终错误" }),
    ]);
    expect(toolItem(s, "t1")).toMatchObject({
      status: "fail",
      outKey: "chat.tool.bgFailed",
      result: "最终错误",
      backgroundNoticePending: true,
    });
    expect(s.items.map((it) => it.kind)).toEqual(["tool"]);
  });
});

describe("计划卡片", () => {
  it("plan 不进对话流,面板状态整卡更新", () => {
    const s = run([
      acp({ sessionUpdate: "plan", entries: [{ content: "任务一", status: "pending" }] }),
      acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "TaskCreate", status: "in_progress" }),
      acp({
        sessionUpdate: "plan",
        entries: [
          { content: "任务一", status: "pending" },
          { content: "任务二", status: "pending" },
        ],
      }),
    ]);
    expect(s.plan.length).toBe(2);
    expect(s.items.every((it) => it.kind !== ("plan" as never))).toBe(true);
  });

  it("连续 plan 帧面板整卡覆盖", () => {
    const s = run([
      acp({ sessionUpdate: "plan", entries: [{ content: "步骤一", status: "pending" }] }),
      acp({ sessionUpdate: "plan", entries: [{ content: "步骤一", status: "completed" }] }),
    ]);
    expect(s.plan).toEqual([{ content: "步骤一", status: "completed" }]);
    expect(s.items.length).toBe(0);
  });

  it("中间隔了其他内容后,面板持有最新清单", () => {
    const s = run([
      acp({ sessionUpdate: "plan", entries: [{ content: "步骤一", status: "pending" }] }),
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "开始干活" } }),
      acp({ sessionUpdate: "plan", entries: [{ content: "步骤一", status: "completed" }] }),
    ]);
    expect(s.items.map((it) => it.kind)).toEqual(["agent"]);
    expect(s.plan).toEqual([{ content: "步骤一", status: "completed" }]);
  });

  it("新一轮开始时清空上一轮已全部完成的任务清单", () => {
    const previous = run([
      frame("task-started"),
      acp({ sessionUpdate: "plan", entries: [{ content: "上一轮任务", status: "completed" }] }),
      frame("task-ended"),
    ]);
    expect(previous.plan).toHaveLength(1);

    const next = reduceBatch(previous, [frame("user-input", { content: b64encode("开始下一轮") }), frame("task-started")]);
    expect(next.plan).toEqual([]);
    expect(next.running).toBe(true);
  });

  it("新一轮开始时保留上一轮尚未完成的任务清单", () => {
    const entries = [
      { content: "已完成", status: "completed" },
      { content: "继续处理", status: "in_progress" },
    ];
    const previous = run([frame("task-started"), acp({ sessionUpdate: "plan", entries }), frame("task-ended")]);

    const next = reduceBatch(previous, [frame("user-input", { content: b64encode("继续做") }), frame("task-started")]);
    expect(next.plan).toEqual(entries);
    expect(next.running).toBe(true);
  });
});

describe("审批卡片状态机", () => {
  const req = frame("permission-req", { id: "p1", title: "rm -rf /tmp/x", tool: "bash" });

  it("permission-req 建开放卡片;缺 id 忽略", () => {
    const s = run([req, frame("permission-req", { title: "无 id" })]);
    expect(s.items).toEqual([{ kind: "perm", id: "p1", title: "rm -rf /tmp/x", tool: "bash", state: "open" }]);
  });

  it("permission-resolved 只落在开放卡片上", () => {
    const s = run([req, frame("permission-resolved", { id: "p1", outcome: "approved" })]);
    expect(s.items[0]).toMatchObject({ state: "approved" });
    // 已终态的卡片不被再次改写
    const s2 = reduceFrame(s, frame("permission-resolved", { id: "p1", outcome: "denied" }));
    expect(s2.items[0]).toMatchObject({ state: "approved" });
  });

  it("answerPerm 本地立即回写,仅作用于开放卡片", () => {
    const s = run([req]);
    expect(answerPerm(s, "p1", true).items[0]).toMatchObject({ state: "allowed" });
    expect(answerPerm(s, "p1", false).items[0]).toMatchObject({ state: "rejected" });
    const resolved = run([req, frame("permission-resolved", { id: "p1", outcome: "denied" })]);
    expect(answerPerm(resolved, "p1", true).items[0]).toMatchObject({ state: "denied" });
  });

  it("轮次结束/出错时开放卡片过期", () => {
    expect(run([req, frame("task-ended")]).items[0]).toMatchObject({ state: "expired" });
    expect(run([req, frame("task-error", { error: "x" })]).items[0]).toMatchObject({ state: "expired" });
  });

  it("终态文案映射", () => {
    // 归约层只给键(渲染层过 t);未知态给 null,由调用方原样显示服务端字符串
    expect(permStateKey("allowed")).toBe("chat.perm.allowed");
    expect(permStateKey("timeout")).toBe("chat.perm.timeout");
    expect(permStateKey("未知态")).toBeNull();
  });
});

describe("审批锚定到工具卡(permission-req.tool_call_id)", () => {
  // 事件序契约:引擎先发 tool_call 帧、后发 permission-req,
  // 审批到达时对应工具卡必已存在(running 态)
  const tool = acp({ sessionUpdate: "tool_call", toolCallId: "tu_1", title: "Bash git push origin main" });
  const reqAnchored = frame("permission-req", {
    id: "p1",
    title: "Bash git push origin main",
    tool: "Bash",
    tool_call_id: "tu_1",
  });
  const permOf = (s: ChatState) => s.items.find((it) => it.kind === "perm") as PermItem;

  it("带 tool_call_id 的 perm 存入 toolCallId 并锚定到同 id 工具卡(独立卡不渲染)", () => {
    const s = run([tool, reqAnchored]);
    const perm = permOf(s);
    expect(perm.toolCallId).toBe("tu_1");
    const anchors = permAnchors(s.items);
    expect(anchors.get("tu_1")).toBe(perm); // 对话流视图据此嵌按钮行、跳过独立卡
  });

  it("无 tool_call_id(旧引擎/云端任务流)不写字段、不锚定,回退独立卡", () => {
    const s = run([tool, frame("permission-req", { id: "p2", title: "rm x", tool: "Bash" })]);
    expect("toolCallId" in permOf(s)).toBe(false);
    expect(permAnchors(s.items).size).toBe(0);
  });

  it("带 tool_call_id 但流里找不到对应工具卡时同样回退独立卡", () => {
    const s = run([frame("permission-req", { id: "p3", title: "rm x", tool: "Bash", tool_call_id: "无此卡" })]);
    expect(permOf(s).toolCallId).toBe("无此卡");
    expect(permAnchors(s.items).size).toBe(0);
  });

  it("锚定后 resolve 即解除(按钮行消失),拒绝路径工具卡走 failed 流转", () => {
    const s = run([tool, reqAnchored]);
    // 本地应答拒绝 → open 解除 → 锚定消失
    const answered = answerPerm(s, "p1", false);
    expect(permAnchors(answered.items).size).toBe(0);
    // 引擎拒绝后回 is_error 的 tool_result → 驱动产 failed 帧,卡片自然转 fail
    const failed = reduceFrame(
      answered,
      acp({
        sessionUpdate: "tool_call_update",
        toolCallId: "tu_1",
        status: "failed",
        rawOutput: "Error: tool Bash denied: user denied",
      }),
    );
    expect(toolItem(failed, "tu_1").status).toBe("fail");
    // resolved 帧到达(approved)同样解除锚定,工具卡照常 completed
    const resolved = reduceFrame(s, frame("permission-resolved", { id: "p1", outcome: "approved" }));
    expect(permAnchors(resolved.items).size).toBe(0);
    expect(permOf(resolved).state).toBe("approved");
    // 轮次结束把开放审批过期,锚定同步解除
    expect(permAnchors(run([tool, reqAnchored, frame("task-ended")]).items).size).toBe(0);
  });
});

describe("轮次与系统帧", () => {
  it("task-started 置运行中;task-ended 复位并标记 turnEnded + 分隔线", () => {
    const started = run([frame("task-started")]);
    expect(started.running).toBe(true);
    const ended = reduceFrame(started, frame("task-ended"));
    expect(ended).toMatchObject({ running: false, turnEnded: true, streamKind: "" });
    expect(ended.items.at(-1)).toEqual({ kind: "sys", tag: "turn-end", text: "", key: "chat.sys.turnEnd" });
    // turnEnded 是轮次级状态:新一轮开始即复位,轮末边沿检测每轮可触发
    expect(reduceFrame(ended, frame("task-started")).turnEnded).toBe(false);
  });

  it("同批开始并结束仍保留单调终态水位", () => {
    const ended = run([
      { ...frame("task-started"), seq: 10 },
      { ...frame("task-ended"), seq: 11 },
    ]);
    expect(ended).toMatchObject({
      running: false,
      lastSeq: 11,
      lastTurnStartSeq: 10,
      lastTerminalSeq: 11,
    });

    const next = reduceBatch(ended, [{ ...frame("task-error", { error: "暂时失败", terminal: false }), seq: 12 }]);
    expect(next).toMatchObject({ running: false, lastSeq: 12, lastTerminalSeq: 11 });
  });

  it("task-error 渲染错误系统行,缺 error 字段回退文案", () => {
    const s = run([frame("task-error", { error: "配额耗尽" })]);
    expect(s.items.at(-1)).toEqual({ kind: "sys", tag: "error", text: "", key: "chat.sys.error", params: { reason: "配额耗尽" }, error: true });
    expect(run([frame("task-error")]).items.at(-1)).toEqual({ kind: "sys", tag: "error", text: "", key: "chat.sys.errorUnknown", error: true });
  });

  it("terminal=false 的错误只展示,保持运行态直到 task-ended", () => {
    const pending = run([frame("task-started"), frame("task-error", { error: "落盘失败", terminal: false })]);
    expect(pending.running).toBe(true);
    expect(pending.items.at(-1)).toMatchObject({ kind: "sys", tag: "error", params: { reason: "落盘失败" } });
    expect(reduceFrame(pending, frame("task-ended")).running).toBe(false);
  });

  it("user-input 解 base64(含多字节);坏编码回退原文", () => {
    const s = run([frame("user-input", { content: b64encode("修复 Bug🐛") })]);
    expect(s.items[0]).toEqual({ kind: "user", text: "修复 Bug🐛" });
    const bad = run([frame("user-input", { content: "!!!不是base64" })]);
    expect(bad.items[0]).toEqual({ kind: "user", text: "!!!不是base64" });
  });

  it("同一 batch 累计多条 steer-confirmed，并对 replay/prepend 保持幂等", () => {
    const confirmed = run([
      { ...frame("steer-confirmed", { client_id: "client-a" }), seq: 41 },
      { ...frame("steer-confirmed", { client_id: "client-b" }), seq: 42 },
    ]);
    expect(confirmed.steerConfirmations).toEqual({ "client-a": 41, "client-b": 42 });
    expect(reduceFrame(confirmed, { ...frame("steer-confirmed", { client_id: "client-b" }), seq: 42 })).toBe(confirmed);
    expect(reduceBatch(confirmed, [{ ...frame("steer-confirmed", { client_id: "client-a" }), seq: 41 }])).toBe(confirmed);

    const prepended = prependHistory(confirmed, [
      { ...frame("user-input", { content: b64encode("更早消息") }), seq: 1 },
      { ...frame("steer-confirmed", { client_id: "old-page" }), seq: 2 },
    ]);
    expect(prepended.steerConfirmations).toBe(confirmed.steerConfirmations);
    expect(prepended.steerConfirmations).toEqual({ "client-a": 41, "client-b": 42 });
  });

  it("user-input 只保留受支持的 steering 来源与 client_id", () => {
    const steered = run([
      frame("user-input", { content: b64encode("补充"), source: "steer", client_id: "steer-1" }),
    ]);
    expect(steered.items[0]).toEqual({
      kind: "user",
      text: "补充",
      source: "steer",
      clientId: "steer-1",
    });
    const unknown = run([
      frame("user-input", { content: b64encode("普通"), source: "other", client_id: "ignored" }),
    ]);
    expect(unknown.items[0]).toEqual({ kind: "user", text: "普通" });
  });

  it("user-input 保留消息时间", () => {
    const s = run([{ ...frame("user-input", { content: b64encode("带时间") }), timestamp: 1_234 }]);
    expect(s.items[0]).toEqual({ kind: "user", text: "带时间", timestamp: 1_234 });
  });

  it("user-input 解析云端附件;缺 filename 用 URL 末段兜底,无 url 的条目丢弃", () => {
    const s = run([
      frame("user-input", {
        content: b64encode("看下这张图"),
        attachments: [
          { url: "https://oss.example.com/a.webp", filename: "a.webp" },
          { url: "https://oss.example.com/x/b.pdf" }, // 旧帧缺 filename
          { filename: "孤儿.png" }, // 无 url:不可渲染,丢弃
        ],
      }),
    ]);
    expect(s.items[0]).toEqual({
      kind: "user",
      text: "看下这张图",
      attachments: [
        { url: "https://oss.example.com/a.webp", filename: "a.webp" },
        { url: "https://oss.example.com/x/b.pdf", filename: "b.pdf" },
      ],
    });
    // 空 attachments:字段缺席(不污染全等比较)
    expect(run([frame("user-input", { content: b64encode("无附件"), attachments: [] })]).items[0]).toEqual({
      kind: "user",
      text: "无附件",
    });
  });

  it("usage/model/permMode 回写状态并留系统行", () => {
    const s = run([
      acp({ sessionUpdate: "usage_update", used: 1200, size: 200000 }),
      acp({ sessionUpdate: "model_update", model: "gpt-x" }),
      acp({ sessionUpdate: "permission_mode_update", mode: "yolo" }),
    ]);
    expect(s.usage).toEqual({ used: 1200, size: 200000 });
    expect(s.model).toBe("gpt-x");
    expect(s.permMode).toBe("yolo");
    expect(s.items.filter((it) => it.kind === "sys")).toHaveLength(2);
  });

  it("model_update 的系统行剥寻址后缀与会员档位前缀,状态仍存原始名", () => {
    const s = run([acp({ sessionUpdate: "model_update", model: "monkeycode-pro/deepseek@monkeycode#cfg-9" })]);
    expect(s.items.at(-1)).toEqual({ kind: "sys", tag: "model", text: "", key: "chat.sys.model", params: { model: "deepseek" } });
    expect(s.model).toBe("monkeycode-pro/deepseek@monkeycode#cfg-9");

    const remark = run([acp({ sessionUpdate: "model_update", model: "深度求索@monkeycode#cfg-9" })]);
    expect(remark.items.at(-1)).toEqual({ kind: "sys", tag: "model", text: "", key: "chat.sys.model", params: { model: "深度求索" } });
  });

  it("think_update 回写档位并留系统行,空档位显示为默认", () => {
    const s = run([acp({ sessionUpdate: "think_update", think: "high" })]);
    expect(s.think).toBe("high");
    expect(s.items.at(-1)).toEqual({ kind: "sys", tag: "think", text: "", key: "chat.sys.think", params: { level: "high" } });

    const back = run([acp({ sessionUpdate: "think_update", think: "" })]);
    expect(back.think).toBe("");
    expect(back.items.at(-1)).toEqual({ kind: "sys", tag: "think", text: "", key: "chat.sys.think", params: { level: "" } });
  });

  it("available_commands_update 只回写指令清单,不进对话流", () => {
    const s = run([
      acp({
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "compact", description: "压缩上下文" },
          { name: "review", input: { hint: "<file>" } },
        ],
      }),
    ]);
    expect(s.commands.map((c) => c.name)).toEqual(["compact", "review"]);
    expect(s.items).toEqual([]);
  });

  it("指令清单是全量重发:后一帧整体替换,空清单即清空", () => {
    const s = run([
      acp({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "a" }, { name: "" }] }),
      acp({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "b" }] }),
    ]);
    expect(s.commands.map((c) => c.name)).toEqual(["b"]);
    // 缺字段/无名条目一律丢弃(菜单里的空指令点不出东西)
    expect(run([acp({ sessionUpdate: "available_commands_update" })]).commands).toEqual([]);
  });

  it("compact_status 与 llm_call_retry 渲染系统行", () => {
    const s = run([
      acp({ sessionUpdate: "compact_status", status: "started" }),
      acp({ sessionUpdate: "compact_status", status: "failed" }),
      acp({ sessionUpdate: "compact_status", status: "cancelled" }),
      acp({ sessionUpdate: "llm_call_retry", attempt: 2, message: "429" }),
    ]);
    expect(s.items.map((it) => (it as SysItem).key)).toEqual([
      "chat.sys.compacting",
      "chat.sys.compactFailed",
      "chat.sys.compactCancelled",
      "chat.sys.retry",
    ]);
    expect((s.items[1] as SysItem).error).toBe(true);
    expect((s.items[3] as SysItem).params).toEqual({ attempt: "2", message: "429" });
  });

  it("未知帧/未知 sessionUpdate/非 acp kind 一律原样返回", () => {
    const s = run([acp({ sessionUpdate: "agent_message_chunk", content: { text: "a" } })]);
    expect(reduceFrame(s, frame("不认识"))).toBe(s);
    expect(reduceFrame(s, acp({ sessionUpdate: "future_update" }))).toBe(s);
    expect(reduceFrame(s, { type: "task-running", kind: "别的" })).toBe(s);
  });
});

describe("SysItem.tag(系统行渲染分流标记)", () => {
  const tagOf = (s: ChatState) => (s.items.at(-1) as SysItem).tag;

  it("各产出点打上对应 tag,文案字段原样保留(向后兼容)", () => {
    expect(tagOf(run([frame("task-ended")]))).toBe("turn-end");
    expect(tagOf(run([acp({ sessionUpdate: "model_update", model: "m1" })]))).toBe("model");
    expect(tagOf(run([acp({ sessionUpdate: "think_update", think: "high" })]))).toBe("think");
    expect(tagOf(run([acp({ sessionUpdate: "permission_mode_update", mode: "yolo" })]))).toBe("mode");
    expect(tagOf(run([acp({ sessionUpdate: "llm_call_retry", attempt: 1, message: "429" })]))).toBe("retry");
    expect(tagOf(run([acp({ sessionUpdate: "task_notification", text: "📌 后台完成" })]))).toBe("notify");
    expect(tagOf(run([acp({ sessionUpdate: "compact_status", status: "started" })]))).toBe("compact");
    // 文案不因打标而变:老消费方仍按 text 渲染
    expect(run([acp({ sessionUpdate: "permission_mode_update", mode: "yolo" })]).items.at(-1)).toEqual({
      kind: "sys",
      tag: "mode",
      text: "",
      key: "chat.sys.yolo",
    });
  });

  it("task-error 行打 error tag + error 标记(文案走 key,着色走 error 字段)", () => {
    const err = run([frame("task-error", { error: "配额耗尽" })]).items.at(-1) as SysItem;
    expect(err.tag).toBe("error");
    expect(err.error).toBe(true);
    // 归约层不产成品中文:引擎的原始错误串只作插值参数
    expect(err.key).toBe("chat.sys.error");
    expect(err.params).toEqual({ reason: "配额耗尽" });
  });
});

describe("AI 提问卡(ask_user_question)", () => {
  const questions = [
    {
      question: "选哪个方案?",
      header: "方案",
      options: [{ label: "方案 A", description: "简单" }, { label: "方案 B" }],
      custom: true,
    },
    { question: "要哪些能力?", multiple: true, options: [{ label: "X" }, { label: "Y" }] },
  ];

  it("tool_call 形态的提问(title=Question)渲染为 ask 卡而非工具卡", () => {
    const s = run([acp({ sessionUpdate: "tool_call", toolCallId: "ask-1", title: "Question", rawInput: { questions } })]);
    expect(s.items).toHaveLength(1);
    const ask = s.items[0] as AskItem;
    expect(ask.kind).toBe("ask");
    expect(ask.askId).toBe("ask-1");
    expect(ask.state).toBe("open");
    expect(ask.questions[0]?.multiSelect).toBe(false);
    expect(ask.questions[0]?.custom).toBe(true);
    expect(ask.questions[1]?.multiSelect).toBe(true);
  });

  it("custom 缺省开启(引擎 schema 无此字段且答复零校验),显式 false 才关闭", () => {
    const qs = [
      { question: "缺省?", options: [{ label: "A" }] },
      { question: "关闭?", custom: false, options: [{ label: "B" }] },
    ];
    const s = run([acp({ sessionUpdate: "tool_call", toolCallId: "ask-c", title: "Question", rawInput: { questions: qs } })]);
    const ask = s.items[0] as AskItem;
    expect(ask.questions[0]?.custom).toBe(true);
    expect(ask.questions[1]?.custom).toBe(false);
  });

  it("acp_ask_user_question 帧(toolCall 包裹)同样出卡;同 askId 更新不重复", () => {
    const f = frame("task-running", { toolCall: { toolCallId: "ask-2", rawInput: { questions } } }, "acp_ask_user_question");
    const s = run([f, f]);
    expect(s.items.filter((it) => it.kind === "ask")).toHaveLength(1);
  });

  it("reply-question 回显把卡片置 done 并按题回填答案", () => {
    const s = run([
      acp({ sessionUpdate: "tool_call", toolCallId: "ask-3", title: "Question", rawInput: { questions } }),
      frame("reply-question", {
        request_id: "ask-3",
        answers_json: JSON.stringify({ "选哪个方案?": "方案 A", "要哪些能力?": ["X", "Y"] }),
      }),
    ]);
    const ask = s.items[0] as AskItem;
    expect(ask.state).toBe("done");
    expect(ask.questions[0]?.answer).toBe("方案 A");
    expect(ask.questions[1]?.answer).toEqual(["X", "Y"]);
  });

  it("轮结束时未回答的提问卡过期", () => {
    const s = run([
      acp({ sessionUpdate: "tool_call", toolCallId: "ask-4", title: "Question", rawInput: { questions } }),
      frame("task-ended"),
    ]);
    const ask = s.items.find((it) => it.kind === "ask") as AskItem;
    expect(ask.state).toBe("expired");
  });

  it("answerAsk 乐观回写:置 done 并填答案", () => {
    const s0 = run([acp({ sessionUpdate: "tool_call", toolCallId: "ask-5", title: "Question", rawInput: { questions } })]);
    const s = answerAsk(s0, "ask-5", { "选哪个方案?": "自定义答案", "要哪些能力?": ["X"] });
    const ask = s.items[0] as AskItem;
    expect(ask.state).toBe("done");
    expect(ask.questions[0]?.answer).toBe("自定义答案");
  });

  it("普通 tool_call(有 title 非提问词汇)不受影响,仍是工具卡", () => {
    const s = run([acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "bash", rawInput: { questions } })]);
    expect(s.items[0]?.kind).toBe("tool");
  });
});

describe("旧格式帧兼容(data = base64(JSON) 字符串)", () => {
  // 钉住 codec.frameData 的双格式容错,不可删:①存量 journal(events.jsonl)
  // 是旧格式,壳回放原样转发;②云端任务流的帧契约不归本仓库管,
  // 实测既有 base64 字符串也有裸对象/裸 JSON 字符串形态。
  const legacy = (type: string, data: unknown, kind?: string): Frame => ({
    type,
    ...(kind ? { kind } : {}),
    data: b64encode(JSON.stringify(data)),
  });

  it("旧格式 acp_event 帧照常归约(存量 journal 回放)", () => {
    const s = run([
      legacy("task-running", { update: { sessionUpdate: "agent_message_chunk", content: { text: "旧帧" } } }, "acp_event"),
      legacy("task-running", { update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "读取 a.txt" } }, "acp_event"),
      legacy(
        "task-running",
        { update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: "ok" } },
        "acp_event",
      ),
    ]);
    expect(s.items[0]).toEqual({ kind: "agent", text: "旧帧" });
    expect(toolItem(s, "t1")).toMatchObject({ status: "ok", out: "ok" });
  });

  it("旧格式顶层帧照常归约(user-input 内层 content 仍是 base64 文本)", () => {
    const s = run([
      legacy("user-input", { content: b64encode("旧格式输入") }),
      legacy("permission-req", { id: "p1", title: "rm x", tool: "bash" }),
      legacy("task-error", { error: "旧格式错误" }),
    ]);
    expect(s.items[0]).toEqual({ kind: "user", text: "旧格式输入" });
    expect(s.items[1]).toMatchObject({ kind: "perm", id: "p1", state: "expired" }); // task-error 过期开放卡
    expect(s.items.at(-1)).toEqual({ kind: "sys", tag: "error", text: "", key: "chat.sys.error", params: { reason: "旧格式错误" }, error: true });
  });

  it("裸 JSON 字符串形态的 data(云端观测形态)也可解", () => {
    const s = run([{ type: "task-error", data: JSON.stringify({ error: "裸串" }) }]);
    expect(s.items.at(-1)).toEqual({ kind: "sys", tag: "error", text: "", key: "chat.sys.error", params: { reason: "裸串" }, error: true });
  });
});

describe("prependHistory(加载更早)", () => {
  const f = (type: string, data?: unknown, kind?: string, seq?: number): Frame => ({
    type,
    ...(kind ? { kind } : {}),
    ...(data !== undefined ? { data } : {}),
    ...(seq !== undefined ? { seq } : {}),
  });

  it("更早的一段只贡献 items,不把此刻的运行态/用量覆盖成历史值", () => {
    const now: ChatState = {
      ...createChatState(),
      items: [{ kind: "user", text: "现在这条" }],
      running: true,
      usage: { used: 999, size: 1000 },
    };
    const older = [
      f("task-started"),
      f("task-running", { update: { sessionUpdate: "usage_update", used: 1, size: 1000 } }, "acp_event"),
      f("task-ended"),
    ];

    const s = prependHistory(now, older);

    expect(s.running).toBe(true);
    expect(s.usage).toEqual({ used: 999, size: 1000 });
    expect(s.items.at(-1)).toEqual({ kind: "user", text: "现在这条" });
  });

  it("keyBase 左移与新增条数一致,既有条目的渲染 key 不变", () => {
    const anchor: ChatItem = { kind: "user", text: "第二问" };
    const now: ChatState = { ...createChatState(), items: [anchor] };
    const older = [f("user-input", { content: b64encode("第一问") }, undefined, 7), f("task-started"), f("task-ended")];

    const s = prependHistory(now, older);

    const added = s.items.length - now.items.length;
    expect(s.keyBase).toBe(now.keyBase - added);
    // 「第二问」原 key = keyBase(0) + 下标(0) = 0;前插后 key 应当仍是 0
    expect(itemKey(s, s.items.indexOf(anchor))).toBe(0);
  });

  it("空的一页不动状态", () => {
    const now: ChatState = { ...createChatState(), items: [{ kind: "user", text: "只有这条" }] };
    expect(prependHistory(now, [])).toBe(now);
  });

  it("前插不动 seq 水位:旧页 seq 都更小,水位回落会放进重放帧", () => {
    const now: ChatState = { ...createChatState(), items: [{ kind: "user", text: "现在" }], lastSeq: 50 };
    const s = prependHistory(now, [f("user-input", { content: b64encode("更早") }, undefined, 7)]);
    expect(s.items).toHaveLength(2);
    expect(s.lastSeq).toBe(50);
  });
});

describe("seq 去重(云端重连会重放)", () => {
  const withSeq = (f: Frame, seq: number): Frame => ({ ...f, seq });
  const chunk = (text: string): Frame => acp({ sessionUpdate: "agent_message_chunk", content: { text } });

  it("跨批次重放的重叠帧丢弃,新帧照常归约,水位单调抬升", () => {
    const s1 = reduceBatch(createChatState(), [
      withSeq(frame("user-input", { content: b64encode("第一问") }), 1),
      withSeq(frame("task-started"), 2),
      withSeq(chunk("你好"), 3),
    ]);
    expect(s1.lastSeq).toBe(3);

    // 重连回放:旧帧(1/3)重来一遍,夹着新帧(4)
    const s2 = reduceBatch(s1, [
      withSeq(frame("user-input", { content: b64encode("第一问") }), 1),
      withSeq(chunk("你好"), 3),
      withSeq(chunk(",世界"), 4),
    ]);
    expect(s2.items.filter((it) => it.kind === "user")).toHaveLength(1);
    expect(s2.items.at(-1)).toEqual({ kind: "agent", text: "你好,世界" });
    expect(s2.lastSeq).toBe(4);
  });

  it("连续 usage_update 后的 task-ended 立即关闭本地轮次", () => {
    const started = reduceBatch(createChatState(), [withSeq(frame("task-started"), 14217)]);
    const ended = reduceBatch(started, [
      {
        data: { update: { sessionUpdate: "usage_update", size: 200000, used: 56308 } },
        kind: "acp_event",
        seq: 14218,
        timestamp: 1787649934202,
        type: "task-running",
      },
      {
        data: { update: { sessionUpdate: "usage_update", size: 200000, used: 57577 } },
        kind: "acp_event",
        seq: 14219,
        timestamp: 1787649934250,
        type: "task-running",
      },
      { seq: 14220, timestamp: 1787649934250, type: "task-ended" },
    ]);

    expect(ended).toMatchObject({
      running: false,
      turnEnded: true,
      usage: { used: 57577, size: 200000 },
      lastSeq: 14220,
      lastTerminalSeq: 14220,
    });
    expect(ended.items.at(-1)).toMatchObject({ kind: "sys", tag: "turn-end" });
  });

  it("跨批晚到的低 seq task-ended 按终态水位归约且重复回放仍丢弃", () => {
    const running = reduceBatch(createChatState(), [
      withSeq(frame("task-started"), 2),
      withSeq(acp({ sessionUpdate: "usage_update", used: 9, size: 100 }), 40),
    ]);
    expect(running).toMatchObject({ running: true, lastSeq: 40, lastTerminalSeq: 0 });

    const ended = reduceBatch(running, [withSeq(frame("task-ended"), 22)]);
    expect(ended).toMatchObject({
      running: false,
      turnEnded: true,
      lastSeq: 40,
      lastTerminalSeq: 22,
    });
    expect(ended.items.filter((item) => item.kind === "sys" && item.tag === "turn-end")).toHaveLength(1);
    expect(reduceBatch(ended, [withSeq(frame("task-ended"), 22)])).toBe(ended);
  });

  it("早于当前 task-started 的旧终态不得关闭新轮", () => {
    const previous = reduceBatch(createChatState(), [
      withSeq(frame("task-started"), 10),
      withSeq(frame("task-ended"), 20),
    ]);
    const current = reduceBatch(previous, [
      withSeq(frame("task-started"), 30),
      withSeq(acp({ sessionUpdate: "usage_update", used: 9, size: 100 }), 40),
    ]);
    const staleEnd = reduceBatch(current, [withSeq(frame("task-ended"), 25)]);
    expect(staleEnd).toBe(current);
    expect(staleEnd).toMatchObject({
      running: true,
      lastSeq: 40,
      lastTurnStartSeq: 30,
      lastTerminalSeq: 20,
    });
    expect(staleEnd.items.filter((item) => item.kind === "sys" && item.tag === "turn-end")).toHaveLength(1);
  });

  it("与当前开轮同批的旧 task-ended 也不得关闭新轮", () => {
    const previous = reduceBatch(createChatState(), [
      withSeq(frame("task-started"), 10),
      withSeq(frame("task-ended"), 20),
    ]);
    const current = reduceBatch(previous, [
      withSeq(frame("task-started"), 30),
      withSeq(acp({ sessionUpdate: "usage_update", used: 9, size: 100 }), 40),
      withSeq(frame("task-ended"), 25),
    ]);
    expect(current).toMatchObject({
      running: true,
      lastSeq: 40,
      lastTurnStartSeq: 30,
      lastTerminalSeq: 20,
    });
    expect(current.items.filter((item) => item.kind === "sys" && item.tag === "turn-end")).toHaveLength(1);
  });

  it("与业务帧共享 seq 的 task-ended 仍关闭轮次", () => {
    const ended = reduceBatch(createChatState(), [
      withSeq(frame("task-started"), 1),
      withSeq(chunk("完成"), 2),
      withSeq(frame("task-ended"), 2),
    ]);
    expect(ended).toMatchObject({ running: false, turnEnded: true, lastSeq: 2, lastTerminalSeq: 2 });
    expect(ended.items.at(-1)).toMatchObject({ kind: "sys", tag: "turn-end" });
  });

  it("整批都在水位之下时状态原样返回(引用不变,不触发重渲染)", () => {
    const s1 = reduceBatch(createChatState(), [withSeq(chunk("你好"), 10)]);
    expect(reduceBatch(s1, [withSeq(chunk("你好"), 10), withSeq(chunk("旧帧"), 4)])).toBe(s1);
  });

  it("批内 seq 乱序(折叠回放形态)不被误杀:只与批首水位比较", () => {
    // 折叠会把合并块钉在首片 seq、覆盖语义帧收敛到末片 seq,批内顺序
    // 合法地不随 seq 单调(39 排在 22 前面)——批内顺序可信,不去重
    const s = reduceBatch(createChatState(), [
      withSeq(acp({ sessionUpdate: "agent_thought_chunk", content: { text: "想" } }), 3),
      withSeq(acp({ sessionUpdate: "usage_update", used: 9, size: 100 }), 39),
      withSeq(acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "读取" }), 22),
    ]);
    expect(s.items.map((it) => it.kind)).toEqual(["thought", "tool"]);
    expect(s.usage).toEqual({ used: 9, size: 100 });
    expect(s.lastSeq).toBe(39);
  });

  it("批内完全相同的 seq 只归约一次(同批里既回放又直播)", () => {
    const dup = withSeq(chunk("A"), 5);
    const s = reduceBatch(createChatState(), [dup, dup]);
    expect(s.items).toEqual([{ kind: "agent", text: "A" }]);
    expect(s.lastSeq).toBe(5);
  });

  it("缺 seq/seq=0 的帧(云端旧帧)不参与去重,照常归约", () => {
    const s = reduceBatch(createChatState(), [{ ...chunk("a"), seq: 0 }, chunk("b")]);
    expect(s.items).toEqual([{ kind: "agent", text: "ab" }]);
    expect(s.lastSeq).toBe(0);
  });

  it("空批次原样返回(引用不变)", () => {
    const s = createChatState();
    expect(reduceBatch(s, [])).toBe(s);
  });
});

describe("大字段护栏标记透传", () => {
  it("_meta.mcSrc 原样带到工具项上(工具卡据此回读全文)", () => {
    // 壳侧物化时截断了 rawOutput,并在 _meta 留下按 seq 回读的凭据
    const s = run([
      frame("task-running", { update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read" } }, "acp_event"),
      frame(
        "task-running",
        {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "t1",
            status: "completed",
            rawOutput: { output: "前 1KB…" },
            _meta: { mcSrc: { seq: 42 } },
          },
        },
        "acp_event",
      ),
    ]);

    const tool = s.items.find((i) => i.kind === "tool") as ToolItem;
    expect((tool._meta as { mcSrc?: { seq?: number } }).mcSrc?.seq).toBe(42);
    // 行内头部照常渲染,卡片折叠态不受影响
    expect(tool.out).toContain("前 1KB");
  });
});

describe("块级时间戳", () => {
  it("思考首片与工具开卡都带帧时间(块级时间显影的数据面)", () => {
    const s = reduceBatch(createChatState(), [
      {
        type: "task-running",
        kind: "acp_event",
        data: { update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "想想" } } },
        timestamp: 111,
        seq: 1,
      },
      {
        type: "task-running",
        kind: "acp_event",
        data: { update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Bash", rawInput: { command: "ls" } } },
        timestamp: 222,
        seq: 2,
      },
    ]);
    const thought = s.items.find((it) => it.kind === "thought");
    const tool = s.items.find((it) => it.kind === "tool");
    expect(thought && "timestamp" in thought ? thought.timestamp : undefined).toBe(111);
    expect(tool && "timestamp" in tool ? tool.timestamp : undefined).toBe(222);
  });
});
