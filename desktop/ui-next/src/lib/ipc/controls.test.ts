import { afterEach, describe, expect, it, vi } from "vitest";

import { b64encode } from "@/lib/protocol/codec";
import { sessionOutline, sessionSetMode, sessionSetModel, sessionSetThink, sessionSteer } from "./controls";

afterEach(() => vi.unstubAllGlobals());

function stubShell(handler: (cmd: string, args?: Record<string, unknown>) => unknown) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  vi.stubGlobal("window", {
    __TAURI__: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          calls.push({ cmd, args });
          const r = handler(cmd, args);
          return r instanceof Promise ? r : Promise.resolve(r ?? null);
        },
      },
    },
  });
  return calls;
}

describe("session_call 封装(载荷契约对表壳侧 session.rs)", () => {
  it("切模型/思考档/权限模式的 kind 与 payload", async () => {
    const calls = stubShell(() => ({ result: {} }));
    await sessionSetModel("s1", "gpt-x@baizhi");
    await sessionSetThink("s1", "high");
    await sessionSetMode("s1", "yolo");
    expect(calls).toEqual([
      { cmd: "session_call", args: { id: "s1", kind: "session_set_model", payload: { model: "gpt-x@baizhi" } } },
      { cmd: "session_call", args: { id: "s1", kind: "session_set_think", payload: { think: "high" } } },
      { cmd: "session_call", args: { id: "s1", kind: "session_set_mode", payload: { mode: "yolo" } } },
    ]);
  });

  it("runtime steering 复用 session_call 并编码正文", async () => {
    const calls = stubShell(() => ({ result: {} }));
    await sessionSteer("s1", "补充说明🐛", "client-1");
    expect(calls).toEqual([{
      cmd: "session_call",
      args: { id: "s1", kind: "session_steer", payload: { content: b64encode("补充说明🐛"), client_id: "client-1" } },
    }]);
  });

  it("应答 {error} 转 reject(壳对未知 kind 回 Ok({error}),不能吞)", async () => {
    stubShell(() => ({ error: "执行中不能切换" }));
    await expect(sessionSetModel("s1", "m")).rejects.toThrow("执行中不能切换");
  });

  it("invoke reject 原样上抛(壳侧 Err,如运行中切模型)", async () => {
    stubShell(() => Promise.reject(new Error("请先取消当前任务")));
    await expect(sessionSetThink("s1", "low")).rejects.toThrow("请先取消当前任务");
  });
});

describe("session_outline 封装", () => {
  it("解码 base64 正文;坏载荷按空条目;null timestamp 缺席", async () => {
    stubShell(() => [
      { seq: 3, offset: 120, content: b64encode("修复登录"), timestamp: 1000 },
      { seq: 9, offset: 0, content: "!!!not-base64!!!", timestamp: null },
    ]);
    expect(await sessionOutline("s1")).toEqual([
      { seq: 3, offset: 120, text: "修复登录", timestamp: 1000 },
      { seq: 9, offset: 0, text: "" },
    ]);
  });

  it("非数组/失败回空", async () => {
    stubShell(() => null);
    expect(await sessionOutline("s1")).toEqual([]);
    stubShell(() => Promise.reject(new Error("boom")));
    expect(await sessionOutline("s1")).toEqual([]);
  });
});
