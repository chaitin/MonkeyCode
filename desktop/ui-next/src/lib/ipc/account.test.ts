import { afterEach, describe, expect, it, vi } from "vitest";

import {
  baizhiLogin,
  baizhiLogout,
  baizhiSendCode,
  baizhiStatus,
  baizhiSync,
  baizhiWechatPoll,
  baizhiWechatStart,
  disconnectMc,
  mcCheckin,
  mcLogin,
  mcLogout,
  mcModelsRevoke,
  mcModelsSync,
  mcPasswordLogin,
  mcStatus,
  mcUsage,
} from "./account";

afterEach(() => vi.unstubAllGlobals());

function stubInvoke(impl: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  vi.stubGlobal("window", {
    __TAURI__: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          calls.push({ cmd, args });
          return impl(cmd, args);
        },
      },
    },
  });
  return calls;
}

describe("account 契约:浏览器模式降级", () => {
  it("状态类返回 null:baizhiStatus / mcStatus / mcUsage", async () => {
    vi.stubGlobal("window", {});
    expect(await baizhiStatus()).toBeNull();
    expect(await mcStatus()).toBeNull();
    expect(await mcUsage()).toBeNull();
  });

  it("动作类抛「非桌面壳环境」", async () => {
    vi.stubGlobal("window", {});
    const actions: Array<() => Promise<unknown>> = [
      () => baizhiSendCode("13800000000"),
      () => baizhiLogin("13800000000", "123456"),
      () => baizhiLogout(),
      () => baizhiWechatStart(),
      () => baizhiWechatPoll(),
      () => baizhiSync([]),
      () => mcLogin(),
      () => mcPasswordLogin("a@b.c", "pw"),
      () => mcLogout(),
      () => mcCheckin(),
      () => mcModelsSync(),
      () => mcModelsRevoke(),
      () => disconnectMc(0),
    ];
    for (const act of actions) {
      await expect(act()).rejects.toThrow("非桌面壳环境");
    }
  });
});

describe("account 契约:百智云命令名与载荷形状", () => {
  it("baizhi_status 应答原样返回", async () => {
    const status = { logged_in: true, host: "baizhi.cloud", profile: { name: "张三" } };
    const calls = stubInvoke(() => Promise.resolve(status));
    expect(await baizhiStatus()).toEqual(status);
    expect(calls).toEqual([{ cmd: "baizhi_status", args: undefined }]);
  });

  it("发码/登录/登出:命令与参数字面量", async () => {
    const calls = stubInvoke(() => Promise.resolve({ ok: true }));
    await baizhiSendCode("13800000000");
    await baizhiLogin("13800000000", "654321");
    await baizhiLogout();
    expect(calls).toEqual([
      { cmd: "baizhi_send_code", args: { phone: "13800000000" } },
      { cmd: "baizhi_login", args: { phone: "13800000000", code: "654321" } },
      { cmd: "baizhi_logout", args: undefined },
    ]);
  });

  it("微信扫码:start 返回 {qr},poll 返回 {status};壳的中文 Err 原样上抛", async () => {
    const calls = stubInvoke((cmd) =>
      Promise.resolve(cmd === "baizhi_wechat_start" ? { qr: "data:image/jpeg;base64,x" } : { status: "scanned" }),
    );
    expect(await baizhiWechatStart()).toEqual({ qr: "data:image/jpeg;base64,x" });
    expect(await baizhiWechatPoll()).toEqual({ status: "scanned" });
    expect(calls.map((c) => c.cmd)).toEqual(["baizhi_wechat_start", "baizhi_wechat_poll"]);

    stubInvoke(() => Promise.reject(new Error("没有进行中的扫码会话,请先获取二维码")));
    await expect(baizhiWechatPoll()).rejects.toThrow("没有进行中的扫码会话");
  });

  it("baizhi_sync 以 { knownKeys } 携带候选密钥,结果原样返回", async () => {
    const result = { models: [], mcp_servers: {}, key_created: false, key_name: "MonkeyCode", notes: ["n"] };
    const calls = stubInvoke(() => Promise.resolve(result));
    expect(await baizhiSync(["sk-1", "sk-2"])).toEqual(result);
    expect(calls).toEqual([{ cmd: "baizhi_sync", args: { knownKeys: ["sk-1", "sk-2"] } }]);
  });
});

describe("account 契约:MonkeyCode 命令名与载荷形状", () => {
  it("mc_status / mc_usage 应答原样返回", async () => {
    const status = { logged_in: true, host: "monkeycode-ai.com", user: { id: "u1", name: "云端用户" } };
    const usage = { base_url: "https://mc", wallet: null, subscription: null, checked_in: null, invitations: null };
    const calls = stubInvoke((cmd) => Promise.resolve(cmd === "mc_status" ? status : usage));
    expect(await mcStatus()).toEqual(status);
    expect(await mcUsage()).toEqual(usage);
    expect(calls.map((c) => c.cmd)).toEqual(["mc_status", "mc_usage"]);
  });

  it("mc_password_login 原样透传 email/password(password 不 trim,壳侧契约)", async () => {
    const calls = stubInvoke(() => Promise.resolve({ ok: true }));
    await mcPasswordLogin("a@b.c", " pw with spaces ");
    expect(calls).toEqual([{ cmd: "mc_password_login", args: { email: "a@b.c", password: " pw with spaces " } }]);
  });

  it("mc_login / mc_checkin / mc_models_sync:命令字面量及同步代次", async () => {
    const calls = stubInvoke((cmd) =>
      Promise.resolve(cmd === "mc_models_sync" ? { models: [{}], notes: [] } : { ok: true }),
    );
    await mcLogin();
    await mcCheckin();
    expect((await mcModelsSync(4)).models).toHaveLength(1);
    expect(calls.map((c) => c.cmd)).toEqual(["mc_login", "mc_checkin", "mc_models_sync"]);
    expect(calls.at(-1)?.args).toEqual({ expectedGeneration: 4 });
  });
});

describe("disconnectMc:壳内原子断开", () => {
  it("正常断开只调用一次 mc_disconnect", async () => {
    const calls = stubInvoke(() => Promise.resolve({ ok: true }));
    expect(await disconnectMc(7)).toEqual({});
    expect(calls).toEqual([{ cmd: "mc_disconnect", args: { expectedGeneration: 7 } }]);
  });

  it("吊销失败由壳在同一应答中返回 warning", async () => {
    const calls = stubInvoke(() => Promise.resolve({ ok: true, warning: "网络不可达" }));
    expect(await disconnectMc(0)).toEqual({ warning: "网络不可达" });
    expect(calls.map((c) => c.cmd)).toEqual(["mc_disconnect"]);
  });

  it("切服时壳取消旧断开", async () => {
    stubInvoke(() => Promise.resolve({ ok: false, cancelled: true }));
    expect(await disconnectMc(0)).toEqual({ cancelled: true });
  });

  it("壳命令失败照常上抛", async () => {
    stubInvoke(() => Promise.reject(new Error("登出失败")));
    await expect(disconnectMc(0)).rejects.toThrow("登出失败");
  });
});
