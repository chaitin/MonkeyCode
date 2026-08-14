// LAYOUT.md 里"铁律"级的规则,靠人对表已经失手三次(见 tasks/lessons.md
// 2026-08-05「已成文的铁律没有跟进到新代码」)。规范写了 ≠ 新代码自动遵守,
// 所以这里对源码本身做机检:新建同类结构时漏掉的那一处,提交前就会红。
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => p.slice(SRC.length + 1).replace(/\\/g, "/");

describe("LAYOUT §6.2 menu 截断铁律", () => {
  // daisyUI 5 的 `.menu` **和** `.menu :where(li)` 都是 `flex-flow: column wrap`
  // (node_modules/daisyui/components/menu.css 里核过)。wrap 列的行宽跟内容走,
  // 容器约束不到行,于是行内 min-w-0+truncate 链拿不到宽度、根本不触发——
  // 表现是长文本冲出行底 / 行尾元素被挤没。两个类缺一不可:只改顶层 ul
  // 管不到行(2026-08-04 溢出事故的根因)。
  it("每一处 .menu 都同时带 flex-nowrap 与 [&_li]:flex-nowrap", () => {
    // class 串里独立出现的 menu(排除 menu-title/menu-active/menu-sm 等修饰类)
    const CLASS_ATTR = /className=\{?\s*[`"]([^`"]*)[`"]/g;
    const offenders: string[] = [];
    for (const file of sources()) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(CLASS_ATTR)) {
        const cls = m[1] ?? "";
        if (!/(^|\s)menu(\s|$)/.test(cls)) continue;
        if (cls.includes("flex-nowrap") && cls.includes("[&_li]:flex-nowrap")) continue;
        const line = text.slice(0, m.index).split("\n").length;
        offenders.push(`${rel(file)}:${line} → ${cls}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // 命令式菜单(lib/contextMenu)不走 JSX,类名是字符串字面量,单独盯一条
  it("命令式右键菜单同样带全两个类", () => {
    const text = readFileSync(join(SRC, "lib/contextMenu.ts"), "utf8");
    const cls = /menu\.className\s*=\s*"([^"]*)"/.exec(text)?.[1] ?? "";
    expect(cls).toContain("flex-nowrap");
    expect(cls).toContain("[&_li]:flex-nowrap");
  });
});

describe("LAYOUT §5 滚动纪律", () => {
  // 只写 overflow-y 时 overflow-x 被计算成 auto,超宽内容即出横向滚动条
  // (侧栏横滚事故的根因)。横滚只允许出现在专用滚动区:代码块/diff/
  // markdown 表格包裹层/xterm——它们不用 overflow-y-auto 这条形态。
  it("列/视图级 overflow-y-auto 一律搭 overflow-x-hidden", () => {
    const CLASS_ATTR = /className=\{?\s*[`"]([^`"]*)[`"]/g;
    const offenders: string[] = [];
    for (const file of sources()) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(CLASS_ATTR)) {
        const cls = m[1] ?? "";
        if (!cls.includes("overflow-y-auto")) continue;
        if (cls.includes("overflow-x-hidden")) continue;
        const line = text.slice(0, m.index).split("\n").length;
        offenders.push(`${rel(file)}:${line} → ${cls}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("LAYOUT §1 z 序:角落瞬态与 resize 热区必须压过 daisyUI 模态", () => {
  // daisyUI 5 的 `.modal` 写死 `z-index:999`(node_modules/daisyui/components/
  // modal.css 里核过),而 Tailwind 的 z-50 / z-60 全在它之下。凡是「模态开着
  // 也必须可见可点」的层——LAYOUT §1 z 序里排在 lightbox 之上的 toast/角落
  // 瞬态,以及窗体 chrome 的边缘拉伸热区——都要 ≥1000,否则命中测试全落到
  // `.modal-backdrop`:看着在那儿,点下去却是把弹层关掉。
  // 这一类踩过两次(下载 dock/会话提醒 z-50、ResizeEdges z-60),故机检。
  const MODAL_Z = 999;
  const MUST_BEAT_MODAL: ReadonlyArray<{ file: string; needle: string }> = [
    { file: "features/downloads/DownloadsDock.tsx", needle: "toast toast-end" },
    { file: "app/App.tsx", needle: "toast toast-top toast-end" },
    { file: "features/titlebar/ResizeEdges.tsx", needle: "fixed z-" },
  ];
  it.each(MUST_BEAT_MODAL)("$file 的 z 高于模态", ({ file, needle }) => {
    const text = readFileSync(join(SRC, file), "utf8");
    const idx = text.indexOf(needle);
    expect(idx, `${file} 里找不到 ${needle}`).toBeGreaterThanOrEqual(0);
    const around = text.slice(idx, idx + 200);
    const z = /z-\[(\d+)\]/.exec(around)?.[1];
    expect(z, `${file} 应写成 z-[<数字>] 形态`).toBeDefined();
    expect(Number(z)).toBeGreaterThan(MODAL_Z);
  });

  // caption 三键要压过 resize 热区:NorthEast 的 12×12 整块落在关闭键内部、
  // North 又吃掉三键顶部 4px,不抬 z 就是「右上角点不了关闭」(点击变成
  // 一次空的 WM resize 抓取)
  it("caption 三键压过 ResizeEdges", () => {
    const zOf = (file: string, needle: string) => {
      const text = readFileSync(join(SRC, file), "utf8");
      const around = text.slice(text.indexOf(needle), text.indexOf(needle) + 200);
      return Number(/z-\[(\d+)\]/.exec(around)?.[1]);
    };
    const caption = zOf("features/titlebar/TitleBar.tsx", "const CAPTION_BTN");
    const edges = zOf("features/titlebar/ResizeEdges.tsx", "fixed z-");
    expect(caption).toBeGreaterThan(edges);
  });
});

describe("Esc 收口", () => {
  // 同 target 同阶段的监听按注册先后触发,而视图级 Esc 挂载即注册、浮层只在
  // 打开时注册——谁先吃掉这一下取决于挂载时序而非语义(开着下拉按 Esc 关掉
  // 整个设置页即此)。层序只能由 lib/util/escLayer 统一决定。
  it("除 escLayer 自身外,没有别处再挂 Escape 的 window capture 监听", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      if (rel(file) === "lib/util/escLayer.ts") continue;
      const text = readFileSync(file, "utf8");
      // window.addEventListener("keydown", X, true) —— capture 档
      for (const m of text.matchAll(/window\.addEventListener\(\s*"keydown"[^)]*,\s*true\s*\)/g)) {
        const line = text.slice(0, m.index).split("\n").length;
        offenders.push(`${rel(file)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
