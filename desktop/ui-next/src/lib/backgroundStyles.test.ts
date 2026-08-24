import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../styles/app.css", import.meta.url)), "utf8");

describe("工作台背景样式", () => {
  it("无背景时语义表面回落原主题实色，透明规则只在 active 下生效", () => {
    expect(css).toContain(".mc-workbench-surface-100 { background-color: var(--color-base-100); }");
    expect(css).toContain(".mc-workbench-surface-200 { background-color: var(--color-base-200); }");
    expect(css).toContain(".mc-workbench-surface-300 { background-color: var(--color-base-300); }");
    expect(css).toMatch(/html\[data-mc-background="active"\] \.mc-workbench-surface-100/);
    expect(css).toMatch(/\[data-split-grid\]\.mc-workbench-surface-300\s*\{\s*background-color: transparent/);
    expect(css).not.toMatch(/\.bg-base-100\s*\{[^}]*color-mix/s);
  });

  it("背景层受控于运行时变量且减少透明度/动态时强制实色并关闭模糊", () => {
    for (const variable of [
      "--mc-background-image",
      "--mc-background-position",
      "--mc-background-repeat",
      "--mc-background-size",
      "--mc-background-blur",
    ]) {
      expect(css).toContain(`var(${variable})`);
    }
    expect(css).toContain("prefers-reduced-transparency: reduce");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("--mc-surface-opacity: 100% !important");
    expect(css).toContain("--mc-background-blur: 0px !important");
  });

  it("contain 按工作台内容框计算，blur=0/blur>0 都不会因 24px 缓冲区裁边", () => {
    expect(css).toMatch(/\.mc-workbench-background\s*\{[^}]*inset: -24px;[^}]*padding: 24px;/s);
    expect(css).toMatch(/\.mc-workbench-background\s*\{[^}]*box-sizing: border-box;/s);
    expect(css).toMatch(/\.mc-workbench-background\s*\{[^}]*background-origin: content-box;/s);
  });
});
