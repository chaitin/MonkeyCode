import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodeView, splitHighlightedLines } from "./CodeView";

describe("代码预览", () => {
  it("纯文本(未收录扩展)逐行渲染并带行号,空行不塌", () => {
    render(<CodeView path="note.txt" text={"first line\n\nthird line"} />);
    expect(screen.getByText("first line")).toBeTruthy();
    expect(screen.getByText("third line")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("按扩展名高亮:内容文本完整保留,只多出 hljs 的 span", () => {
    const { container } = render(<CodeView path="a.ts" text={'const x = "hi";'} />);
    expect(container.textContent).toContain("const");
    expect(container.textContent).toContain('"hi"');
    expect(container.querySelector("span[class*='hljs']")).toBeTruthy();
  });

  it("不可信内容进不了 DOM:HTML 被转义,不产生 img 等元素", () => {
    const evil = 'const s = "<img src=x onerror=alert(1)>";';
    const { container } = render(<CodeView path="a.ts" text={evil} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("splitHighlightedLines:跨行 span 行尾闭合、次行重开,每行独立配平", () => {
    const rows = splitHighlightedLines('<span class="hljs-string">line1\nline2</span>after');
    expect(rows).toEqual(['<span class="hljs-string">line1</span>', '<span class="hljs-string">line2</span>after']);
    // 不变量:产物里除 span 之外不出现任何标签
    for (const row of rows) {
      expect(row.replace(/<span[^>]*>|<\/span>/g, "")).not.toMatch(/[<>]/);
    }
  });
});
