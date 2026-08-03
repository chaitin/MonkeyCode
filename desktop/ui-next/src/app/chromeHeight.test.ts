// --chrome-h 的静态契约(LAYOUT §1/§2)。
//
// 这个变量是所有固定定位覆盖层的唯一避让依据,而它有个只在**别的平台**上
// 才现形的失效方式:默认值写错。mac 与浏览器不画窗框条,靠的是 :root 的
// 0px 兜底——把默认改成 32px,mac 上 toast/抽屉/模态会齐刷刷下移一条,而在
// Windows 上一切正常,本机跑测试也一切正常。反过来漏掉 windows/linux 覆写,
// 那两端的覆盖层就退回压住窗框条(toast 曾经就压着主区头的动作钮)。
//
// jsdom 不加载样式表,算不出 computed value,所以直接对着源文件钉声明。
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../styles/app.css", import.meta.url)), "utf-8");

/** 取某个选择器块里 --chrome-h 的值(选择器按字面匹配,顺带钉住写法)。 */
function chromeHeightIn(selector: string): string | null {
  const block = new RegExp(`${selector.replace(/[[\]"^$*+?.()|{}\\]/g, "\\$&")}[^{]*\\{([^}]*)\\}`);
  const body = css.match(block)?.[1];
  return body?.match(/--chrome-h:\s*([^;]+);/)?.[1]?.trim() ?? null;
}

describe("--chrome-h 静态契约", () => {
  it("默认 0px:mac 与浏览器不画窗框条,覆盖层贴视口顶(mac 零回归的底线)", () => {
    expect(chromeHeightIn(":root")).toBe("0px");
  });

  it("Windows 与 Linux 覆写为 28px,且两者写在同一条规则里(同一条窗框)", () => {
    expect(chromeHeightIn('[data-platform="windows"]')).toBe("28px");
    expect(css).toMatch(/\[data-platform="windows"\],\s*\[data-platform="linux"\]/);
  });

  // 变量的意义就是"覆盖层让开的高度 = 窗框条的真实高度"。两处各写各的数,
  // 谁改一边就整体错几像素,而且**只在 Windows/Linux 上现形**——mac 那边
  // --chrome-h 恒为 0,条也不渲染,本机怎么看都正常。所以这条必须机器来对。
  it("条高(TitleBar 的 h-*)与 --chrome-h 必须同值", () => {
    const bar = readFileSync(fileURLToPath(new URL("../features/titlebar/TitleBar.tsx", import.meta.url)), "utf-8");
    const header = bar.match(/className="flex h-(\d+) shrink-0 items-stretch/);
    expect(header, "没在 TitleBar 里找到窗框条的 h-* 类,改了结构就同步这条测试").not.toBeNull();
    const barPx = Number(header![1]) * 4; // Tailwind 间距刻度:1 = 0.25rem = 4px
    expect(`${barPx}px`).toBe(chromeHeightIn('[data-platform="windows"]'));
  });

  it("mac 不许有自己的覆写(有就说明谁给 mac 也画了条)", () => {
    expect(chromeHeightIn('[data-platform="mac"]')).toBeNull();
  });

  it("除这两处声明外不再有第三个取值(平台分支只此一家)", () => {
    expect(css.match(/--chrome-h:/g)).toHaveLength(2);
  });

  // 差点栽在这:`.modal { top: var(--chrome-h) }` 原本写在 @layer base 里,
  // 而 daisyUI 的 `.modal{...inset:0}` 落在 daisyui.l1.l2.l3 层——产物里那层
  // 出现得比 base 晚,层序更靠后即优先级更高,于是 inset:0 把 top 悄悄吃掉:
  // 样式看着写了、构建不报错、模态照旧盖住窗框。无层规则胜过一切层规则,
  // 所以这条必须待在文件末尾那段无层的"统一视觉调整"里。
  it(".modal 的避让规则必须在无层区,否则被 daisyUI 的 inset:0 吃掉", () => {
    const i = css.search(/\.modal\s*\{[^}]*top:\s*var\(--chrome-h\)/);
    expect(i).toBeGreaterThan(-1);
    // 括号平衡 = 0 即不在任何 @layer / 嵌套块内
    const before = css.slice(0, i);
    const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
    expect(depth).toBe(0);
  });

  it("组件源码里不许再出现按平台手算的顶偏移(top-9 / mt-13 那一套)", () => {
    const offenders: string[] = [];
    const walk = (dir: URL) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const child = new URL(`${e.name}${e.isDirectory() ? "/" : ""}`, dir);
        if (e.isDirectory()) {
          walk(child);
        } else if (/\.tsx?$/.test(e.name) && !e.name.includes(".test.")) {
          // 先剥注释:改动缘由要在注释里留档(App.tsx 就写着"原先写死 mt-13"),
          // 那些不算违规。剥完再扫,类名写在 className 里还是抽成常量都能逮到
          const code = readFileSync(fileURLToPath(child), "utf-8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/[^\n]*/g, "");
          if (/\b(top-9|mt-13)\b/.test(code)) offenders.push(e.name);
        }
      }
    };
    walk(new URL("../", import.meta.url));
    expect(offenders).toEqual([]);
  });
});
