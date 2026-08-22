import { describe, expect, it } from "vitest";

import { createChatState } from "@/lib/protocol/reduce";
import type { ChatState, PermItem } from "@/lib/protocol/types";
import {
  openPermIdOf,
  resolveAppShortcut,
  resolveShortcut,
  shortcutChord,
  type AppShortcutCtx,
  type ShortcutAction,
  type ShortcutCtx,
} from "./shortcuts";

const ALLOW: ShortcutAction = { kind: "perm", id: "p1", approved: true };
const DENY: ShortcutAction = { kind: "perm", id: "p1", approved: false };
const NONE: ShortcutAction = { kind: "none" };
const BLUR: ShortcutAction = { kind: "blur" };

describe("resolveShortcut(表驱动:允许/拒绝都不可逆,守卫逐条钉死)", () => {
  const table: Array<[string, ShortcutCtx, ShortcutAction]> = [
    // ---- Enter = 允许 ----
    ["⏎ 无待决审批 → 不消费", { key: "Enter", openPermId: null }, NONE],
    ["⏎ 有待决审批(焦点在 body)→ 允许", { key: "Enter", openPermId: "p1" }, ALLOW],
    ["⏎ 输入框有草稿 → 不劫持(正在写消息)", { key: "Enter", openPermId: "p1", targetTag: "TEXTAREA", inputText: "还没发的话" }, NONE],
    ["⏎ 草稿只有空白 → 仍是允许", { key: "Enter", openPermId: "p1", targetTag: "TEXTAREA", inputText: "  " }, ALLOW],
    ["⏎ INPUT 有内容 → 不劫持", { key: "Enter", openPermId: "p1", targetTag: "INPUT", inputText: "x" }, NONE],
    ["⏎ IME 组合中 → 不消费(候选词交互)", { key: "Enter", openPermId: "p1", isComposing: true }, NONE],
    ["Ctrl+⏎ → 不消费", { key: "Enter", openPermId: "p1", ctrlKey: true }, NONE],
    ["Cmd+⏎ → 不消费", { key: "Enter", openPermId: "p1", metaKey: true }, NONE],
    ["Alt+⏎ → 不消费", { key: "Enter", openPermId: "p1", altKey: true }, NONE],
    ["Shift+⏎ → 不消费", { key: "Enter", openPermId: "p1", shiftKey: true }, NONE],
    ["局部已消费 ⏎ → 不消费", { key: "Enter", openPermId: "p1", defaultPrevented: true }, NONE],
    ["⏎ SELECT 聚焦 → 允许(原生 select 不吃 ⏎)", { key: "Enter", openPermId: "p1", targetTag: "SELECT" }, ALLOW],
    // ---- Escape = 拒绝 ----
    ["esc 有待决审批(焦点在 body)→ 拒绝", { key: "Escape", openPermId: "p1" }, DENY],
    ["esc 输入框聚焦 → 只收敛焦点,不误拒", { key: "Escape", openPermId: "p1", targetTag: "TEXTAREA" }, BLUR],
    ["esc INPUT 聚焦 → 只收敛焦点", { key: "Escape", openPermId: "p1", targetTag: "INPUT", inputText: "x" }, BLUR],
    ["esc SELECT 聚焦 → 只收敛焦点(esc 归下拉)", { key: "Escape", openPermId: "p1", targetTag: "SELECT" }, BLUR],
    ["esc 无待决审批 → 不消费(交上层浮层链)", { key: "Escape", openPermId: null }, NONE],
    ["esc IME 组合中 → 不消费", { key: "Escape", openPermId: "p1", isComposing: true }, NONE],
    // ---- 终端内(xterm 隐藏 textarea value 恒空,草稿守卫失效) ----
    ["⏎ 终端聚焦 → 不消费(不劫持为允许)", { key: "Enter", openPermId: "p1", targetTag: "TEXTAREA", inTerminal: true }, NONE],
    ["esc 终端聚焦 → 不消费(不 blur 不误拒)", { key: "Escape", openPermId: "p1", targetTag: "TEXTAREA", inTerminal: true }, NONE],
    ["esc 终端聚焦且无待决审批 → 仍不消费", { key: "Escape", openPermId: null, targetTag: "TEXTAREA", inTerminal: true }, NONE],
    // ---- 其他键 ----
    ["普通按键 → 不消费", { key: "a", openPermId: "p1" }, NONE],
    ["Tab → 不消费", { key: "Tab", openPermId: "p1" }, NONE],
  ];

  it.each(table)("%s", (_name, ctx, expected) => {
    expect(resolveShortcut(ctx)).toEqual(expected);
  });
});

