// 全局键盘审批:⏎ 允许 / esc 拒绝。判定是纯函数(resolveShortcut),
// 不触 DOM——允许/拒绝都是不可逆动作,守卫必须可被表驱动测试钉死;
// useApprovalHotkeys 只是把 DOM 读取(事件目标/草稿内容)喂给判定的薄壳。
import { useEffect, useRef } from "react";

import { localFrameSender, sendPermAnswerVia, type FrameSender } from "@/lib/ipc/approvals";
import type { ChatState } from "@/lib/protocol/types";

export interface ShortcutCtx {
  key: string;
  /** 局部组件已经消费；全局层不得重复执行。 */
  defaultPrevented?: boolean;
  /** IME 组合中:⏎/esc 属于候选词交互,不能当审批应答 */
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** 事件目标标签名(大写;无目标 undefined) */
  targetTag?: string;
  /** 目标输入框里已有的内容(⏎ 不抢正在写的消息) */
  inputText?: string;
  /** 焦点在 xterm 终端内:终端的隐藏 textarea value 恒空,"草稿非空"守卫
   * 对它失效——Enter 会被劫持成审批允许,Esc 会把终端 blur 掉。终端里的
   * 每一次按键都属于终端本身,审批热键一律不消费 */
  inTerminal?: boolean;
  /** 最近一张待答复审批卡 id(无则 null) */
  openPermId: string | null;
}

export type ShortcutAction =
  /** 不消费:esc 交由上层浮层链/默认行为 */
  | { kind: "none" }
  /** 输入态 esc 只收敛焦点(尤其不能当审批拒绝——deny 不可逆) */
  | { kind: "blur" }
  | { kind: "perm"; id: string; approved: boolean };

const NONE: ShortcutAction = { kind: "none" };

/** esc 的输入态含 SELECT(下拉展开时 esc 归下拉);⏎ 靠"草稿非空"守卫,
 * 原生 select 无草稿概念,空草稿的 ⏎ 照常应答审批。 */
const TYPING_TAGS = new Set(["TEXTAREA", "INPUT", "SELECT"]);

export function resolveShortcut(ctx: ShortcutCtx): ShortcutAction {
  if (ctx.defaultPrevented) return NONE;
  if (ctx.isComposing) return NONE;
  if (ctx.inTerminal) return NONE;
  const typing = TYPING_TAGS.has(ctx.targetTag ?? "");
  if (ctx.key === "Enter") {
    // 审批允许是不可逆动作，只认裸 Enter；带修饰键的 Enter 留给局部交互。
    if (ctx.ctrlKey || ctx.metaKey || ctx.altKey || ctx.shiftKey) return NONE;
    if (!ctx.openPermId) return NONE;
    if (typing && (ctx.inputText ?? "").trim()) return NONE; // 正在写消息,不劫持
    return { kind: "perm", id: ctx.openPermId, approved: true };
  }
  if (ctx.key === "Escape") {
    if (typing) return { kind: "blur" };
    // 浮层优先:开着的浮层(文件抽屉/子会话回放弹层)在 window capture 阶段
    // 消费 Esc 并 stopImmediatePropagation,事件根本到不了这里(本 hook 挂
    // bubble 阶段);能走到这条 deny 路径的 Esc,必然是没有浮层在场的那一下。
    // deny 不可逆,同一下按键绝不允许"关浮层 + 拒绝审批"双消费
    if (ctx.openPermId) return { kind: "perm", id: ctx.openPermId, approved: false };
    return NONE;
  }
  return NONE;
}

export type AppShortcutAction =
  | "new-task"
  | "focus-composer"
  | "open-settings"
  | "toggle-sidebar"
  | "split-right"
  | "split-down"
  | "toggle-permission"
  | "stop-generation";

export type ShortcutPlatform = "mac" | "other";

