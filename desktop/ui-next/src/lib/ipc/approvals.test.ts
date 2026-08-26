import { afterEach, describe, expect, it, vi } from "vitest";

import {
  engineCaps,
  engineCapsRequired,
  sendAskAnswers,
  sendAskAnswersVia,
  sendAskCancel,
  sendAskCancelVia,
  sendPermAnswer,
  sendPermAnswerVia,
  type FrameSender,
} from "./approvals";

afterEach(() => vi.unstubAllGlobals());

interface Call {
  cmd: string;
  args?: Record<string, unknown>;
}

function stubShell(handle?: (cmd: string) => unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("window", {
    __TAURI__: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          calls.push({ cmd, args });
          return Promise.resolve(handle ? handle(cmd) : undefined);
        },
      },
    },
  });
  return calls;
}

describe("审批答复(permission-resp,载荷对表壳侧 session.rs)", () => {
  it.each([
    ["allow", { approved: true, remember: false, persist: false }],
    ["always", { approved: true, remember: true, persist: false }],
    ["persist", { approved: true, remember: true, persist: true }],
    ["deny", { approved: false, remember: false, persist: false }],
  ] as const)("动作 %s 的档位映射", async (action, expected) => {
    const calls = stubShell();
    await sendPermAnswer("s1", "p1", action);
    expect(calls).toEqual([
      {
        cmd: "session_send",
        args: { id: "s1", ftype: "permission-resp", payload: { id: "p1", ...expected } },
      },
    ]);
  });
});

describe("提问答复(reply-question)", () => {
  it("answers_json 是 {问题: 答案} 的 JSON 字符串,多选为数组", async () => {
    const calls = stubShell();
    await sendAskAnswers("s1", "req-1", { 用哪种方案: "A", 选依赖: ["x", "y"] });
    expect(calls[0]).toEqual({
      cmd: "session_send",
      args: {
        id: "s1",
        ftype: "reply-question",
        payload: {
          request_id: "req-1",
          answers_json: JSON.stringify({ 用哪种方案: "A", 选依赖: ["x", "y"] }),
          cancelled: false,
        },
      },
    });
  });

  it("跳过回答:cancelled=true 且答案为空对象", async () => {
    const calls = stubShell();
    await sendAskCancel("s1", "req-1");
    expect(calls[0]?.args).toEqual({
      id: "s1",
      ftype: "reply-question",
      payload: { request_id: "req-1", answers_json: "{}", cancelled: true },
    });
  });
});

describe("注入 sender(云端任务经 stream WS 上行的发送面)", () => {
  it("三个答复走注入 sender:帧词汇与载荷跟本地路径一字不差,且不触 IPC", async () => {
    const calls = stubShell(); // 即便在壳内,注入路径也绝不能落到 session_send
    const sent: { ftype: string; payload: Record<string, unknown> }[] = [];
    const sender: FrameSender = (ftype, payload) => {
      sent.push({ ftype, payload });
      return Promise.resolve();
    };
    await sendPermAnswerVia(sender, "p1", "persist");
    await sendAskAnswersVia(sender, "req-1", { 用哪种方案: "A", 选依赖: ["x", "y"] });
    await sendAskCancelVia(sender, "req-1");
    expect(sent).toEqual([
      {
        ftype: "permission-resp",
        payload: { id: "p1", approved: true, remember: true, persist: true },
      },
      {
        ftype: "reply-question",
        payload: {
          request_id: "req-1",
          answers_json: JSON.stringify({ 用哪种方案: "A", 选依赖: ["x", "y"] }),
          cancelled: false,
        },
      },
      {
        ftype: "reply-question",
        payload: { request_id: "req-1", answers_json: "{}", cancelled: true },
      },
    ]);
    expect(calls).toEqual([]);
  });

  it("sender 拒绝时错误向上抛(卡片的失败回滚依赖 reject)", async () => {
    const sender: FrameSender = () => Promise.reject(new Error("ws down"));
    await expect(sendPermAnswerVia(sender, "p1", "allow")).rejects.toThrow("ws down");
  });
});

describe("engineCaps", () => {
  it("壳内走 engine_caps 命令(invoke 字面量契约)", async () => {
    const calls = stubShell(() => ({
      browser_ext: false,
      usage_update: true,
      perm_remember: false,
      attachments: true,
    }));
    const caps = await engineCaps();
    expect(calls[0]?.cmd).toBe("engine_caps");
    expect(caps?.perm_remember).toBe(false);
  });

  it("浏览器模式返回 null(不 reject)", async () => {
    vi.stubGlobal("window", {});
    expect(await engineCaps()).toBeNull();
    expect(await engineCapsRequired()).toBeNull();
  });

  it("strict API 在壳内保留 invoke reject，供就绪退避重试", async () => {
    vi.stubGlobal("window", {
      __TAURI__: { core: { invoke: () => Promise.reject(new Error("engine starting")) } },
    });
    await expect(engineCapsRequired()).rejects.toThrow("engine starting");
  });

  it("命令失败回落 null(引擎未就绪不炸 UI)", async () => {
    vi.stubGlobal("window", {
      __TAURI__: { core: { invoke: () => Promise.reject(new Error("engine starting")) } },
    });
    expect(await engineCaps()).toBeNull();
  });
});
