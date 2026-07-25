// 代码预览:highlight.js 语言注册、扩展名映射与带行号的高亮行渲染。
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { useMemo, type CSSProperties } from "react";
import { MONO } from "./fonts";

// ---- 代码预览高亮(文件抽屉查看器) ----

for (const [name, lang] of Object.entries({
  bash, c, cpp, css, go, ini, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml,
})) {
  hljs.registerLanguage(name, lang);
}

/** 扩展名 → highlight.js 语言名(未收录的扩展退回纯文本) */
const EXT_LANG: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  go: "go", py: "python", rs: "rust", java: "java",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp",
  json: "json", css: "css",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml",
  md: "markdown", markdown: "markdown",
  sh: "bash", bash: "bash", zsh: "bash",
  yml: "yaml", yaml: "yaml", sql: "sql",
  ini: "ini", toml: "ini", conf: "ini",
};

/** 高亮 HTML 按行拆分:跨行的 <span>(块注释/模板串)在行尾闭合、次行重开,
 * 使每行成为独立合法片段——行号采用逐行 flex 行(与 DiffPanel 同构),
 * pre-wrap 折行时行号才能与内容对齐(整体 gutter 会错位)。 */
function splitHighlighted(html: string): string[] {
  const out: string[] = [];
  const open: string[] = []; // 行首需要重开的未闭合 <span ...> 栈
  for (const line of html.split("\n")) {
    const prefix = open.join("");
    const re = /<span[^>]*>|<\/span>/g;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m[0] === "</span>") open.pop();
      else open.push(m[0]);
    }
    out.push(prefix + line + "</span>".repeat(open.length));
  }
  return out;
}

const codeLine: CSSProperties = {
  flex: 1,
  minWidth: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: "var(--t2)",
};

/** 文件内容预览:行号 + 按扩展名语法高亮(hljs 输出自带转义);
 * 未知语言/高亮失败退回纯文本行。行号由 CSS 伪元素绘制，不进入复制文本。 */
export function CodeView({ path, text }: { path: string; text: string }) {
  const lines = useMemo(() => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const lang = EXT_LANG[ext];
    if (lang) {
      try {
        return { html: true, rows: splitHighlighted(hljs.highlight(text, { language: lang }).value) };
      } catch {
        /* 高亮失败退回纯文本,不影响阅读 */
      }
    }
    return { html: false, rows: text.split("\n") };
  }, [path, text]);
  return (
    <div style={{ font: "12px/1.9 " + MONO }}>
      {lines.rows.map((l, i) => (
        <div key={i} className="mc-preview-line mc-code-line" data-line-number={i + 1} style={{ display: "flex", padding: "0 24px" }}>
          {lines.html ? (
            <span className="hl" style={codeLine} dangerouslySetInnerHTML={{ __html: l || " " }} />
          ) : (
            <span style={codeLine}>{l || " "}</span>
          )}
        </div>
      ))}
    </div>
  );
}
