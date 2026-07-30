import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyStoredTheme, readAccent, readTheme, setAccent, setTheme } from "./theme";

// node 环境无 DOM/存储:按 navigation.test.tsx 的做法只桩出用到的那两个全局
let values: Map<string, string>;
let root: { dataset: { theme?: string; accent?: string } };

beforeEach(() => {
  values = new Map<string, string>();
  root = { dataset: {} };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("document", { documentElement: root });
});

afterEach(() => vi.unstubAllGlobals());

describe("主题偏好", () => {
  it("缺省、脏数据和不可读存储都回落浅色", () => {
    expect(readTheme()).toBe("light");

    values.set("mc.theme", "dark");
    expect(readTheme()).toBe("dark");

    values.set("mc.theme", "midnight");
    expect(readTheme()).toBe("light");

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: vi.fn(),
    });
    expect(readTheme()).toBe("light");
  });

  it("切换同时写盘并换根节点属性", () => {
    setTheme("dark");
    expect(values.get("mc.theme")).toBe("dark");
    expect(root.dataset.theme).toBe("dark");

    setTheme("light");
    expect(values.get("mc.theme")).toBe("light");
    expect(root.dataset.theme).toBe("");
  });

  it("启动按本机偏好落属性,深色下不闪浅色", () => {
    values.set("mc.theme", "dark");
    applyStoredTheme();
    expect(root.dataset.theme).toBe("dark");
  });

  it("浅色偏好启动时不留 data-theme", () => {
    applyStoredTheme();
    expect(root.dataset.theme).toBe("");
  });

  it("存储不可写时仍应用本次主题", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });

    expect(() => setTheme("dark")).not.toThrow();
    expect(root.dataset.theme).toBe("dark");
  });
});

describe("主题色偏好", () => {
  it("缺省、脏数据和不可读存储都回落默认色", () => {
    expect(readAccent()).toBe("green");

    values.set("mc.accent", "purple");
    expect(readAccent()).toBe("purple");

    // 脏数据含移动端那套中文 key:桌面存的是 slug,不认就回落
    values.set("mc.accent", "葡萄紫");
    expect(readAccent()).toBe("green");

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: vi.fn(),
    });
    expect(readAccent()).toBe("green");
  });

  it("切换写盘并换根节点属性,默认色不留属性", () => {
    setAccent("orange");
    expect(values.get("mc.accent")).toBe("orange");
    expect(root.dataset.accent).toBe("orange");

    setAccent("green");
    expect(values.get("mc.accent")).toBe("green");
    expect(root.dataset.accent).toBe("");
  });

  it("启动一次把深浅与主题色两维都落上", () => {
    values.set("mc.theme", "dark");
    values.set("mc.accent", "blue");
    applyStoredTheme();
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.accent).toBe("blue");
  });

  it("存储不可写时仍应用本次主题色", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });

    expect(() => setAccent("blue")).not.toThrow();
    expect(root.dataset.accent).toBe("blue");
  });
});
