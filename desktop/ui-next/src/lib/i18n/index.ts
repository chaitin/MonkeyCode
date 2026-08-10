// 轻量 i18n(不引依赖):中文为键权威,英文按类型补齐。
// - 运行时以模块级缓存为准(localStorage 只做持久化),setLocale 即时生效
//   并通知订阅者;React 侧经 useI18n(useSyncExternalStore)订阅。
// - 首次解析:mc.locale 存量 → 系统语言 zh* 归中文 → 其余英文。
// - 插值:t("main.shellInfo", { version: "1.2" }) 替换 {version} 占位。
import { useSyncExternalStore } from "react";

import { en } from "./en";
import { zh, type MessageKey } from "./zh";

export type { MessageKey };
export type Locale = "zh-CN" | "en";

const LOCALE_KEY = "mc.locale";
const DICTS: Record<Locale, Record<MessageKey, string>> = { "zh-CN": zh, en };

let current: Locale | null = null;
const listeners = new Set<() => void>();

function detect(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === "zh-CN" || stored === "en") return stored;
  } catch {
    // 存储不可读:走系统语言
  }
  try {
    return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  } catch {
    return "zh-CN";
  }
}

export function getLocale(): Locale {
  return (current ??= detect());
}

export function setLocale(locale: Locale): void {
  current = locale;
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // 只丢持久化,本次会话仍生效
  }
  for (const cb of listeners) cb();
}

/** 复数占位:`{n|单数|复数}`——取 params.n 的**数值**,恰为 1 用前者,其余
 *  用后者。中文词条不需要它(量词不变形),英文侧必须有:朴素 replaceAll 之下
 *  「只建了一个项目」的新用户(最常见的首次使用状态)在侧栏概览看到的是
 *  `1 projects · 1 tasks`,单轮会话的行 tooltip 是 `1 turns`。 */
const PLURAL_RE = /\{(\w+)\|([^|{}]*)\|([^|{}]*)\}/g;

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let text: string = DICTS[getLocale()][key];
  if (params) {
    text = text.replace(PLURAL_RE, (whole, name: string, one: string, other: string) => {
      const v = params[name];
      // 参数缺席就原样留着:宁可露出占位也好过悄悄选错一支
      return v === undefined ? whole : Number(v) === 1 ? one : other;
    });
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React 绑定:locale 变化触发重渲。视图统一用这里的 t(非 React 模块直接 import t)。 */
export function useI18n(): { locale: Locale; t: typeof t } {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale, t };
}

export const LOCALES: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: "zh-CN", label: "中文" },
  { value: "en", label: "English" },
];
