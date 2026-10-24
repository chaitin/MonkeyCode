import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { PetPreferences, PetSettings } from "@/lib/ipc/pet";
import { PetSection } from "./PetSection";
vi.mock("@/lib/pet-audio-import", () => ({ preparePetAudio: vi.fn(async () => "test-audio") }));

const defaults: PetPreferences = {
  scale: 100, snap: true, bubble: "tasks", click_bubble: "credits", bubble_seconds: 6, quota_alerts: true, quota_warning: 20, quota_critical: 10,
  credits_warning: 100, quiet_enabled: false, quiet_start: 1320, quiet_end: 480, muted_until: 0,
  sounds: Object.fromEntries(["press", "release", "start", "end", "error", "approval", "question", "idle"].map(k => [k, { enabled: true, volume: 70, source: "default" }])) as PetPreferences["sounds"],
};

function shell(extra: Record<string, (args?: Record<string, unknown>) => unknown> = {}) {
  let settings: PetSettings = { preferences: structuredClone(defaults), defaults, enabled: true };
  const listeners: Record<string, (e: { payload: unknown }) => void> = {};
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (extra[cmd]) return extra[cmd](args);
    if (cmd === "pet_preferences") return settings;
    if (cmd === "sound_enabled") return true;
    if (cmd === "pet_wallet") return { status: "signed_out", credits: null, remaining: null, total: null };
    if (cmd === "pet_set_preferences") {
      const patch = args?.patch as Partial<PetPreferences>;
      const sounds = { ...settings.preferences.sounds };
      for (const [key, value] of Object.entries(patch.sounds || {})) sounds[key as keyof typeof sounds] = { ...sounds[key as keyof typeof sounds], ...value };
      settings = { ...settings, preferences: { ...settings.preferences, ...patch, sounds } };
      return settings.preferences;
    }
    return null;
  });
  Object.assign(window, { __TAURI__: { core: { invoke }, event: {
    listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
      listeners[name] = cb;
      return () => { delete listeners[name]; };
    },
  } } });
  return { invoke, emit: (name: string, payload?: unknown) => act(() => { listeners[name]?.({ payload }); }) };
}

beforeEach(() => setLocale("zh-CN"));
afterEach(() => { Reflect.deleteProperty(window, "__TAURI__"); });

it("额度未知显示占位，滑块松手才持久化，菜单变更同步到设置页", async () => {
  const host = shell(); render(<PetSection />);
  const scale = await screen.findByRole("slider", { name: "大小" });
  expect(screen.getByText("登录 MonkeyCode 账号后可查看")).toBeDefined();
  fireEvent.pointerDown(scale); fireEvent.change(scale, { target: { value: "125" } });
  expect(host.invoke.mock.calls.some(([cmd]) => cmd === "pet_set_preferences")).toBe(false);
  fireEvent.pointerUp(scale);
  await waitFor(() => expect(host.invoke).toHaveBeenCalledWith("pet_set_preferences", { patch: { scale: 125 } }));
  host.emit("pet-preferences", { preferences: { ...defaults, scale: 80, snap: false }, defaults, enabled: false });
  expect((screen.getByRole("slider", { name: "大小" }) as HTMLInputElement).value).toBe("80");
  expect((screen.getByRole("checkbox", { name: "显示萌宠" }) as HTMLInputElement).checked).toBe(false);
});

it("保存失败保留原值并显示错误，非法额度阈值不发给壳", async () => {
  const host = shell({ pet_set_preferences: () => Promise.reject(new Error("磁盘不可写")) });
  render(<PetSection />);
  await userEvent.click(await screen.findByRole("checkbox", { name: "边缘吸附" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Error: 磁盘不可写");
  expect((screen.getByRole("checkbox", { name: "边缘吸附" }) as HTMLInputElement).checked).toBe(true);
  host.invoke.mockClear();
  const threshold = screen.getByRole("spinbutton", { name: "额度紧急阈值（剩余 %）" });
  fireEvent.change(threshold, { target: { value: "30" } }); fireEvent.blur(threshold);
  expect(host.invoke).not.toHaveBeenCalled();
  expect((threshold as HTMLInputElement).value).toBe("10");
});

it("账号切换后立即清空旧余额，过期查询不能覆盖新账号", async () => {
  let finishOld: (v: unknown) => void = () => {};
  let count = 0;
  const host = shell({ pet_wallet: () => ++count === 1 ? new Promise(resolve => { finishOld = resolve; })
    : { status: "ready", credits: 22, remaining: 500, total: 1000 } });
  render(<PetSection />); await screen.findByRole("slider", { name: "大小" });
  host.emit("pet-wallet-invalidated");
  expect(await screen.findByText("22")).toBeDefined();
  await act(async () => finishOld({ status: "ready", credits: 999, remaining: 1000, total: 1000 }));
  expect(screen.queryByText("999")).toBeNull();
  expect(screen.getByText("22")).toBeDefined();
});

it("跨午夜勿扰、恢复默认和试听通过独立命令立即生效", async () => {
  const host = shell(); render(<PetSection />);
  await userEvent.click(await screen.findByRole("checkbox", { name: "定时勿扰" }));
  expect(await screen.findByLabelText("勿扰开始时间")).toHaveProperty("value", "22:00");
  expect(screen.getByLabelText("勿扰结束时间")).toHaveProperty("value", "08:00");
  await userEvent.click(screen.getByRole("button", { name: "试听等待审批" }));
  expect(host.invoke).toHaveBeenCalledWith("pet_preview_sound", { sound: "approval" });
  await userEvent.click(screen.getByRole("button", { name: "恢复默认萌宠设置" }));
  expect(host.invoke).toHaveBeenCalledWith("pet_set_preferences", { patch: defaults });
  await waitFor(() => expect(screen.queryByLabelText("勿扰开始时间")).toBeNull());
});

it("导入成功后可给事件选择自定义声音，失败不留下虚假的音效选项", async () => {
  const assets: {id: string; name: string}[] = [];
  let fail = false;
  const host = shell({ pet_sound_list: () => [...assets], pet_sound_import: args => {
    if (fail) throw new Error("音效无法保存");
    const asset = { id: "a".repeat(64), name: String(args?.name) }; assets.push(asset); return asset;
  } });
  render(<PetSection />); await screen.findByRole("slider", { name: "大小" });
  fireEvent.change(screen.getByLabelText("导入音效", { selector: "input" }), { target: { files: [new File(["audio"], "小铃声.wav", { type: "audio/wav" })] } });
  await waitFor(() => expect(screen.getByLabelText("摸摸：按下音效选择").textContent).toContain("小铃声.wav"));
  await userEvent.selectOptions(screen.getByLabelText("摸摸：按下音效选择"), `custom:${"a".repeat(64)}`);
  expect(host.invoke).toHaveBeenCalledWith("pet_set_preferences", { patch: { sounds: { press: { source: `custom:${"a".repeat(64)}` } } } });
  fail = true;
  fireEvent.change(screen.getByLabelText("导入音效", { selector: "input" }), { target: { files: [new File(["audio"], "失败.wav")] } });
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Error: 音效无法保存");
  expect(screen.getByLabelText("摸摸：按下音效选择").textContent).not.toContain("失败.wav");
});
