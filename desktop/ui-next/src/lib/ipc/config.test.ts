import { afterEach, describe, expect, it, vi } from "vitest";

import {
  exportEngineLog,
  getConfig,
  getSoundEnabled,
  listWslDistros,
  onSoundEnabled,
  openExtensionDir,
  saveConfig,
  setSoundEnabled,
  type DesktopConfig,
} from "./config";

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

const sampleConfig: DesktopConfig = {
  models: [{ name: "主力", provider: "anthropic", base_url: "https://a", api_key: "sk", model: "m", default: true }],
  mcp_servers: { fetch: { url: "https://mcp" } },
  kernel_env: "wsl:Ubuntu",
  mc_base_url: "https://mc",
  mc_basic_auth: "",
  mc_llm_base_url: "",
  agent_engine: "ohmy",
  pet_enabled: false,
  sound_enabled: true,
  pet_pos: [10, 20],
  telemetry_enabled: true,
};

describe("config 契约:浏览器模式降级(与旧 host.ts 同语义)", () => {
  it("读:getConfig null、提示音默认开、WSL 空、导出/扩展目录 null", async () => {
    vi.stubGlobal("window", {});
    expect(await getConfig()).toBeNull();
    expect(await getSoundEnabled()).toBe(true);
    expect(await listWslDistros()).toEqual([]);
    expect(await exportEngineLog()).toBeNull();
    expect(await openExtensionDir()).toBeNull();
  });

  it("写:saveConfig 抛「浏览器模式下配置只读」", async () => {
    vi.stubGlobal("window", {});
    await expect(saveConfig(sampleConfig)).rejects.toThrow("浏览器模式下配置只读,请在桌面应用中修改");
  });

  it("onSoundEnabled 非壳环境返回 no-op 退订", () => {
    vi.stubGlobal("window", {});
    expect(() => onSoundEnabled(() => {})()).not.toThrow();
  });
});

describe("config 契约:壳内载荷透传(命令名与参数形状)", () => {
  it("get_config 应答原样返回(含表单外字段与壳自有偏好)", async () => {
    const calls = stubInvoke(() => Promise.resolve(sampleConfig));
    expect(await getConfig()).toEqual(sampleConfig);
    expect(calls).toEqual([{ cmd: "get_config", args: undefined }]);
  });

  it("save_config 以 { config } 全量携带载荷;壳 Err(中文)原样上抛", async () => {
    const calls = stubInvoke(() => Promise.resolve(null));
    await saveConfig(sampleConfig);
    expect(calls).toEqual([{ cmd: "save_config", args: { config: sampleConfig } }]);

    stubInvoke(() => Promise.reject(new Error("引擎启动失败: 模型配置无效")));
    await expect(saveConfig(sampleConfig)).rejects.toThrow("引擎启动失败: 模型配置无效");
  });

  it("提示音:sound_enabled 读值,set_sound_enabled 携带 { enabled }", async () => {
    const calls = stubInvoke((cmd) => Promise.resolve(cmd === "sound_enabled" ? false : null));
    expect(await getSoundEnabled()).toBe(false);
    await setSoundEnabled(true);
    expect(calls).toEqual([
      { cmd: "sound_enabled", args: undefined },
      { cmd: "set_sound_enabled", args: { enabled: true } },
    ]);
  });

  it("list_wsl_distros 返回列表;失败降级空数组(UI 据此只留本机)", async () => {
    stubInvoke(() => Promise.resolve(["Ubuntu", "Debian"]));
    expect(await listWslDistros()).toEqual(["Ubuntu", "Debian"]);
    stubInvoke(() => Promise.reject(new Error("boom")));
    expect(await listWslDistros()).toEqual([]);
  });

  it("export_engine_log:用户取消 null 原样返回,失败中文错误上抛", async () => {
    stubInvoke(() => Promise.resolve(null));
    expect(await exportEngineLog()).toBeNull();
    stubInvoke(() => Promise.resolve("/tmp/ohmyagent.log"));
    expect(await exportEngineLog()).toBe("/tmp/ohmyagent.log");
    stubInvoke(() => Promise.reject(new Error("引擎日志不存在(引擎尚未启动过)")));
    await expect(exportEngineLog()).rejects.toThrow("引擎日志不存在");
  });

  it("open_extension_dir 返回目录路径", async () => {
    const calls = stubInvoke(() => Promise.resolve("/opt/app/browser-extension"));
    expect(await openExtensionDir()).toBe("/opt/app/browser-extension");
    expect(calls[0]?.cmd).toBe("open_extension_dir");
  });

  it("sound-enabled 事件:payload 归一为布尔(非 false 即开)", async () => {
    const events: Array<{ name: string; cb: (e: { payload: unknown }) => void }> = [];
    vi.stubGlobal("window", {
      __TAURI__: {
        core: { invoke: () => Promise.resolve(null) },
        event: {
          listen: (name: string, cb: (e: { payload: unknown }) => void) => {
            events.push({ name, cb });
            return Promise.resolve(() => {});
          },
        },
      },
    });
    const seen: boolean[] = [];
    onSoundEnabled((on) => seen.push(on));
    expect(events[0]?.name).toBe("sound-enabled");
    events[0]?.cb({ payload: false });
    events[0]?.cb({ payload: true });
    expect(seen).toEqual([false, true]);
  });
});
