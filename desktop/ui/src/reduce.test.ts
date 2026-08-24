// reduce.ts 归约器单测:帧 → 对话流渲染项的全部状态转移。
// 纯函数无 DOM,直接在 node 环境跑(vitest 默认);帧构造与壳下行新格式
// 一致(data = 内联 JSON 对象);旧格式(base64(JSON) 字符串)的容错
// 回归用例见文末「旧格式帧兼容」。
import { describe, expect, it } from "vitest";
import { b64encode } from "./codec";
import { answerAsk, answerPerm, initialChat, permAnchors, permStateLabel, prependBatch, reduceBatch, reduceFrame, type ChatState } from "./reduce";
import type { AcpUpdate, Frame, LogItem, ToolProgress } from "./types";

const frame = (type: string, data?: unknown, kind?: string): Frame => ({
  type,
  ...(kind ? { kind } : {}),
  ...(data !== undefined ? { data } : {}),
});

const acp = (update: Partial<AcpUpdate>): Frame =>
  frame("task-running", { update }, "acp_event");

const run = (frames: Frame[]) => reduceBatch(initialChat, frames);

const toolItem = (s: ReturnType<typeof run>, tcId: string) =>
  s.items.find((it) => it.kind === "tool" && it.tcId === tcId) as Extract<LogItem, { kind: "tool" }>;

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
    expect((s.items[2] as Extract<LogItem, { kind: "agent" }>).text).toBe("后");
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
    const s = run([acp({
      sessionUpdate: "tool_call",
      toolCallId: "cloud-complete",
      title: "read",
      kind: "read",
      status: "completed",
      rawInput: { filePath: "/workspace/a.ts" },
      rawOutput: { output: "const a = 1" },
    })]);
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
    expect(toolItem(s, "t1").feed).toEqual([
      { kind: "tool", id: "s1", title: "读取 a.txt", rawInput, status: "ok" },
    ]);
  });

  it("subagent_text 追加文本行,空行忽略", () => {
    const s = run([
      open,
      prog({ kind: "subagent_text", line: "第一行" }),
      prog({ kind: "subagent_text" }),
    ]);
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
    const miss = reduceFrame(s1, acp({ sessionUpdate: "tool_call_update", toolCallId: "无此ID", status: "in_progress", progress: { kind: "output", line: "y" } }));
    expect(miss).toBe(s1);
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

  it("task_notification 渲染独立系统行,不并入流式中的正文气泡", () => {
    const s = run([
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "我先做别的" } }),
      acp({ sessionUpdate: "task_notification", text: "📌 后台代理 bd 已完成,结果已回填其任务卡" }),
      acp({ sessionUpdate: "agent_message_chunk", content: { text: ",继续" } }),
    ]);
    expect(s.items.map((it) => it.kind)).toEqual(["agent", "sys", "agent"]);
    expect((s.items[1] as Extract<LogItem, { kind: "sys" }>).text).toContain("bd");
    // 缺 text 忽略
    expect(reduceFrame(s, acp({ sessionUpdate: "task_notification" })).items).toHaveLength(3);
  });

  it("转后台后卡片保持运行态并继续接受进度直播", () => {
    const s = run([
      open,
      launched,
      acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress", progress: { kind: "subagent_text", line: "后台仍在跑" } }),
      acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress", progress: { kind: "child_session", childSessionId: "c1" } }),
    ]);
    expect(toolItem(s, "t1")).toMatchObject({ status: "run", out: "后台运行中", background: true, childSessionId: "c1" });
    expect(toolItem(s, "t1").result).toBeUndefined();
    expect(toolItem(s, "t1").feed).toEqual([{ kind: "text", text: "后台仍在跑" }]);
  });

  it("后台终态只收起卡片并隐藏紧随其后的重复通知", () => {
    const s = run([
      open,
      launched,
      acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: "最终结论正文" }),
      acp({ sessionUpdate: "task_notification", text: "📌 后台代理 bd 已完成,结果已回填其任务卡" }),
    ]);
    expect(toolItem(s, "t1")).toMatchObject({
      status: "ok",
      out: "后台执行完成",
      result: "最终结论正文",
      backgroundNoticePending: false,
    });
    expect(s.items.map((it) => it.kind)).toEqual(["tool"]);
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
      out: "后台执行失败",
      result: "最终错误",
      backgroundNoticePending: true,
    });
    expect(s.items.map((it) => it.kind)).toEqual(["tool"]);
  });
});

