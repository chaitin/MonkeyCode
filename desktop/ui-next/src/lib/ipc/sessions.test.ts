import { afterEach, describe, expect, it, vi } from "vitest";

import { modelsList, onSessionEvent, sessionCreate, sessionPatch, sessionsList } from "./sessions";

afterEach(() => vi.unstubAllGlobals());

describe("会话域 API", () => {
  it("浏览器模式:列表类返回空、变更类 reject、事件订阅为 no-op", async () => {
    vi.stubGlobal("window", {});
    expect(await sessionsList()).toEqual([]);
    expect(await modelsList()).toEqual([]);
    await expect(sessionCreate({ workdir: "/a", model: "m", createDir: false })).rejects.toThrow();
    expect(onSessionEvent(() => {})).toBeTypeOf("function");
  });

  it("壳内:命令名与参数按契约透传(camelCase 由 Tauri 映射)", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    vi.stubGlobal("window", {
      __TAURI__: {
        core: {
          invoke: (cmd: string, args?: Record<string, unknown>) => {
            calls.push({ cmd, args });
            if (cmd === "sessions_list") return Promise.resolve([{ id: "s1" }]);
            return Promise.resolve({ ok: true });
          },
        },
      },
    });
    await sessionsList();
    await sessionCreate({ workdir: "/w", model: "m", createDir: true, kind: "chat" });
    await sessionPatch("s1", { archived: true });
    expect(calls[0]?.cmd).toBe("sessions_list");
    expect(calls[1]).toEqual({
      cmd: "session_create",
      args: { workdir: "/w", model: "m", createDir: true, kind: "chat" },
    });
    expect(calls[2]).toEqual({ cmd: "session_patch", args: { id: "s1", patch: { archived: true } } });
  });

  // ⚠️ 这条此前钉的是「壳内列表命令失败回落空数组」——那正是 bug 本身:
  // sessions_list 在壳的 apply 闸门里回的是 Err「引擎配置正在应用,请稍后
  // 重试」,吞成 [] 之后 afterEngineReady 的退避重试永远等不到拒绝(死代码),
  // 而调用方拿到的空列表会被当成「用户一条会话都没有」,侧栏被清空、开着的
  // 对话卸载回欢迎页。降级值只留给浏览器模式那种静态事实。
  it("壳内失败一律抛给调用方(空结果只表示'没有',不表示'没拉到')", async () => {
    vi.stubGlobal("window", {
      __TAURI__: { core: { invoke: () => Promise.reject(new Error("引擎配置正在应用,请稍后重试")) } },
    });
    await expect(sessionsList()).rejects.toThrow("引擎配置正在应用");
    await expect(modelsList()).rejects.toThrow("引擎配置正在应用");
  });
});
