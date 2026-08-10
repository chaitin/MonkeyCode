import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { customThemeCss, customThemeVars, paletteVars, parseCustomTheme, randomSeed, randomTheme, roleHex, CUSTOM_ATTR, COLOR_ROLES, DEFAULT_CUSTOM, type CustomTheme } from "./customTheme";
import { contrastRatio, hexToOklch, oklchToHex } from "./oklch";

/** 从 "oklch(65% 0.241 354.3)" 取回三个分量,供断言用。 */
function parseOklch(css: string): { l: number; c: number; h: number } {
  const m = /^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/.exec(css);
  if (!m) throw new Error(`不是 oklch 写法: ${css}`);
  return { l: Number(m[1]) / 100, c: Number(m[2]), h: Number(m[3]) };
}

describe("palette(整套调色板生成)", () => {
  it("产出 daisyUI 的全部 20 个颜色变量,且每个都是 oklch() 写法", () => {
    const p = paletteVars({ ...DEFAULT_CUSTOM, seed: "#16a34a", mode: "light" });
    const names = [
      "base-100",
      "base-200",
      "base-300",
      "base-content",
      ...["primary", "secondary", "accent", "neutral", "info", "success", "warning", "error"].flatMap((n) => [n, `${n}-content`]),
    ];
    expect(Object.keys(p).sort()).toEqual(names.map((n) => `--color-${n}`).sort());
    for (const v of Object.values(p)) expect(v).toMatch(/^oklch\(/);
  });

  it("中性色带主色相(这正是上一版「太丑」的根因:纯灰底 + 纯黑字没有性格)", () => {
    const seedH = hexToOklch("#16a34a")!.h;
    const p = paletteVars({ ...DEFAULT_CUSTOM, seed: "#16a34a", mode: "light" });
    for (const key of ["--color-base-100", "--color-base-200", "--color-base-300", "--color-base-content"]) {
      const v = parseOklch(p[key]!);
      expect(v.h, `${key} 应与主色同色相`).toBeCloseTo(seedH, 0);
      expect(v.c, `${key} 应有可见但克制的彩度`).toBeGreaterThan(0);
    }
  });

  it("面色按感知亮度成阶梯:浅色 100>200>300,深色反向", () => {
    const light = paletteVars({ ...DEFAULT_CUSTOM, seed: "#16a34a", mode: "light" });
    expect(parseOklch(light["--color-base-100"]!).l).toBeGreaterThan(parseOklch(light["--color-base-200"]!).l);
    expect(parseOklch(light["--color-base-200"]!).l).toBeGreaterThan(parseOklch(light["--color-base-300"]!).l);
    const dark = paletteVars({ ...DEFAULT_CUSTOM, seed: "#16a34a", mode: "dark" });
    expect(parseOklch(dark["--color-base-100"]!).l).toBeLessThan(parseOklch(dark["--color-base-200"]!).l);
    // 深色模式的底必须比正文暗,否则整个反过来了
    expect(parseOklch(dark["--color-base-100"]!).l).toBeLessThan(parseOklch(dark["--color-base-content"]!).l);
  });

  it("secondary/accent 按色相旋转,不与主色雷同", () => {
    const p = paletteVars({ ...DEFAULT_CUSTOM, seed: "#2563eb", mode: "light" });
    const h0 = parseOklch(p["--color-primary"]!).h;
    const dist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    expect(dist(h0, parseOklch(p["--color-secondary"]!).h)).toBeGreaterThan(30);
    expect(dist(h0, parseOklch(p["--color-accent"]!).h)).toBeGreaterThan(60);
  });

  it("语义色守住固有色相:错误必须是红的,不能跟着主色转", () => {
    for (const seed of ["#16a34a", "#2563eb", "#a855f7"]) {
      const p = paletteVars({ ...DEFAULT_CUSTOM, seed, mode: "light" });
      expect(parseOklch(p["--color-error"]!).h).toBeCloseTo(26, 0);
      expect(parseOklch(p["--color-success"]!).h).toBeCloseTo(155, 0);
    }
  });

  it("content 色与所在面拉开亮度:亮面配深字、暗面配浅字", () => {
    for (const mode of ["light", "dark"] as const) {
      const p = paletteVars({ ...DEFAULT_CUSTOM, seed: "#16a34a", mode });
      for (const role of ["primary", "secondary", "accent", "neutral", "info", "success", "warning", "error"]) {
        const bg = parseOklch(p[`--color-${role}`]!);
        const fg = parseOklch(p[`--color-${role}-content`]!);
        expect(Math.abs(bg.l - fg.l), `${mode}/${role} 前后景亮度差太小`).toBeGreaterThan(0.35);
      }
    }
  });

  it("扫遍色相:每个角色的正文/底对比度都过 WCAG AA(4.5:1)——「随机也不难看」得可证", () => {
    const roles = ["primary", "secondary", "accent", "neutral", "info", "success", "warning", "error"];
    for (const mode of ["light", "dark"] as const) {
      for (let hue = 0; hue < 360; hue += 15) {
        const seed = oklchToHex({ l: 0.62, c: 0.18, h: hue });
        const p = paletteVars({ ...DEFAULT_CUSTOM, seed, mode });
        for (const role of roles) {
          const ratio = contrastRatio(parseOklch(p[`--color-${role}`]!), parseOklch(p[`--color-${role}-content`]!));
          expect(ratio, `${mode} H=${hue} ${role} 对比度 ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        }
        // 正文压在底色上同样要够读
        const body = contrastRatio(parseOklch(p["--color-base-content"]!), parseOklch(p["--color-base-100"]!));
        expect(body, `${mode} H=${hue} 正文/底 ${body.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("种子是灰色时兜一个彩度下限,不至于整套灰成一片", () => {
    const p = paletteVars({ ...DEFAULT_CUSTOM, seed: "#808080", mode: "light" });
    expect(parseOklch(p["--color-primary"]!).c).toBeGreaterThan(0.05);
  });

  it("过亮/过暗的种子色被收进主色亮度窗口(否则按钮上的字看不清)", () => {
    const tooLight = parseOklch(paletteVars({ ...DEFAULT_CUSTOM, seed: "#fffbe6", mode: "light" })["--color-primary"]!);
    expect(tooLight.l).toBeLessThanOrEqual(0.76);
    const tooDark = parseOklch(paletteVars({ ...DEFAULT_CUSTOM, seed: "#050505", mode: "light" })["--color-primary"]!);
    expect(tooDark.l).toBeGreaterThanOrEqual(0.55);
  });
});

describe("逐项覆盖(对齐官方生成器的 9 个角色色)", () => {
  it("覆盖某个角色即换掉该色,其余仍是生成值", () => {
    const base = paletteVars(DEFAULT_CUSTOM);
    const over = paletteVars({ ...DEFAULT_CUSTOM, overrides: { accent: "#ff00ff" } });
    expect(over["--color-accent"]).not.toBe(base["--color-accent"]);
    expect(over["--color-primary"]).toBe(base["--color-primary"]); // 没动的角色不受牵连
    expect(parseOklch(over["--color-accent"]!).h).toBeCloseTo(hexToOklch("#ff00ff")!.h, 0);
  });

  it("覆盖 base-100 时 200/300/base-content 跟着走(否则底色换了、卡片和边线还停在原处)", () => {
    const over = paletteVars({ ...DEFAULT_CUSTOM, overrides: { "base-100": "#101828" } });
    const h = hexToOklch("#101828")!.h;
    for (const k of ["--color-base-100", "--color-base-200", "--color-base-300", "--color-base-content"]) {
      expect(parseOklch(over[k]!).h, `${k} 应跟随被覆盖的底色`).toBeCloseTo(h, 0);
    }
  });

  it("roleHex 回读的是生效色:未覆盖给生成值,覆盖后给覆盖值", () => {
    expect(roleHex(DEFAULT_CUSTOM, "accent")).not.toBe("#ff00ff");
    expect(roleHex({ ...DEFAULT_CUSTOM, overrides: { accent: "#ff00ff" } }, "accent")).toBe("#ff00ff");
  });

  it("COLOR_ROLES 覆盖 daisyUI 的 9 个可调角色", () => {
    expect([...COLOR_ROLES]).toEqual(["base-100", "primary", "secondary", "accent", "neutral", "info", "success", "warning", "error"]);
  });
});

describe("customThemeVars / customThemeCss", () => {
  it("覆盖面与 daisyUI 主题定义**逐项**对齐:漏一项就会退回 light/dark 的原值", () => {
    // 拿一套真实内置主题当基准。升级 daisyUI 若新增变量,这条会挂——否则
    // 自定义主题会静默少覆盖一项,表现为"改了主题这里不跟着变"
    const css = readFileSync(fileURLToPath(new URL("../../node_modules/daisyui/theme/valentine.css", import.meta.url)), "utf-8");
    const themeVars = [...css.matchAll(/(--[\w-]+|color-scheme)\s*:/g)].map((m) => m[1]!);
    const mine = Object.keys(customThemeVars(DEFAULT_CUSTOM));
    expect([...mine].sort()).toEqual([...new Set(themeVars)].sort());
  });

  it("除调色板外还带 color-scheme 与圆角/边框", () => {
    const vars = customThemeVars(DEFAULT_CUSTOM);
    expect(vars["color-scheme"]).toBe("light");
    expect(vars["--radius-box"]).toBe("1rem");
    expect(vars["--border"]).toBe("1px");
    // 官方生成器的可调面这里都要有:圆角三档 + 尺寸两档 + depth/noise
    expect(vars["--radius-field"]).toBeDefined();
    expect(vars["--radius-selector"]).toBeDefined();
    expect(vars["--size-field"]).toBeDefined();
    expect(vars["--size-selector"]).toBeDefined();
    expect(vars["--depth"]).toBe("0");
    expect(vars["--noise"]).toBe("0");
  });

  it("深色模式的 color-scheme 跟着走(否则冒出白色原生滚动条)", () => {
    expect(customThemeVars({ ...DEFAULT_CUSTOM, mode: "dark" })["color-scheme"]).toBe("dark");
  });

  it("越界的圆角/边框收进量程", () => {
    const vars = customThemeVars({ ...DEFAULT_CUSTOM, radiusBox: 99, border: -5 });
    expect(vars["--radius-box"]).toBe("2rem");
    expect(vars["--border"]).toBe("0px");
  });

  it("单条规则挂 CUSTOM_ATTR,不含 data-theme 选择器", () => {
    const css = customThemeCss(DEFAULT_CUSTOM);
    expect(css.startsWith(`[${CUSTOM_ATTR}]{`)).toBe(true);
    expect(css.endsWith("}")).toBe(true);
    expect(css).not.toContain("data-theme");
  });
});

describe("randomSeed", () => {
  it("随机的是色相,亮度/彩度锁在好看的窗口里(乱掷 RGB 必出泥色)", () => {
    // 注入定值 rng:不依赖 Math.random,断言才稳定
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const seed = hexToOklch(randomSeed(() => r))!;
      expect(seed.c).toBeGreaterThan(0.1);
      expect(seed.l).toBeGreaterThan(0.45);
      expect(seed.l).toBeLessThan(0.8);
    }
  });

  it("不同随机值给不同色相", () => {
    expect(randomSeed(() => 0.1)).not.toBe(randomSeed(() => 0.8));
  });
});

describe("randomTheme(整套随机:配色 + 几何)", () => {
  it("配色与几何一起换,不是只换颜色", () => {
    const from: CustomTheme = { ...DEFAULT_CUSTOM, radiusBox: 1, radiusField: 0.5, radiusSelector: 1, border: 1, depth: false };
    // 找一个确实会改动几何的随机值(表里第一项恰好等于 from 的几何)
    const next = randomTheme(from, () => 0.5);
    expect(next.seed).not.toBe(from.seed);
    const geomChanged =
      next.radiusBox !== from.radiusBox ||
      next.radiusField !== from.radiusField ||
      next.radiusSelector !== from.radiusSelector ||
      next.border !== from.border ||
      next.depth !== from.depth;
    expect(geomChanged, "几何也应参与随机").toBe(true);
  });

  it("几何整组来自内置主题的真实组合,不是逐档乱掷", () => {
    // 扫遍随机区间:任何一次结果的三档圆角都必须是内置主题用过的取值
    const allowed = new Set([0, 0.25, 0.5, 1, 2]);
    for (let i = 0; i < 32; i++) {
      const r = randomTheme(DEFAULT_CUSTOM, () => i / 32);
      for (const v of [r.radiusBox, r.radiusField, r.radiusSelector]) expect(allowed.has(v), `圆角 ${v} 不在内置取值里`).toBe(true);
      expect([1, 2]).toContain(r.border);
    }
  });

  it("清空逐项覆盖:不清的话覆盖压在生成值上,用户会以为随机没生效", () => {
    const r = randomTheme({ ...DEFAULT_CUSTOM, overrides: { primary: "#ff0000" } }, () => 0.3);
    expect(r.overrides).toEqual({});
  });

  it("不动明暗:那是使用偏好(跟系统/环境光走),不是替用户决定的风格", () => {
    expect(randomTheme({ ...DEFAULT_CUSTOM, mode: "dark" }, () => 0.7).mode).toBe("dark");
    expect(randomTheme({ ...DEFAULT_CUSTOM, mode: "light" }, () => 0.7).mode).toBe("light");
  });

  it("随机结果同样过 AA(几何变了不影响,但配色仍要可读)", () => {
    for (let i = 0; i < 16; i++) {
      const r = randomTheme(DEFAULT_CUSTOM, () => i / 16);
      const p = paletteVars(r);
      for (const role of ["primary", "secondary", "accent", "error"]) {
        expect(contrastRatio(parseOklch(p[`--color-${role}`]!), parseOklch(p[`--color-${role}-content`]!))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("parseCustomTheme(脏数据矫正)", () => {
  it("完整合法配置原样返回(含逐项覆盖)", () => {
    const cfg = { ...DEFAULT_CUSTOM, mode: "dark" as const, seed: "#ff0000", overrides: { primary: "#00ff00" }, depth: true };
    expect(parseCustomTheme(JSON.stringify(cfg))).toEqual(cfg);
  });

  it("空/坏 JSON 给 null(调用方据此判定「没配过」)", () => {
    expect(parseCustomTheme(null)).toBeNull();
    expect(parseCustomTheme("")).toBeNull();
    expect(parseCustomTheme("{不是 json")).toBeNull();
    expect(parseCustomTheme("123")).toBeNull();
  });

  it("缺字段/类型不对逐项回落,不整份丢弃;mode 只认 dark 否则浅色", () => {
    expect(parseCustomTheme(JSON.stringify({ seed: "#abc" }))).toEqual({ ...DEFAULT_CUSTOM, seed: "#aabbcc" });
    expect(parseCustomTheme(JSON.stringify({ mode: "什么", radiusBox: "大" }))).toEqual(DEFAULT_CUSTOM);
    // 覆盖里的非法色单独丢弃,不牵连整份配置
    expect(parseCustomTheme(JSON.stringify({ overrides: { primary: "红", accent: "#123456" } }))?.overrides).toEqual({ accent: "#123456" });
  });
});