describe("resolveAppShortcut", () => {
  const key = (over: Partial<AppShortcutCtx>): AppShortcutCtx => ({ code: "", key: "", ...over });

  it.each([
    ["KeyN", "new-task"],
    ["KeyL", "focus-composer"],
    ["Comma", "open-settings"],
    ["KeyB", "toggle-sidebar"],
    ["Period", "toggle-permission"],
    ["Backslash", "split-right"],
  ] as const)("mac Cmd+%s", (code, action) => {
    expect(resolveAppShortcut(key({ code, metaKey: true }), "mac")).toBe(action);
    expect(resolveAppShortcut(key({ code, ctrlKey: true }), "mac")).toBeNull();
  });

  it("Windows/Linux 用 Ctrl，并区分两种分屏", () => {
    expect(resolveAppShortcut(key({ code: "KeyN", ctrlKey: true }), "other")).toBe("new-task");
    expect(resolveAppShortcut(key({ code: "Backslash", ctrlKey: true }), "other")).toBe("split-right");
    expect(resolveAppShortcut(key({ code: "Backslash", ctrlKey: true, shiftKey: true }), "other")).toBe("split-down");
    expect(resolveAppShortcut(key({ code: "KeyN", metaKey: true }), "other")).toBeNull();
  });

  it("权限 Shift+Tab 与停止 Esc 只接受精确修饰键，IME/已消费一律让路", () => {
    expect(resolveAppShortcut(key({ code: "Tab", key: "Tab", shiftKey: true }), "other")).toBe("toggle-permission");
    expect(resolveAppShortcut(key({ code: "Tab", key: "Tab", shiftKey: true, ctrlKey: true }), "other")).toBeNull();
    expect(resolveAppShortcut(key({ code: "Escape", key: "Escape" }), "other")).toBe("stop-generation");
    expect(resolveAppShortcut(key({ code: "Escape", key: "Escape", altKey: true }), "other")).toBeNull();
    expect(resolveAppShortcut(key({ code: "KeyN", ctrlKey: true, isComposing: true }), "other")).toBeNull();
    expect(resolveAppShortcut(key({ code: "KeyN", ctrlKey: true, defaultPrevented: true }), "other")).toBeNull();
  });

  it("展示文案随平台替换主修饰键", () => {
    expect(shortcutChord("open-settings", "mac")).toBe("⌘+,");
    expect(shortcutChord("split-down", "other")).toBe("Ctrl+Shift+\\");
  });
});

describe("openPermIdOf", () => {
  const perm = (id: string, state: PermItem["state"]): PermItem => ({ kind: "perm", id, title: "t", tool: "Bash", state });
  const withItems = (items: ChatState["items"]): ChatState => ({ ...createChatState(), items });

  it("取最近一张 open 审批(尾部优先)", () => {
    expect(openPermIdOf(withItems([perm("p1", "open"), { kind: "sys", text: "x" }, perm("p2", "open")]))).toBe("p2");
  });

  it("已决/过期不算目标", () => {
    expect(openPermIdOf(withItems([perm("p1", "approved"), perm("p2", "expired")]))).toBeNull();
  });

  it("空流为 null", () => {
    expect(openPermIdOf(withItems([]))).toBeNull();
  });
});
