// Markdown 渲染管线:marked(GFM)→ 自定义 renderer(代码高亮/复制按钮/
// 表格横滚包裹)→ DOMPurify 净化 → dangerouslySetInnerHTML。
// 行为契约:正文里的链接一律不走 webview 导航——http(s) 交系统浏览器
// (壳内 opener,浏览器模式新开标签),点击在容器上代理。
// 复制按钮用 daisyUI btn 类(注入 HTML 里的类是源码字面量,Tailwind 扫得到)。
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { Marked } from "marked";
import { startTransition, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";

import { t, useI18n } from "@/lib/i18n";
import { openMenu } from "@/lib/contextMenu";
import { openExternal } from "@/lib/ipc/host";
import { copyText } from "@/lib/util/clipboard";
import { resolveMarkdownResource } from "@/lib/util/markdownPaths";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 超过这个体量的代码块不做语法高亮(hljs 是同步 CPU 活,兆级文本一块就是
 *  秒级主线程冻结;2026-08-10 切会话/跳转的卡顿分析里它是单点最大嫌疑)。
 *  50KB ≈ 一千多行代码,正常粘贴/工具输出够用;超限的是日志转储一类,
 *  高亮本来也读不出层次,原样等宽展示即可。 */
const HLJS_MAX_CHARS = 50_000;
const EMPTY_IMAGE_DATA_URL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const MERMAID_IMAGE_SOURCE_RE = /(\bimg\s*:\s*)(["'])(.*?)\2/g;
type LocalImageUrl = (path: string) => Promise<string>;
let mermaidRenderId = 0;

function ensureMermaidStyleSheet() {
  const scope = globalThis as unknown as Record<string, unknown>;
  const NativeStyleSheet = scope.CSSStyleSheet;
  if (typeof NativeStyleSheet === "function") {
    try {
      Reflect.construct(NativeStyleSheet, []);
      return;
    } catch {
      // Safari 16.4 之前暴露 CSSStyleSheet，但不能直接构造。
    }
  }
  class MermaidStyleSheet {
    cssRules: Array<{ cssText: string }> = [];
    insertRule(cssText: string, index = this.cssRules.length) {
      this.cssRules.splice(index, 0, { cssText });
      return index;
    }
  }
  Object.defineProperty(scope, "CSSStyleSheet", {
    configurable: true,
    writable: true,
    value: MermaidStyleSheet,
  });
}

async function resolveMermaidImageSources(
  source: string,
  localImageUrl: LocalImageUrl | undefined,
  cache: Map<string, string>,
): Promise<string> {
  const matches = [...source.matchAll(MERMAID_IMAGE_SOURCE_RE)];
  const replacements = await Promise.all(
    matches.map(async (match) => {
      const resource = resolveMarkdownResource(match[3] ?? "");
      if (resource.kind !== "local") return null;
      let url = cache.get(resource.path) ?? EMPTY_IMAGE_DATA_URL;
      if (!cache.has(resource.path) && localImageUrl) {
        try {
          url = await localImageUrl(resource.path);
          cache.set(resource.path, url);
        } catch {
          // 图片失败不能拖垮整张 Mermaid 图；透明像素保留节点布局。
        }
      }
      return { index: match.index ?? 0, length: match[0].length, value: `${match[1]}${match[2]}${url}${match[2]}` };
    }),
  );
  let rewritten = source;
  for (const replacement of replacements.reverse()) {
    if (!replacement) continue;
    rewritten = `${rewritten.slice(0, replacement.index)}${replacement.value}${rewritten.slice(replacement.index + replacement.length)}`;
  }
  return rewritten;
}

async function hydrateLocalImages(
  root: ParentNode,
  localImageUrl: LocalImageUrl | undefined,
  cancelled: () => boolean,
  cache: Map<string, string>,
) {
  if (!localImageUrl) return;
  await Promise.all(
    [...root.querySelectorAll<HTMLImageElement>("img[data-mc-local-src]")].map(async (img) => {
      const path = img.dataset.mcLocalSrc;
      if (!path || img.dataset.mdLoaded === "1") return;
      img.dataset.mdLoaded = "1";
      const cached = cache.get(path);
      if (cached) {
        img.src = cached;
        return;
      }
      img.setAttribute("aria-busy", "true");
      try {
        const url = await localImageUrl(path);
        if (cancelled() || !img.isConnected) return;
        cache.set(path, url);
        img.src = url;
        img.removeAttribute("aria-busy");
      } catch (error) {
        if (cancelled() || !img.isConnected) return;
        img.removeAttribute("aria-busy");
        img.removeAttribute("data-md-loaded");
        img.title = t("md.localImageFailed", { reason: error instanceof Error ? error.message : String(error) });
      }
    }),
  );
}

async function renderMermaidDiagrams(
  root: HTMLElement,
  localImageUrl: LocalImageUrl | undefined,
  imageCache: Map<string, string>,
  cancelled: () => boolean,
): Promise<void> {
  const diagrams = [...root.querySelectorAll<HTMLElement>("[data-md-mermaid]")];
  if (diagrams.length === 0) return;

  ensureMermaidStyleSheet();
  const { default: mermaid } = await import("mermaid");
  if (cancelled()) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: getComputedStyle(root).colorScheme.includes("dark") ? "dark" : "default",
  });

  for (const diagram of diagrams) {
    if (cancelled()) return;
    try {
      const source = await resolveMermaidImageSources(diagram.textContent ?? "", localImageUrl, imageCache);
      if (cancelled() || !diagram.isConnected) return;
      const { svg, bindFunctions } = await mermaid.render(`mc-mermaid-${++mermaidRenderId}`, source);
      if (cancelled() || !diagram.isConnected) return;
      // strict 模式已由 Mermaid 清洗；再次用纯 SVG profile 会删掉 architecture 的 foreignObject 正文。
      diagram.innerHTML = svg;
      normalizeResourceUrls(diagram);
      await hydrateLocalImages(diagram, localImageUrl, cancelled, imageCache);
      if (cancelled() || !diagram.isConnected) return;
      bindFunctions?.(diagram);
      diagram.removeAttribute("aria-busy");
    } catch {
      if (!cancelled() && diagram.isConnected) diagram.removeAttribute("aria-busy");
    }
  }
}

function mermaidSvgSize(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.viewBox?.baseVal;
  const rect = svg.getBoundingClientRect();
  return {
    width: Math.max(1, viewBox?.width || rect.width || Number.parseFloat(svg.getAttribute("width") ?? "") || 1),
    height: Math.max(1, viewBox?.height || rect.height || Number.parseFloat(svg.getAttribute("height") ?? "") || 1),
  };
}

function serializeMermaidSvg(svg: SVGSVGElement, size?: { width: number; height: number }): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (size) {
    clone.setAttribute("width", String(size.width));
    clone.setAttribute("height", String(size.height));
  }
  const foreground = getComputedStyle(svg.closest(".md-mermaid") ?? svg).color || "#333";
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `.flowchart-link,.edgePath .path{stroke:${foreground}!important}.arrowheadPath,.arrowMarkerPath,.root .anchor path{fill:${foreground}!important;stroke:${foreground}!important}`;
  clone.prepend(style);
  return new XMLSerializer().serializeToString(clone);
}

