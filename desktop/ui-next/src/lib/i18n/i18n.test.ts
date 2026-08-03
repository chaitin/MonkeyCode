import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "./en";
import { zh } from "./zh";

// 模块级缓存会跨用例残留,每个用例重置模块态
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", storageStub());
  vi.stubGlobal("navigator", { language: "en-US" });
});
afterEach(() => vi.unstubAllGlobals());

function storageStub(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
  };
}

async function freshI18n() {
  return import("./index");
}

describe("词典完整性", () => {
  it("英文词典覆盖中文全部键(类型层已钉,这里防运行时空串)", () => {
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      expect(en[key], `en 缺 ${key}`).toBeTruthy();
    }
  });
});

describe("locale 解析与切换", () => {
  it("存量 mc.locale 优先;无存量按系统语言 zh* 归中文", async () => {
    vi.stubGlobal("localStorage", storageStub({ "mc.locale": "zh-CN" }));
    let i18n = await freshI18n();
    expect(i18n.getLocale()).toBe("zh-CN");

    vi.resetModules();
    vi.stubGlobal("localStorage", storageStub());
    vi.stubGlobal("navigator", { language: "zh-TW" });
    i18n = await freshI18n();
    expect(i18n.getLocale()).toBe("zh-CN");

    vi.resetModules();
    vi.stubGlobal("navigator", { language: "fr-FR" });
    i18n = await freshI18n();
    expect(i18n.getLocale()).toBe("en");
  });

  it("setLocale 即时生效、写盘并通知订阅者;存储不可写仍生效", async () => {
    const i18n = await freshI18n();
    expect(i18n.t("sidebar.newTask")).toBe("New task");
    i18n.setLocale("zh-CN");
    expect(i18n.t("sidebar.newTask")).toBe("新建任务");

    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("readonly");
      },
    });
    expect(() => i18n.setLocale("en")).not.toThrow();
    expect(i18n.t("sidebar.newTask")).toBe("New task");
  });

  it("插值替换占位符", async () => {
    const i18n = await freshI18n();
    i18n.setLocale("zh-CN");
    expect(i18n.t("main.shellInfo", { version: "1.2.3", engine: "0.9" })).toBe("壳 1.2.3 · 引擎 0.9");
  });
});