describe("计划卡片", () => {
  it("plan 不进对话流,面板状态整卡更新", () => {
    const s = reduceBatch(initialChat, [
      acp({ sessionUpdate: "plan", entries: [{ content: "任务一", status: "pending" }] }),
      acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "TaskCreate", status: "in_progress" }),
      acp({ sessionUpdate: "plan", entries: [
        { content: "任务一", status: "pending" },
        { content: "任务二", status: "pending" },
      ] }),
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

    const next = reduceBatch(previous, [
      frame("user-input", { content: b64encode("开始下一轮") }),
      frame("task-started"),
    ]);
    expect(next.plan).toEqual([]);
    expect(next.running).toBe(true);
  });

  it("新一轮开始时保留上一轮尚未完成的任务清单", () => {
    const entries = [
      { content: "已完成", status: "completed" },
      { content: "继续处理", status: "in_progress" },
    ];
    const previous = run([
      frame("task-started"),
      acp({ sessionUpdate: "plan", entries }),
      frame("task-ended"),
    ]);

    const next = reduceBatch(previous, [
      frame("user-input", { content: b64encode("继续做") }),
      frame("task-started"),
    ]);
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
    expect(permStateLabel("allowed")).toBe("已允许");
    expect(permStateLabel("timeout")).toBe("已超时(按拒绝处理)");
    expect(permStateLabel("未知态")).toBe("未知态");
  });
});

