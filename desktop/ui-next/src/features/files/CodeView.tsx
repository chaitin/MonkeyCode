// 代码预览:扩展名 → highlight.js(lib/common,与 markdown 管线同源)+
// 逐行行号。行号是 select-none 的真实节点——复制代码时选区带不上它,
// 因此不需要行号伪元素的自定义 CSS(样式宪法白名单不必扩)。
//
// 预览对象是工作区任意文件(还可能是模型刚写出来的),即不可信输入。
// hljs v11 会转义文本,输出只含它自己的 <span>;但这条链路的终点是
// dangerouslySetInnerHTML,中间还有手写正则的跨行 span 配平——所以整段
// 先过一遍 DOMPurify 再切行(整段一次而非逐行:1MB 上限是两万行量级,
// 逐行净化是两万次 HTML 解析+序列化,会卡死主线程)。
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { useMemo } from "react";

/** 扩展名 → highlight.js 语言名(lib/common 已注册的子集;未收录退纯文本)。 */
const EXT_LANG: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript",
  go: "go", py: "python", rs: "rust", java: "java", kt: "kotlin",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp",
  json: "json", css: "css", scss: "scss", less: "less",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml",
  md: "markdown", markdown: "markdown",
  sh: "bash", bash: "bash", zsh: "bash",
  yml: "yaml", yaml: "yaml", sql: "sql", php: "php", rb: "ruby", swift: "swift",
  ini: "ini", toml: "ini", conf: "ini",
};

/** 高亮 HTML 按行拆分:跨行的 <span>(块注释/模板串)在行尾闭合、次行重开,
 * 使每行成为独立合法片段(行号逐行 flex 布局,折行时行号才与内容对齐)。
 * 导出是为了让测试钉住「产物里除 <span> 外不出现任何标签」的不变量。 */
export function splitHighlightedLines(html: string): string[] {
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

export function CodeView({ path, text }: { path: string; text: string }) {
  const lines = useMemo((): { html: boolean; rows: string[] } => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const lang = EXT_LANG[ext] ?? "";
    if (lang && hljs.getLanguage(lang)) {
      try {
        const safe = DOMPurify.sanitize(hljs.highlight(text, { language: lang }).value);
        return { html: true, rows: splitHighlightedLines(safe) };
      } catch {
        // 高亮失败退回纯文本,不影响阅读
      }
    }
    return { html: false, rows: text.split("\n") };
  }, [path, text]);
  return (
    <div className="select-text py-1 font-mono text-xs leading-relaxed">
      {lines.rows.map((row, i) => (
        <div key={i} className="flex px-4">
          <span aria-hidden className="w-10 shrink-0 select-none pr-3 text-right text-base-content/35 tabular-nums">
            {i + 1}
          </span>
          {lines.html ? (
            <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere" dangerouslySetInnerHTML={{ __html: row || " " }} />
          ) : (
            <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere">{row || " "}</span>
          )}
        </div>
      ))}
    </div>
  );
}