async function mermaidPngBlob(svg: SVGSVGElement): Promise<Blob> {
  const size = mermaidSvgSize(svg);
  const source = serializeMermaidSvg(svg, size);
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error("SVG decode failed"));
      next.src = url;
    });
    const scale = Math.max(0.1, Math.min(2, window.devicePixelRatio || 1, 8192 / size.width, 8192 / size.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(size.width * scale);
    canvas.height = Math.ceil(size.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.scale(scale, scale);
    const diagramStyle = getComputedStyle(svg.closest(".md-mermaid") ?? svg);
    const background = diagramStyle.getPropertyValue("--color-base-100").trim() || diagramStyle.backgroundColor || "#fff";
    context.fillStyle = "#fff";
    context.fillStyle = background;
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encode failed"))), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function copyMermaidPng(svg: SVGSVGElement): void {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return;
  const item = new ClipboardItem({ "image/png": mermaidPngBlob(svg) });
  navigator.clipboard.write([item]).catch(() => {});
}

function onContainerContextMenu(e: MouseEvent<HTMLElement>) {
  if (!(e.target instanceof Element)) return;
  const svg = e.target.closest<SVGSVGElement>(".md-mermaid svg");
  if (!svg) return;
  e.preventDefault();
  e.stopPropagation();
  const copyImageSupported = typeof ClipboardItem !== "undefined" && Boolean(navigator.clipboard?.write);
  openMenu(
    { x: e.clientX, y: e.clientY },
    [
      {
        label: t("md.copyImage"),
        run: () => copyMermaidPng(svg),
        disabledReason: copyImageSupported ? undefined : t("md.copyImageUnsupported"),
      },
      { label: t("md.copySvg"), run: () => copyText(serializeMermaidSvg(svg)) },
    ],
  );
}

function makeMarked(): Marked {
  const m = new Marked({ gfm: true, breaks: true, async: false });
  m.use({
    renderer: {
      code({ text, lang }) {
        // marked 18 的 `lang` 是**整条 info string**(```ts twoslash、
        // ```bash {1,3} 里空格后面那些元信息一并给过来),而 hljs.getLanguage
        // 认的是纯语言名——不切首词的话这类围栏一律降级成无高亮
        const name = (lang ?? "").trim().split(/\s+/)[0] ?? "";
        if (name.toLowerCase() === "mermaid") {
          return `<div class="md-mermaid" data-md-mermaid="true" aria-busy="true"><pre><code>${escapeHtml(text)}</code></pre></div>`;
        }
        const language = name && text.length <= HLJS_MAX_CHARS && hljs.getLanguage(name) ? name : null;
        const body = language ? hljs.highlight(text, { language }).value : escapeHtml(text);
        // data-md-copy 携带原文(escape 过),复制走它而不是回读高亮 DOM
        return (
          `<div class="md-code">` +
          `<button type="button" class="btn btn-xs absolute top-1.5 right-1.5 z-1 opacity-0" data-md-copy="${escapeHtml(text)}">${escapeHtml(t("md.copy"))}</button>` +
          `<pre><code class="hljs${language ? ` language-${language}` : ""}">${body}</code></pre>` +
          `</div>`
        );
      },
      table(token) {
        // 宽表格在容器内横滚,不撑破消息列
        const header = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("");
        // 数据行要带 align:GFM 的 `|---:|`(右对齐)/`|:-:|`(居中)全靠它,
        // 不发就是整表左对齐。表头不受影响——md.css 的 `.md th{text-align:left}`
        // 本来就把它盖掉了,旧 UI 亦然
        const rows = token.rows
          .map(
            (row) =>
              `<tr>${row
                .map((c, i) => {
                  const a = token.align[i];
                  return `<td${a ? ` align="${a}"` : ""}>${this.parser.parseInline(c.tokens)}</td>`;
                })
                .join("")}</tr>`,
          )
          .join("");
        return `<div class="md-scroll" tabindex="0"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
      },
    },
  });
  return m;
}

const parser = makeMarked();

/** 本地资源标记属性:只能壳自己打,不能让正文内容自带。
 * DOMPurify 默认放行 `data-*`,而 marked 会原样透传正文里的裸 HTML——模型
 * 输出(或被渲染的文件内容)里写一个 `<img data-mc-local-src="...">`,就能
 * 指使 UI 去读它挑的路径。边界另有壳 upload_read 的工作区校验兜底,但
 * "标记属性"和"用户内容"共用一个命名空间本身是脆的:解析后、打标记前先
 * 清一遍,标记就重新只有本组件能打(净化在打标之后,顺序不能反——file:
 * 等地址会被净化器移除)。 */
const LOCAL_MARKS = ["data-mc-local-src", "data-mc-local-href"] as const;
const XLINK_NS = "http://www.w3.org/1999/xlink";

function linkHref(link: Element): string {
  return link.getAttribute("href") ?? link.getAttributeNS(XLINK_NS, "href") ?? "";
}

function normalizeResourceUrls(root: ParentNode) {
  for (const mark of LOCAL_MARKS) {
    for (const el of root.querySelectorAll(`[${mark}]`)) el.removeAttribute(mark);
  }
  for (const img of root.querySelectorAll<HTMLImageElement>("img[src]")) {
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    const res = resolveMarkdownResource(img.getAttribute("src") || "");
    if (res.kind === "local") {
      img.dataset.mcLocalSrc = res.path;
      img.removeAttribute("src");
    } else if (res.kind === "url") {
      img.setAttribute("src", res.src);
    }
  }
  for (const link of root.querySelectorAll("a[href], a[xlink\\:href]")) {
    const res = resolveMarkdownResource(linkHref(link));
    link.removeAttributeNS(XLINK_NS, "href");
    if (res.kind === "local") {
      link.setAttribute("data-mc-local-href", res.path);
      link.setAttribute("href", "#");
    } else if (res.kind === "url") {
      link.setAttribute("href", res.src);
    }
  }
}

export function renderMarkdown(source: string): string {
  const template = document.createElement("template");
  template.innerHTML = parser.parse(source) as string;
  normalizeResourceUrls(template.content);
  // target/rel 交给点击代理,净化时保守放行 data-*(复制按钮原文载荷与本地标记)
  return DOMPurify.sanitize(template.innerHTML, { USE_PROFILES: { html: true } });
}

function onContainerClick(e: MouseEvent<HTMLElement>, onLocalLink?: (path: string) => void) {
  const target = e.target as HTMLElement;
  const copyBtn = target.closest<HTMLElement>("[data-md-copy]");
  if (copyBtn) {
    e.preventDefault();
    const text = copyBtn.getAttribute("data-md-copy") ?? "";
    // 走 lib/util/clipboard::copyText,不自写裸调用:全应用另外 7 处复制都用它
    // (异步 API 缺失/被拒时回退 execCommand——WebKitGTK 可能没有 async
    // clipboard,WKWebView 会拒权限,未聚焦时还会抛 NotAllowedError)。
    // 此前这里是 `if (!clipboard?.writeText) return;` 静默返回 + `.then()` 无
    // `.catch()`:前者让消息流里最高频的这颗按钮点了没反应也不报错,后者的
    // 未处理拒绝会被 index.html 的兜底画成满屏红底诊断面板。
    copyText(text);
    const original = copyBtn.textContent;
    copyBtn.textContent = t("md.copied");
    window.setTimeout(() => {
      copyBtn.textContent = original;
    }, 1500);
    return;
  }
  const link = target.closest("a");
  if (link) {
    // 契约:webview 不导航——工作区文件走 reveal 回调,其余交系统浏览器
    e.preventDefault();
    const local = link.getAttribute("data-mc-local-href");
    if (local) {
      onLocalLink?.(local);
      return;
    }
    openExternal(linkHref(link));
  }
}

/** 流式源文本的节流采样:值变化后至多每 ms 毫秒放行一次(带尾随提交,
 * 停流后最终全文必然落地),提交包在 startTransition 里可被输入打断。
 *
 * 为什么必须有(2026-08-10 用户 profile,「运行中打字卡」在行级 memo +
 * content-visibility 之后仍在):流式期间壳每 ~30ms 一批帧,尾部那条消息
 * 每批都换新——重新 marked + hljs **整条已流出的正文**,再经
 * dangerouslySetInnerHTML 整棵子树推倒重建,长回答一次就是 100~300ms JS
 * + ~275ms 样式重算。每秒 30 次,主线程饱和,解析常落在 input 事件的
 * 微任务检查点里,打字被记了流式的账(录制 3:input 平均 145ms/键)。
 * 行 memo 拦不了(条目真变了)、content-visibility 拦不了(尾部在视口内)。
 * 150ms ≈ 6~7fps:流式文字的可感知刷新率足够,重活量级直接砍到 1/5。
 *
 * 用显式计时器而不是 useDeferredValue:后者在持续高频更新下会被反复
 * 重启,长解析可能到停流前一次都完不成(饥饿),文字看起来冻住。 */
function useThrottled(value: string, ms: number): string {
  const [v, setV] = useState(value);
  const lastCommit = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, ms - (performance.now() - lastCommit.current));
    const timer = window.setTimeout(() => {
      lastCommit.current = performance.now();
      startTransition(() => setV(value));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return v;
}

/** 视口懒渲染(2026-08-10 用户报障「点进长任务很卡、CPU 100%」):挂载即跑
 * 完整管线(marked+hljs+DOMPurify+innerHTML)乘上 3000 帧窗口,打开长会话
 * 就是数秒满核——content-visibility 免掉的只有布局/绘制,免不掉挂载解析,
 * 这里补上另一半:视口外(含上下各 1.5 屏预热带)的消息先渲原文占位,
 * 所在行滚近了才升格解析。共享一个 IntersectionObserver,不给 3000 条
 * 消息各建一个实例。
 * ⚠️ 观察目标是**所在消息行**(data-chat-items 直接子行)而不是自身:
 * 被 content-visibility 剪枝的行其后代不参与布局,自身几何不可靠;行盒
 * (估高)恒存在。不在消息流里(设置页/弹层等无该祖先)则观察自身。 */
type NearCb = () => void;
const nearCbs = new Map<Element, Set<NearCb>>();
let nearIO: IntersectionObserver | null = null;

function observeNear(el: Element | null, cb: NearCb): () => void {
  // 环境无 IO(jsdom/极老 WebView)或异常拿不到锚元素:不懒,
  // 行为与懒渲染引入前完全一致
  if (!el || typeof IntersectionObserver === "undefined") {
    cb();
    return () => {};
  }
  nearIO ??= new IntersectionObserver(
    (entries) => {
      // 升格走 transition:快速滚动一口气命中多行时,成批解析不挡滚动/打字。
      // 无 IO 的同步回退(上方)不套——那条路要保持与懒渲染引入前完全同步
      startTransition(() => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const set = nearCbs.get(en.target);
          if (!set) continue;
          nearCbs.delete(en.target);
          nearIO?.unobserve(en.target);
          for (const fn of set) fn();
        }
      });
    },
    { rootMargin: "150% 0%" },
  );
  let set = nearCbs.get(el);
  if (!set) {
    set = new Set();
    nearCbs.set(el, set);
    nearIO.observe(el);
  }
  set.add(cb);
  return () => {
    const cur = nearCbs.get(el);
    if (!cur) return;
    cur.delete(cb);
    if (cur.size === 0) {
      nearCbs.delete(el);
      nearIO?.unobserve(el);
    }
  };
}

function useNearViewport(root: RefObject<HTMLDivElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    const el = root.current;
    const list = el?.closest("[data-chat-items]");
    let target: Element | null = el;
    if (el && list) {
      target = el;
      while (target.parentElement && target.parentElement !== list) target = target.parentElement;
    }
    return observeNear(target, () => setNear(true));
  }, [near, root]);
  return near;
}

/** 占位原文的截断上限:占位只为近似撑高与快速滚过时的过渡观感,几十 KB
 *  原文全塞进文本节点又是一份不小的挂载成本。真实高度差(截断/无图/无
 *  高亮)由既有的晚到高度修正机制吸收——contain-intrinsic-size auto 记忆
 *  + ChatView 锚点轮询/RO,与图片解码、loadFullTool 晚到同一条路。 */
const PLACEHOLDER_MAX_CHARS = 4_000;

/** 块级 markdown(消息正文)。localImageUrl/onLocalLink 缺省时行为与
 * 纯外链版完全一致(本地图不加载、本地链接点击无动作)。 */
export function Markdown({
  source,
  className,
  localImageUrl,
  onLocalLink,
  deferMermaid = false,
}: {
  source: string;
  className?: string;
  /** 本地图片回读通道(工作区相对/绝对路径 → data URL)。 */
  localImageUrl?: (path: string) => Promise<string>;
  /** 本地链接点击代理(reveal 到文件管理器等)。 */
  onLocalLink?: (path: string) => void;
  /** 流式正文尚未稳定时暂缓图表渲染，避免无法取消的旧任务积压。 */
  deferMermaid?: boolean;
}) {
  const { locale } = useI18n(); // 复制按钮文案随 locale 重渲
  const root = useRef<HTMLDivElement>(null);
  // 视口外挂起解析(见 useNearViewport 头注);升格后不回退——已建好的
  // DOM 留着比反复拆装便宜,视口外的静置成本已由 content-visibility 兜住
  const near = useNearViewport(root);
  // 流式节流(见 useThrottled 头注):首渲染立即解析,此后源文本变化至多
  // 每 150ms 放行一次——静态消息(历史窗口挂载)source 不变,零影响。
  // 超长正文自适应放宽:节流到点是**整篇**重解析 + 整棵子树重建,答案
  // 累积到几百 KB 时一次就是 74~81ms(2026-08-10 复现量化,流式尖刺的
  // 来源)——正文越长,刷新率越不重要(增量在末尾,读者根本看不完),
  // 100KB 以上降到 600ms 一档
  const throttled = useThrottled(source, source.length > 100_000 ? 600 : 150);
  // locale 看着"没用到",实则 renderMarkdown 内部经 code renderer 调了
  // t("md.copy") 把文案烤进 HTML——静态分析看不穿这层,去掉它换语言后
  // 已渲染的消息里复制按钮会一直是旧语言
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => (near ? renderMarkdown(throttled) : ""), [near, throttled, locale]);
  // 升格引起的行高突变(占位原文 vs 解析产物,差值可达千 px 级)不在这里
  // 补偿:按因补偿曾试过一版,在「占位提交时记升格前高度」——但行在视口外
  // 被 content-visibility 跳过时占位没有盒子,记到的是 0,升格时按「新高
  // − 0」整块过量补偿,反把视图推飞(2026-08-11 报障二度复发的根因)。
  // 现在由 LogList 的**位移安全网**统一兜:RO 盯内容列,绘制前按视口锚点
  // 行的实际位移校正 scrollTop——量实际位移而非自报高度差,天然幂等。
  const cache = useRef(new Map<string, string>());
  const localImageUrlRef = useRef(localImageUrl);
  useEffect(() => {
    localImageUrlRef.current = localImageUrl;
  }, [localImageUrl]);
  // 本地图异步注入:流式重渲同一条消息时按路径缓存,不重复回读
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    let cancelled = false;
    hydrateLocalImages(container, localImageUrlRef.current, () => cancelled, cache.current).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [html]);
  useEffect(() => {
    const container = root.current;
    if (deferMermaid || !container) return;
    let cancelled = false;
    renderMermaidDiagrams(container, localImageUrlRef.current, cache.current, () => cancelled).catch(() => {
      if (cancelled) return;
      for (const diagram of container.querySelectorAll("[data-md-mermaid]")) diagram.removeAttribute("aria-busy");
    });
    return () => {
      cancelled = true;
    };
  }, [html, deferMermaid]);
  if (!near) {
    // 占位:原文按正文排版近似撑高。key 强制换节点,不让 React 在同一个
    // div 上做 children ↔ dangerouslySetInnerHTML 的原地切换
    return (
      <div key="pending" ref={root} className={`md select-text whitespace-pre-wrap break-words ${className ?? ""}`}>
        {source.slice(0, PLACEHOLDER_MAX_CHARS)}
      </div>
    );
  }
  return (
    <div
      key="md"
      ref={root}
      className={`md select-text ${className ?? ""}`}
      onClick={(e) => onContainerClick(e, onLocalLink)}
      onContextMenu={onContainerContextMenu}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** 行内 markdown(摘要行/子代理 feed):只解析行内语法,保持单行布局。 */
export function MarkdownInline({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(parser.parseInline(source) as string, { USE_PROFILES: { html: true } }), [source]);
  return <span className={`mdi ${className ?? ""}`} onClick={onContainerClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