describe("审批锚定到工具卡(permission-req.tool_call_id)", () => {
  // 事件序契约:引擎先发 tool_call 帧、后发 permission-req,
  // 审批到达时对应工具卡必已存在(running 态)
  const tool = acp({ sessionUpdate: "tool_call", toolCallId: "tu_1", title: "Bash git push origin main" });
  const reqAnchored = frame("permission-req", { id: "p1", title: "Bash git push origin main", tool: "Bash", tool_call_id: "tu_1" });
  const permOf = (s: ReturnType<typeof run>) =>
    s.items.find((it) => it.kind === "perm") as Extract<LogItem, { kind: "perm" }>;

  it("带 tool_call_id 的 perm 存入 toolCallId 并锚定到同 id 工具卡(独立卡不渲染)", () => {
    const s = run([tool, reqAnchored]);
    const perm = permOf(s);
    expect(perm.toolCallId).toBe("tu_1");
    const anchors = permAnchors(s.items);
    expect(anchors.get("tu_1")).toBe(perm); // LogList 据此嵌按钮行、跳过独立卡
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
      acp({ sessionUpdate: "tool_call_update", toolCallId: "tu_1", status: "failed", rawOutput: "Error: tool Bash denied: user denied" }),
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
    expect(ended.items.at(-1)).toEqual({ kind: "sys", text: "— 本轮结束 —" });
  });

  it("task-error 渲染错误系统行,缺 error 字段回退文案", () => {
    const s = run([frame("task-error", { error: "配额耗尽" })]);
    expect(s.items.at(-1)).toEqual({ kind: "sys", text: "✗ 配额耗尽", error: true });
    expect(run([frame("task-error")]).items.at(-1)).toEqual({ kind: "sys", text: "✗ 未知错误", error: true });
  });

  it("terminal=false 的错误只展示,保持运行态直到 task-ended", () => {
    const pending = run([frame("task-started"), frame("task-error", { error: "落盘失败", terminal: false })]);
    expect(pending.running).toBe(true);
    expect(pending.items.at(-1)).toEqual({ kind: "sys", text: "✗ 落盘失败", error: true });
    expect(reduceFrame(pending, frame("task-ended")).running).toBe(false);
  });

  it("user-input 解 base64(含多字节);坏编码回退原文", () => {
    const s = run([frame("user-input", { content: b64encode("修复 Bug🐛") })]);
    expect(s.items[0]).toEqual({ kind: "user", text: "修复 Bug🐛" });
    const bad = run([frame("user-input", { content: "!!!不是base64" })]);
    expect(bad.items[0]).toEqual({ kind: "user", text: "!!!不是base64" });
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
    expect(s.items.at(-1)).toEqual({ kind: "sys", text: "模型已切换为 deepseek" });
    expect(s.model).toBe("monkeycode-pro/deepseek@monkeycode#cfg-9");

    const remark = run([acp({ sessionUpdate: "model_update", model: "深度求索@monkeycode#cfg-9" })]);
    expect(remark.items.at(-1)).toEqual({ kind: "sys", text: "模型已切换为 深度求索" });
  });

  it("think_update 回写档位并留系统行,空档位显示为默认", () => {
    const s = run([acp({ sessionUpdate: "think_update", think: "high" })]);
    expect(s.think).toBe("high");
    expect(s.items.at(-1)).toEqual({ kind: "sys", text: "思考深度已调整为「高」" });

    const back = run([acp({ sessionUpdate: "think_update", think: "" })]);
    expect(back.think).toBe("");
    expect(back.items.at(-1)).toEqual({ kind: "sys", text: "思考深度已调整为「默认」" });
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
    expect(s.items.map((it) => (it as Extract<LogItem, { kind: "sys" }>).text)).toEqual([
      "⟳ 上下文接近上限,正在压缩…",
      "✗ 上下文压缩失败",
      "⟳ 上下文压缩已取消",
      "模型调用重试 #2: 429",
    ]);
  });

  it("未知帧/未知 sessionUpdate/非 acp kind 一律原样返回", () => {
    const s = run([acp({ sessionUpdate: "agent_message_chunk", content: { text: "a" } })]);
    expect(reduceFrame(s, frame("不认识"))).toBe(s);
    expect(reduceFrame(s, acp({ sessionUpdate: "future_update" }))).toBe(s);
    expect(reduceFrame(s, { type: "task-running", kind: "别的" })).toBe(s);
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
    const ask = s.items[0] as Extract<LogItem, { kind: "ask" }>;
    expect(ask.kind).toBe("ask");
    expect(ask.askId).toBe("ask-1");
    expect(ask.state).toBe("open");
    expect(ask.questions[0].multiSelect).toBe(false);
    expect(ask.questions[0].custom).toBe(true);
    expect(ask.questions[1].multiSelect).toBe(true);
  });

  it("custom 缺省开启(引擎 schema 无此字段且答复零校验),显式 false 才关闭", () => {
    const qs = [
      { question: "缺省?", options: [{ label: "A" }] },
      { question: "关闭?", custom: false, options: [{ label: "B" }] },
    ];
    const s = run([acp({ sessionUpdate: "tool_call", toolCallId: "ask-c", title: "Question", rawInput: { questions: qs } })]);
    const ask = s.items[0] as Extract<LogItem, { kind: "ask" }>;
    expect(ask.questions[0].custom).toBe(true);
    expect(ask.questions[1].custom).toBe(false);
  });

  it("acp_ask_user_question 帧(toolCall 包裹)同样出卡;同 askId 更新不重复", () => {
    const f = frame(
      "task-running",
      { toolCall: { toolCallId: "ask-2", rawInput: { questions } } },
      "acp_ask_user_question",
    );
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
    const ask = s.items[0] as Extract<LogItem, { kind: "ask" }>;
    expect(ask.state).toBe("done");
    expect(ask.questions[0].answer).toBe("方案 A");
    expect(ask.questions[1].answer).toEqual(["X", "Y"]);
  });

  it("轮结束时未回答的提问卡过期", () => {
    const s = run([
      acp({ sessionUpdate: "tool_call", toolCallId: "ask-4", title: "Question", rawInput: { questions } }),
      frame("task-ended"),
    ]);
    const ask = s.items.find((it) => it.kind === "ask") as Extract<LogItem, { kind: "ask" }>;
    expect(ask.state).toBe("expired");
  });

  it("answerAsk 乐观回写:置 done 并填答案", () => {
    const s0 = run([acp({ sessionUpdate: "tool_call", toolCallId: "ask-5", title: "Question", rawInput: { questions } })]);
    const s = answerAsk(s0, "ask-5", { "选哪个方案?": "自定义答案", "要哪些能力?": ["X"] });
    const ask = s.items[0] as Extract<LogItem, { kind: "ask" }>;
    expect(ask.state).toBe("done");
    expect(ask.questions[0].answer).toBe("自定义答案");
  });

  it("普通 tool_call(有 title 非提问词汇)不受影响,仍是工具卡", () => {
    const s = run([acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "bash", rawInput: { questions } })]);
    expect(s.items[0].kind).toBe("tool");
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
      legacy("task-running", { update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: "ok" } }, "acp_event"),
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
    expect(s.items.at(-1)).toEqual({ kind: "sys", text: "✗ 旧格式错误", error: true });
  });

  it("裸 JSON 字符串形态的 data(云端观测形态)也可解", () => {
    const s = run([{ type: "task-error", data: JSON.stringify({ error: "裸串" }) } as Frame]);
    expect(s.items.at(-1)).toEqual({ kind: "sys", text: "✗ 裸串", error: true });
  });
});

