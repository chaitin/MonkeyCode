// Markdown 渲染:marked/DOMPurify 配置、代码块复制、本地资源与外链跳转。
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { highlightFence } from "./codeView";
import { openExternal } from "./host";
import { resolveMarkdownResource } from "./markdownPaths";

marked.setOptions({ gfm: true, breaks: true });

// 代码块包一层容器并附复制按钮;按钮点击走 .md 容器的事件代理
// (innerHTML 注入的 DOM 挂不了 React handler)。围栏带语言标记时走
// hljs 高亮(codeView 同一注册表与配色令牌,容器加 .hl 复用样式),
// 未标注/未收录语言回落 baseRenderer 的纯文本转义路径。
const baseRenderer = new marked.Renderer();
marked.use({
  renderer: {
    code(token) {
      const lang = (token.lang ?? "").trim().split(/\s+/)[0]?.toLowerCase();
      const highlighted = highlightFence(token.text, lang);
      const body =
        highlighted !== null
          ? `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`
          : baseRenderer.code(token);
      return `<div class="mdcode${highlighted !== null ? " hl" : ""}">${body}<button class="mdcopy" type="button">复制</button></div>`;
    },
    table(token) {
      const table = baseRenderer.table.call(this, token);
      return `<div class="md-table-scroll" role="region" aria-label="可横向滚动的表格" tabindex="0">${table}</div>`;
    },
    tablecell(token) {
      const tag = token.header ? "th" : "td";
      const align = token.align ? ` align="${token.align}"` : "";
      const content = this.parser.parseInline(token.tokens);
      return `<${tag}${align}><div class="md-table-cell">${content}</div></${tag}>\n`;
    },
  },
});

/** 复制到剪贴板:异步 API 不可用/被拒时回退 execCommand(WebKitGTK 可能缺 API、WKWebView 会拒权限) */
export function copyText(text: string) {
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(fallback);
  } else {
    fallback();
  }
}

/** 正文里的链接一律不走 webview 导航(WKWebView 里点 <a> 会把应用页面跳走):
 * http(s) 交系统浏览器/新标签页,其余协议直接拦下。 */
function onMarkdownClick(e: ReactMouseEvent<HTMLDivElement>, onLocalLink?: (path: string) => void) {
  const target = e.target as HTMLElement;
  const copy = target.closest<HTMLButtonElement>("button.mdcopy");
  if (copy) {
    copyText(copy.parentElement?.querySelector("pre")?.textContent ?? "");
    copy.textContent = "已复制";
    copy.classList.add("ok");
    window.setTimeout(() => {
      copy.textContent = "复制";
      copy.classList.remove("ok");
    }, 1500);
    return;
  }
  const a = target.closest("a");
  if (!a) return;
  e.preventDefault();
  const local = a.dataset.mcLocalHref;
  if (local) {
    onLocalLink?.(local);
    return;
  }
  const href = a.getAttribute("href") || "";
  if (/^https?:/i.test(href)) openExternal(href);
}

/** 在 inert template 中先标记本地资源,再交给 DOMPurify 净化。
 * file: 等地址会被净化器移除,所以顺序不能反过来。 */
/** 本地资源标记属性:壳自己打的,不能让正文内容自带。
 *
 * DOMPurify 默认放行 `data-*`,而 marked 会原样透传正文里的裸 HTML——模型
 * 输出(或被渲染的文件内容)里写一个 `<img data-mc-local-src="...">`,就能
 * 指使 UI 去读它挑的路径。边界另有 uploads.rs::read_data_url 的工作区校验
 * 兜底,但"标记属性"和"用户内容"共用一个命名空间本身是脆的:解析后、打标记
 * 前先清一遍,标记就重新只有壳能打。 */
const LOCAL_MARKS = ["data-mc-local-src", "data-mc-local-href"] as const;

function markdownHtml(text: string): string {
  const template = document.createElement("template");
  template.innerHTML = marked.parse(text, { async: false }) as string;
  for (const mark of LOCAL_MARKS) {
    for (const el of template.content.querySelectorAll(`[${mark}]`)) el.removeAttribute(mark);
  }
  for (const img of template.content.querySelectorAll<HTMLImageElement>("img[src]")) {
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    const source = resolveMarkdownResource(img.getAttribute("src") || "");
    if (source.kind === "local") {
      img.dataset.mcLocalSrc = source.path;
      img.removeAttribute("src");
    } else if (source.kind === "url") {
      img.setAttribute("src", source.src);
    }
  }
  for (const a of template.content.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const source = resolveMarkdownResource(a.getAttribute("href") || "");
    if (source.kind === "local") {
      a.dataset.mcLocalHref = source.path;
      a.setAttribute("href", "#");
    } else if (source.kind === "url") {
      a.setAttribute("href", source.src);
    }
  }
  return DOMPurify.sanitize(template.innerHTML);
}

/** agent 正文按 Markdown 渲染(净化后注入);流式期间随批次重渲染 */
export function Markdown({
  text,
  localImageUrl,
  onLocalLink,
}: {
  text: string;
  localImageUrl?: (path: string) => Promise<string>;
  onLocalLink?: (path: string) => void;
}) {
  const html = useMemo(() => markdownHtml(text), [text]);
  const root = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, string>());
  useEffect(() => {
    if (!localImageUrl || !root.current) return;
    let alive = true;
    for (const img of root.current.querySelectorAll<HTMLImageElement>("img[data-mc-local-src]")) {
      const path = img.dataset.mcLocalSrc;
      if (!path) continue;
      const cached = cache.current.get(path);
      if (cached) {
        img.src = cached;
        continue;
      }
      img.setAttribute("aria-busy", "true");
      localImageUrl(path).then(
        (url) => {
          if (!alive) return;
          cache.current.set(path, url);
          img.src = url;
          img.removeAttribute("aria-busy");
        },
        (e) => {
          if (!alive) return;
          img.removeAttribute("aria-busy");
          img.dataset.mcLocalError = "true";
          img.title = `本地图片加载失败: ${e instanceof Error ? e.message : String(e)}`;
        },
      );
    }
    return () => {
      alive = false;
    };
    // localImageUrl 随 SessionHandle 渲染生成新闭包;同一条消息只按 HTML 变化重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);
  return <div ref={root} className="md" onClick={(e) => onMarkdownClick(e, onLocalLink)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 单行内联 markdown(子代理 feed 行:加粗/行内代码等,不产生块级元素,
 * 保持单行 ellipsis 布局)。 */
export function MarkdownInline({ text, style }: { text: string; style?: CSSProperties }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parseInline(text, { async: false }) as string), [text]);
  return <span className="ellipsis mdi" style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}
