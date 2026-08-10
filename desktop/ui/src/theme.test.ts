import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyStoredTheme, readTheme, setTheme } from "./theme";

// node 环境无 DOM/存储:按 navigation.test.tsx 的做法只桩出用到的那两个全局
let values: Map<string, string>;
let root: { dataset: { theme?: string } };

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
    expect(root.dataset.theme).toBe("light");
  });

  it("启动按本机偏好落属性,深色下不闪浅色", () => {
    values.set("mc.theme", "dark");
    applyStoredTheme();
    expect(root.dataset.theme).toBe("dark");
  });

  it("浅色偏好启动时显式落 light(daisyUI 按 data-theme 取值选主题)", () => {
    applyStoredTheme();
    expect(root.dataset.theme).toBe("light");
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