export interface AppShortcutCtx {
  code: string;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

/** 应用快捷键按物理键位解析，不受键盘布局或输入法产生的 `key` 影响。 */
export function resolveAppShortcut(ctx: AppShortcutCtx, platform: ShortcutPlatform): AppShortcutAction | null {
  if (ctx.defaultPrevented || ctx.isComposing) return null;
  const ctrl = !!ctx.ctrlKey;
  const meta = !!ctx.metaKey;
  const alt = !!ctx.altKey;
  const shift = !!ctx.shiftKey;

  if (ctx.key === "Escape" && !ctrl && !meta && !alt && !shift) return "stop-generation";
  if (ctx.code === "Tab" && shift && !ctrl && !meta && !alt) return "toggle-permission";

  const primary = platform === "mac" ? meta && !ctrl : ctrl && !meta;
  if (!primary || alt) return null;
  if (ctx.code === "Backslash") return shift ? "split-down" : "split-right";
  if (shift) return null;
  switch (ctx.code) {
    case "KeyN":
      return "new-task";
    case "KeyL":
      return "focus-composer";
    case "Comma":
      return "open-settings";
    case "KeyB":
      return "toggle-sidebar";
    case "Period":
      return "toggle-permission";
    default:
      return null;
  }
}

export function shortcutPlatform(): ShortcutPlatform {
  try {
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "mac" : "other";
  } catch {
    return "other";
  }
}

export function appShortcutOfEvent(e: KeyboardEvent): AppShortcutAction | null {
  return resolveAppShortcut(e, shortcutPlatform());
}

/** 帮助面板与解析器共享动作集合；平台差异只替换主修饰键。 */
export function shortcutChord(action: AppShortcutAction, platform = shortcutPlatform()): string {
  const primary = platform === "mac" ? "⌘" : "Ctrl";
  switch (action) {
    case "new-task":
      return `${primary}+N`;
    case "focus-composer":
      return `${primary}+L`;
    case "open-settings":
      return `${primary}+,`;
    case "toggle-sidebar":
      return `${primary}+B`;
    case "split-right":
      return `${primary}+\\`;
    case "split-down":
      return `${primary}+Shift+\\`;
    case "toggle-permission":
      return `${primary}+. / Shift+Tab`;
    case "stop-generation":
      return "Esc";
  }
}

/** 从对话流尾部找最近一张待答复审批卡(键盘应答的目标)。 */
export function openPermIdOf(state: ChatState): string | null {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    if (it && it.kind === "perm" && it.state === "open") return it.id;
  }
  return null;
}

/** 挂 window keydown 的薄 hook:仅在有待决审批时监听;同一张卡只发一次
 * (permission-resolved 帧回来前连按不重发),发送失败解除标记可重按。
 * sendFrame 可注入上行管道(云端任务经 stream WS);缺省 = 本地 sender。
 * enabled:分屏多格并存时**只许焦点格监听**——window 级 keydown 按实例
 * 注册,不门控的话一次 ⏎ 会把每个格子的待审批一起应答(允许不可撤销)。 */
export function useApprovalHotkeys(state: ChatState, sessionId: string, sendFrame?: FrameSender, enabled = true): void {
  const openPermId = openPermIdOf(state);
  const answeredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!openPermId || !enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const inputText =
        target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? target.value : "";
      const action = resolveShortcut({
        key: e.key,
        defaultPrevented: e.defaultPrevented,
        isComposing: e.isComposing,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        targetTag: target?.tagName,
        inputText,
        inTerminal: !!target?.closest(".xterm"),
        openPermId,
      });
      if (action.kind === "blur") {
        target?.blur();
        return;
      }
      if (action.kind !== "perm" || answeredRef.current.has(action.id)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      answeredRef.current.add(action.id);
      void sendPermAnswerVia(sendFrame ?? localFrameSender(sessionId), action.id, action.approved ? "allow" : "deny").catch(() => {
        answeredRef.current.delete(action.id);
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPermId, sessionId, sendFrame, enabled]);
}
