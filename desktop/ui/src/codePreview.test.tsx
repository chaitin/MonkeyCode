import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CodeView, DiffPanel } from "./components";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import markdown from "highlight.js/lib/languages/markdown";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { splitHighlighted } from "./codeView";

for (const [name, lang] of Object.entries({ javascript, markdown, typescript, xml })) {
  hljs.registerLanguage(name, lang);
}

describe("code preview line numbers", () => {
  it("keeps CodeView line numbers out of DOM text", () => {
    const html = renderToStaticMarkup(<CodeView path="demo.ts" text={"const first = value;\nconst second = other;"} />);

    expect(html).toContain('class="mc-preview-line mc-code-line"');
    expect(html).toContain('data-line-number="1"');
    expect(html).toContain('data-line-number="2"');
    expect(html).not.toMatch(/>1<\/span>/);
    expect(html).not.toMatch(/>2<\/span>/);
  });

  it("keeps DiffPanel line numbers out of DOM text", () => {
    const html = renderToStaticMarkup(<DiffPanel text={"@@ -1 +1 @@\n-old value\n+new value"} />);

    expect(html).toContain('class="mc-preview-line mc-diff-line"');
    expect(html).toContain('data-line-number="1"');
    expect(html).not.toMatch(/>1<\/span>/);
  });
});

describe("code preview never injects raw markup", () => {
  // 预览的是工作区里的任意文件(可能是模型刚写的),即不可信输入,而它的
  // 终点是 dangerouslySetInnerHTML。CodeView 里另有一道 DOMPurify,但
  // DOMPurify 在 node 下 isSupported=false、测不到,所以这里钉住的是与
  // 运行环境无关的那条不变量:注入串里除 hljs 自己发的 <span> 外没有任何标签。
  // 一旦 hljs 停止转义、或 splitHighlighted 的正则配平出错,这条先炸。
  it("emits only <span> tags for hostile file contents", () => {
    const payloads = [
      `var x = 1; // <img src=x onerror="alert(1)">`,
      `/* </span><img src=x onerror=alert(1)> */`,
      `const s = "</span><script>alert(1)</script>";`,
      `<svg onload=alert(1)>`,
      `<!--</span>--><iframe src=javascript:alert(1)>`,
    ];
    for (const lang of ["typescript", "javascript", "xml", "markdown"]) {
      for (const text of payloads) {
        for (const row of splitHighlighted(hljs.highlight(text, { language: lang }).value)) {
          const tags = row.match(/<[a-zA-Z/!][^>]*>/g) ?? [];
          for (const tag of tags) {
            expect(tag, `${lang} / ${JSON.stringify(text)} 产出了非 span 标签`).toMatch(
              /^<\/?span(\s[^>]*)?>$/,
            );
          }
        }
      }
    }
  });

  it("still highlights ordinary code", () => {
    const rows = splitHighlighted(hljs.highlight("const x = 1;", { language: "typescript" }).value);
    expect(rows.join("")).toContain("hljs-keyword");
  });
});
