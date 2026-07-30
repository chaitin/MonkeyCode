// 代码预览:highlight.js 语言注册、扩展名映射与带行号的高亮行渲染。
import DOMPurify from "dompurify";
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
  // 以下是 markdown 围栏语言标记专用的别名(不是文件扩展名)
  "c++": "cpp", shell: "bash", console: "bash", golang: "go",
};

/** markdown 围栏代码块的高亮:语言标记经别名表/注册表解析,未收录或
 * 高亮失败返回 null(调用方回落纯文本转义路径)。输出是 hljs 的 HTML
 * (文本已转义,只含 hljs 的 <span>),沿用与 CodeView 相同的安全前提。 */
export function highlightFence(code: string, lang?: string): string | null {
  if (!lang) return null;
  const resolved = EXT_LANG[lang] ?? lang;
  if (!hljs.getLanguage(resolved)) return null;
  try {
    return hljs.highlight(code, { language: resolved }).value;
  } catch {
    return null;
  }
}

/** 高亮 HTML 按行拆分:跨行的 <span>(块注释/模板串)在行尾闭合、次行重开,
 * 使每行成为独立合法片段——行号采用逐行 flex 行(与 DiffPanel 同构),
 * pre-wrap 折行时行号才能与内容对齐(整体 gutter 会错位)。 */
export function splitHighlighted(html: string): string[] {
  // 注:输入是 hljs 的输出(文本已转义,只剩 hljs 自己发的 <span>),
  // 但这里的产物要进 dangerouslySetInnerHTML,所以调用方仍会过一遍 sanitize
  // ——见 CodeView 里的说明。导出是为了让 codePreview.test.tsx 能直接钉住
  // "产物里除 <span> 外不出现任何标签"这条不变量:它与运行环境无关,
  // 而 DOMPurify 在 node 下 isSupported=false(测不到),不能只靠它守。
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

/** 文件内容预览:行号 + 按扩展名语法高亮;未知语言/高亮失败退回纯文本行。
 * 行号由 CSS 伪元素绘制，不进入复制文本。
 *
 * 预览的是**工作区里的任意文件**(还可能是模型刚写出来的),即不可信输入。
 * hljs v11 会把文本转义掉,所以它的输出本身安全;但这条链路的终点是
 * dangerouslySetInnerHTML,而中间还隔着 splitHighlighted 的手写正则配平——
 * 整条安全性押在"hljs 永远转义"加"正则永远配得对"上。补一道 sanitize 的成本
 * 是每行一次纯函数调用,换掉这个押注,与 markdown.tsx 的处置也就一致了。 */
export function CodeView({ path, text }: { path: string; text: string }) {
  const lines = useMemo(() => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const lang = EXT_LANG[ext];
    if (lang) {
      try {
        // 净化整段一次,再切行——不是逐行净化:文件预览上限 1MB(repo.rs
        // MAX_FILE_BYTES),那是两万行量级,逐行就是两万次 HTML 解析+序列化,
        // 足以把主线程卡住。整段净化后仍只剩 hljs 的 <span> 与转义文本,
        // splitHighlighted 的配平不受影响。
        const safe = DOMPurify.sanitize(hljs.highlight(text, { language: lang }).value);
        return { html: true, rows: splitHighlighted(safe) };
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
