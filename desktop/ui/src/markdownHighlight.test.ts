// 围栏代码块的 hljs 高亮:语言标记解析、别名、未收录语言的纯文本回落。
import { marked } from "marked";
import { describe, expect, it } from "vitest";

import "./components";
import { highlightFence } from "./codeView";

describe("markdown 代码块高亮", () => {
  it("带语言标记的围栏走 hljs,容器挂 .hl 复用代码预览配色", () => {
    const html = marked.parse('```ts\nconst x: number = 1;\n```', { async: false }) as string;
    expect(html).toContain('class="mdcode hl"');
    expect(html).toContain('class="hljs language-ts"');
    expect(html).toContain("hljs-keyword");
    // 文本仍被转义(hljs 输出只含它自己的 span)
    expect(html).not.toContain("<script");
  });

  it("未标语言/未收录语言回落纯文本转义路径,不挂 .hl", () => {
    for (const fence of ["```\nplain text\n```", "```brainfuck\n+++\n```"]) {
      const html = marked.parse(fence, { async: false }) as string;
      expect(html).toContain('class="mdcode"');
      expect(html).not.toContain('class="mdcode hl"');
      expect(html).not.toContain("hljs-");
    }
  });

  it("围栏别名与附加参数:首段小写解析,c++/shell 这类映射到注册语言", () => {
    expect(highlightFence("echo hi", "shell")).toContain("hljs-built_in");
    expect(highlightFence("int a;", "c++")).not.toBeNull();
    const html = marked.parse('```JS title=demo\nconst a = 1\n```', { async: false }) as string;
    expect(html).toContain("hljs-keyword");
  });

  it("高亮输出除 span 外不引入任何标签(注入面不变)", () => {
    const out = highlightFence('const s = "<img src=x onerror=alert(1)>";', "ts") ?? "";
    const tags = out.match(/<[^>]+>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((t) => /^<\/?span[ >]/.test(t) || t === "</span>")).toBe(true);
    expect(out).toContain("&lt;img");
  });
});
