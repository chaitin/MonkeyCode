import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../styles/app.css", import.meta.url)), "utf8");
const materialStart = css.indexOf(".mc-workbench-material {");
const materialEnd = css.indexOf(".mc-workbench-background {", materialStart);
const materials = css.slice(materialStart, materialEnd);

describe("壁纸下的 Theme 相对叠层", () => {
  it("三层材质只在工作台表面内从当前 Theme 色派生", () => {
    expect(materials).toContain('html[data-mc-background="active"] .mc-workbench-surface-100 .mc-workbench-material {');
    expect(materials).not.toContain('html[data-mc-background="active"] .mc-workbench-material {');
    expect(materials).toContain("var(--color-base-100) 16%");
    expect(materials).toContain("var(--color-base-200) 24%");
    expect(materials).toContain("var(--color-base-100) 50%");
    expect(materials).toContain("var(--color-base-content) 10%");
  });

  it("不覆盖用户主题控制的几何与质感", () => {
    expect(materials).not.toMatch(/border-radius|border-width|box-shadow|--radius-|--depth|--noise|backdrop-filter/);
  });

  it("交互材质保留聚焦边线加深", () => {
    expect(materials).toContain(".mc-workbench-material-interactive:focus-within");
    expect(materials).toContain("var(--color-base-content) 25%");
  });

  it("关闭壁纸时严格回落 Theme 实色", () => {
    expect(materials).toContain(".mc-workbench-material { background-color: var(--color-base-100); }");
    expect(materials).toContain(".mc-workbench-material-muted { background-color: var(--color-base-200); }");
    expect(materials).toContain(".mc-workbench-material-interactive { background-color: var(--color-base-100); }");
  });
});
