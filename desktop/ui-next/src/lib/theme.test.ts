import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyStoredTheme, readTheme, setCustomTheme, setTheme, THEMES, CUSTOM_THEME } from "./theme";
import { CUSTOM_ATTR, CUSTOM_STYLE_ID, DEFAULT_CUSTOM, type CustomTheme } from "./customTheme";

// unit(node)环境无 DOM/存储:只桩出用到的全局。
// 自定义主题要往 <head> 注样式、往根节点挂属性,桩要覆盖到这几件:
// getElementById / createElement / head.appendChild + 根节点的 set/removeAttribute
let values: Map<string, string>;
interface FakeEl {
  id: string;
  textContent: string;
  /** 切回内置主题时 theme.ts 要把注入的 <style> 摘掉,桩得实现这一件 */
  remove: () => void;
}
let root: {
  dataset: { theme?: string };
  style: { background?: string };
  attrs: Map<string, string>;
  setAttribute: (k: string, v: string) => void;
  removeAttribute: (k: string) => void;
};
let head: FakeEl[];

beforeEach(() => {
  values = new Map<string, string>();
  head = [];
  const attrs = new Map<string, string>();
  root = {
    dataset: {},
    style: {},
    attrs,
    setAttribute: (k, v) => void attrs.set(k, v),
    removeAttribute: (k) => void attrs.delete(k),
  };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("document", {
    documentElement: root,
    getElementById: (id: string) => head.find((e) => e.id === id) ?? null,
    createElement: (): FakeEl => {
      const el: FakeEl = {
        id: "",
        textContent: "",
        remove: () => {
          const i = head.indexOf(el);
          if (i >= 0) head.splice(i, 1);
        },
      };
      return el;
    },
    head: {
      appendChild: (el: FakeEl) => {
        head.push(el);
        return el;
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("主题偏好", () => {
  it("缺省、清单外脏数据和不可读存储都回落品牌主题", () => {
    expect(readTheme()).toBe("monkeycode");
    values.set("mc.theme", "dark");
    expect(readTheme()).toBe("dark");
    values.set("mc.theme", "dracula");
    expect(readTheme()).toBe("dracula");
    values.set("mc.theme", "midnight"); // 不在清单
    expect(readTheme()).toBe("monkeycode");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: vi.fn(),
    });
    expect(readTheme()).toBe("monkeycode");
  });

  it("切换写盘并显式落根节点属性", () => {
    setTheme("synthwave");
    expect(values.get("mc.theme")).toBe("synthwave");
    expect(root.dataset.theme).toBe("synthwave");
    setTheme("light");
    expect(root.dataset.theme).toBe("light");
  });

  it("换主题后缓存 base-100 供首帧防闪;无 CSS 引擎时静默跳过", () => {
    // node 环境无 getComputedStyle:不抛、不写缓存
    setTheme("nord");
    expect(values.has("mc.themeBg")).toBe(false);

    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: (name: string) => (name === "--color-base-100" ? " oklch(95.127% 0.007 260.731) " : ""),
    }));
    setTheme("nord");
    expect(values.get("mc.themeBg")).toBe("oklch(95.127% 0.007 260.731)");
  });

  it("启动矫正脏值并落属性;存储不可写时仍应用本次主题", () => {
    values.set("mc.theme", "已卸载的主题");
    applyStoredTheme();
    expect(root.dataset.theme).toBe("monkeycode");

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

describe("自定义主题(生成整套调色板 + 覆盖块叠加)", () => {
  const cfg: CustomTheme = { ...DEFAULT_CUSTOM, mode: "dark", seed: "#ff0000" };

  it("data-theme 落 light/dark(给非颜色变量兜底),调色板挂在 CUSTOM_ATTR 上", () => {
    setCustomTheme(cfg);
    // 落 mc-custom 的话 daisyUI 找不到该主题声明,--size-field/--depth 这些
    // 非颜色变量就没了兜底
    expect(root.dataset.theme).toBe("dark");
    expect(root.attrs.get(CUSTOM_ATTR)).toBe("");
    const style = head.find((e) => e.id === CUSTOM_STYLE_ID);
    // 颜色一律 oklch():配方在 OKLCH 坐标下算,不回写 hex(回写会丢精度且没意义)
    expect(style?.textContent).toMatch(/--color-primary:oklch\(/);
  });

  it("配置与渲染好的 CSS 都落盘:首帧脚本要的是 CSS,不能让它按配置现算", () => {
    setCustomTheme(cfg);
    expect(JSON.parse(values.get("mc.themeCustom") ?? "null")).toEqual(cfg);
    expect(values.get("mc.themeCustomCss")).toMatch(/--color-primary:oklch\(/);
    expect(values.get("mc.theme")).toBe(CUSTOM_THEME);
  });

  it("切回内置主题:覆盖块与属性都要撤干净,否则残留的变量继续压着新主题", () => {
    setCustomTheme(cfg);
    setTheme("dracula");
    expect(root.dataset.theme).toBe("dracula");
    expect(root.attrs.has(CUSTOM_ATTR)).toBe(false);
    expect(head.find((e) => e.id === CUSTOM_STYLE_ID)).toBeUndefined();
  });

  it("再次切入自定义复用同一个 <style>,不叠第二份且内容确实换了", () => {
    setCustomTheme(cfg);
    const first = head[0]?.textContent;
    setCustomTheme({ ...cfg, seed: "#00ff00" });
    expect(head.filter((e) => e.id === CUSTOM_STYLE_ID)).toHaveLength(1);
    expect(head[0]?.textContent).not.toBe(first); // 换了种子色,整套调色板都该变
  });

  it("存了 mc-custom 但配置缺失 → 回落品牌主题(否则是「选了没反应」的一套裸基础主题)", () => {
    values.set("mc.theme", CUSTOM_THEME);
    expect(readTheme()).toBe("monkeycode");
    values.set("mc.themeCustom", JSON.stringify(cfg));
    expect(readTheme()).toBe(CUSTOM_THEME);
  });

  it("applyStoredTheme 走自定义路径:首帧之后的兜底与首帧脚本落一样的属性", () => {
    values.set("mc.theme", CUSTOM_THEME);
    values.set("mc.themeCustom", JSON.stringify(cfg));
    applyStoredTheme();
    expect(root.dataset.theme).toBe("dark");
    expect(root.attrs.get(CUSTOM_ATTR)).toBe("");
  });
});

describe("THEMES 清单与 app.css 对表", () => {
  it("内置 themes 列表 + 自定义主题块 name 与 THEMES 完全一致", () => {
    const css = readFileSync(fileURLToPath(new URL("../styles/app.css", import.meta.url)), "utf-8");
    const block = /@plugin "daisyui"\s*\{([^}]*)\}/.exec(css);
    expect(block, "app.css 缺 @plugin daisyui 块").toBeTruthy();
    const builtin = (/themes:\s*([^;]+);/.exec(block?.[1] ?? "")?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().split(/\s+/)[0] ?? "")
      .filter(Boolean);
    const custom = [...css.matchAll(/@plugin "daisyui\/theme"\s*\{[^}]*?name:\s*"([^"]+)"/g)].map((m) => m[1] ?? "");
    expect([...custom, ...builtin].sort()).toEqual([...THEMES].sort());
  });
});