describe("prependBatch(加载更早)", () => {
  const f = (type: string, data?: unknown, kind?: string, seq?: number) =>
    ({ type, ...(kind ? { kind } : {}), ...(data !== undefined ? { data } : {}), ...(seq !== undefined ? { seq } : {}) }) as Frame;

  it("更早的一段只贡献 items,不把此刻的运行态/用量覆盖成历史值", () => {
    const now: ChatState = {
      ...initialChat,
      items: [{ kind: "user", text: "现在这条" }],
      running: true,
      usage: { used: 999, size: 1000 },
    };
    const older = [
      f("task-started"),
      f("task-running", { update: { sessionUpdate: "usage_update", used: 1, size: 1000 } }, "acp_event"),
      f("task-ended"),
    ];

    const s = prependBatch(now, older);

    expect(s.running).toBe(true);
    expect(s.usage).toEqual({ used: 999, size: 1000 });
    expect(s.items[s.items.length - 1]).toEqual({ kind: "user", text: "现在这条" });
  });

  it("keyBase 左移与新增条数一致,既有条目的渲染 key 不变", () => {
    const now: ChatState = { ...initialChat, items: [{ kind: "user", text: "第二问" }] };
    const older = [f("user-input", { content: b64encode("第一问") }, undefined, 7), f("task-started"), f("task-ended")];

    const s = prependBatch(now, older);

    const added = s.items.length - now.items.length;
    expect(s.keyBase).toBe(now.keyBase - added);
    // 「第二问」原 key = 0 + 0;前插后 key = keyBase + 新下标,应当仍是 0
    expect(s.keyBase + s.items.indexOf(now.items[0])).toBe(0);
  });

  it("空的一页不动状态", () => {
    const now: ChatState = { ...initialChat, items: [{ kind: "user", text: "只有这条" }] };
    expect(prependBatch(now, [])).toBe(now);
  });
});

describe("大字段护栏标记透传", () => {
  it("_meta.mcSrc 原样带到工具项上(工具卡据此回读全文)", () => {
    // 壳侧物化时截断了 rawOutput,并在 _meta 留下按 seq 回读的凭据
    const s = reduceBatch(initialChat, [
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

    const tool = s.items.find((i) => i.kind === "tool") as Extract<LogItem, { kind: "tool" }>;
    expect((tool._meta as { mcSrc?: { seq?: number } }).mcSrc?.seq).toBe(42);
    // 行内头部照常渲染,卡片折叠态不受影响
    expect(tool.out).toContain("前 1KB");
  });
});
