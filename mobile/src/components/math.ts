/**
 * 数学公式支持：markdown-it 分词插件 + MathJax TeX→SVG 转换。
 * 分隔符基于 desktop/ui-next 的 Markdown.tsx，并针对中文语境放宽/收紧（见正则处注释）：
 *   块级：独占行的 $$ … $$ / \[ … \]；行内：$…$、$$…$$、\(…\)、\[…\]（单行）。
 * 本模块不依赖 react-native，可在 node/jest 下直接测试；
 * MathJax 运行时较大（~1MB JS），由调用方 loadMathJax() 异步加载。
 */

export interface MathSvg {
  svg: string;
  /** 按传入 fontSize 折算后的像素尺寸。 */
  width: number;
  height: number;
  /** 基线以下深度（px，>=0），行内公式对齐用。 */
  depth: number;
}

// 与 desktop 相同的渲染预算：超长公式与宏定义类命令直接保留原文，
// 防止流式场景下恶意/异常输入拖垮 JS 线程。
export const MATH_MAX_SOURCE_CHARS = 512;
const MATH_DEFINITION_RE = /\\(?:def|gdef|edef|xdef|let|futurelet|newcommand|renewcommand|providecommand)\b/;
const SVG_CACHE_MAX = 256;
// 输出尺寸钳制（对应 desktop 的 KaTeX maxSize）：\rule{50em}{50em}（100ex）这类短输入
// 能画出巨型图形，内联进消息 Text 会撑爆行布局，超限回退原文。高度上限要容得下
// 十几行的 aligned 多行推导（约 3-4ex/行），同时仍拦住 rule 炸弹。
const MATH_MAX_WIDTH_EX = 200;
const MATH_MAX_HEIGHT_EX = 60;

// 与 desktop 正则的两点刻意差异（中文语境适配）：
// ①闭合 $ 的边界从白名单前瞻改为否定类：只拒绝紧跟字母/数字/$/\（货币或粘连续写），
//   这样「…$E=mc^2$的推导」「**$E=mc^2$**」「$a$-$b$」等相邻写法都能渲染——
//   desktop 的白名单沿用英文两侧留空格的习惯，这些场景整个不渲染；
// ②正文排除汉字与全角标点——「花了100$，总计200$。」这类跨两个货币符号的中文
//   片段不再被误判成公式（公式内确需中文可用 \(…\) 显式定界符，仍完整支持）。
const INLINE_DOLLAR_RE = /^\$(?!\$|\s)((?:\\.|[^\\\n`$一-龥。，！？：；、])*?(?:\\.|[^\\\s\n`$一-龥。，！？：；、]))\$(?![0-9A-Za-z$\\])/u;
const INLINE_DISPLAY_DOLLAR_RE = /^\$\$(?!\$)[ \t]*([^`\r\n一-龥。，！？：；、]*?\S)[ \t]*\$\$(?![0-9A-Za-z$\\])/u;

interface InlineMatch {
  raw: string;
  text: string;
  display: boolean;
}

function dollarMathMatch(src: string): InlineMatch | undefined {
  const display = src.startsWith('$$');
  const match = src.match(display ? INLINE_DISPLAY_DOLLAR_RE : INLINE_DOLLAR_RE);
  const text = match?.[1]?.trim();
  if (!match || !text) return undefined;
  return { raw: match[0], text, display };
}

function slashMathMatch(src: string, open: '\\(' | '\\[', close: '\\)' | '\\]', display: boolean): InlineMatch | undefined {
  if (!src.startsWith(open)) return undefined;
  const end = src.indexOf(close, open.length);
  if (end < 0) return undefined;
  const text = src.slice(open.length, end);
  if (!text.trim() || text.includes('\n') || text.includes('\r')) return undefined;
  return { raw: src.slice(0, end + close.length), text: text.trim(), display };
}

export function mathWithinRenderBudget(source: string): boolean {
  return source.length <= MATH_MAX_SOURCE_CHARS && !MATH_DEFINITION_RE.test(source);
}

// ── markdown-it 插件（markdown-it@10，react-native-markdown-display 自带的版本）──
// 类型：库未随带 d.ts，按需声明最小 state 形状。
type InlineState = {
  src: string;
  pos: number;
  posMax: number;
  push: (type: string, tag: string, nesting: number) => MathToken;
};
type BlockState = {
  src: string;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  sCount: number[];
  blkIndent: number;
  line: number;
  push: (type: string, tag: string, nesting: number) => MathToken;
  getLines: (begin: number, end: number, indent: number, keepLastLF: boolean) => string;
};
type MathToken = {
  content: string;
  markup: string;
  block: boolean;
  map: [number, number] | null;
  meta: { display: boolean } | null;
};

function mathInlineRule(state: InlineState, silent: boolean): boolean {
  // markdown-it 在每个终结符位置（* - : ` _ [ ] …）都会调到这里，先按首字符
  // 过滤再 slice——否则每次解析都是 O(n²) 的字符串垃圾（流式期间每秒重跑多次）。
  const ch = state.src.charCodeAt(state.pos);
  if (ch !== 0x24 /* $ */ && ch !== 0x5c /* \ */) return false;
  const src = state.src.slice(state.pos, state.posMax);
  let match: InlineMatch | undefined;
  if (ch === 0x24) match = dollarMathMatch(src);
  else match = slashMathMatch(src, '\\(', '\\)', false) ?? slashMathMatch(src, '\\[', '\\]', true);
  if (!match) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = match.text;
    token.markup = match.display ? '$$' : '$';
    token.meta = { display: match.display };
  }
  state.pos += match.raw.length;
  return true;
}

const BLOCK_OPEN_DOLLAR_RE = /^\$\$\s*$/;
const BLOCK_OPEN_BRACKET_RE = /^\\\[\s*$/;
const BLOCK_CLOSE_DOLLAR_RE = /^\$\$\s*$/;
const BLOCK_CLOSE_BRACKET_RE = /^\\\]\s*$/;
// 独占一行的单行 $$…$$ / \[…\]：desktop 用 CSS 把 display 公式提升成块盒，RN 没有
// 等价机制——按行内渲染的长公式会被屏幕右缘裁掉且无法滚动，这里直接按块级分词
//（居中 + 超宽横滚）。内容里含 $ 的行不匹配，交回行内规则处理「$$a$$ 和 $$b$$」。
const SINGLE_LINE_DOLLAR_BLOCK_RE = /^\$\$(?!\$)[ \t]*([^$]+?)[ \t]*\$\$\s*$/;
const SINGLE_LINE_BRACKET_BLOCK_RE = /^\\\[[ \t]*(.+?)[ \t]*\\\]\s*$/;

function mathBlockRule(state: BlockState, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const first = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);

  const single = first.match(SINGLE_LINE_DOLLAR_BLOCK_RE) ?? first.match(SINGLE_LINE_BRACKET_BLOCK_RE);
  if (single) {
    const content = single[1].trim();
    if (!content) return false;
    if (silent) return true;
    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = content;
    token.markup = '$$';
    token.map = [startLine, startLine + 1];
    token.meta = { display: true };
    state.line = startLine + 1;
    return true;
  }

  let closeRe: RegExp;
  if (BLOCK_OPEN_DOLLAR_RE.test(first)) closeRe = BLOCK_CLOSE_DOLLAR_RE;
  else if (BLOCK_OPEN_BRACKET_RE.test(first)) closeRe = BLOCK_CLOSE_BRACKET_RE;
  else return false;

  let closingLine = -1;
  for (let line = startLine + 1; line < endLine; line += 1) {
    if (state.sCount[line] - state.blkIndent >= 4) continue;
    const body = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    if (closeRe.test(body)) { closingLine = line; break; }
  }
  // 未闭合（流式尾部常见）：不吞掉后续内容，整段交回 paragraph 按原文显示。
  if (closingLine < 0) return false;
  const content = state.getLines(startLine + 1, closingLine, state.blkIndent, false).trim();
  // 空正文保留原文（行内规则同样拒绝空正文，避免渲染出一条空白带）。
  if (!content) return false;
  if (silent) return true;

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = content;
  token.markup = '$$';
  token.map = [startLine, closingLine + 1];
  token.meta = { display: true };
  state.line = closingLine + 1;
  return true;
}

/** 挂到 MarkdownIt 实例：md.use(mathPlugin)。 */
export function mathPlugin(md: {
  inline: { ruler: { before: (name: string, rule: string, fn: unknown) => void } };
  block: { ruler: { before: (name: string, rule: string, fn: unknown, opts: unknown) => void } };
}): void {
  // escape 规则会把 \( 消费成字面量 (，必须排在它前面。
  md.inline.ruler.before('escape', 'math_inline', mathInlineRule);
  md.block.ruler.before('fence', 'math_block', mathBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}

// ── MathJax TeX→SVG：懒加载 + LRU 缓存 ─────────────────────────────────
type Converter = (tex: string, display: boolean) => string;

let converter: Converter | null = null;
let converterPromise: Promise<Converter> | null = null;
let loadFailed = false;
const readyListeners = new Set<() => void>();
const svgCache = new Map<string, MathSvg | null>();

async function createConverter(): Promise<Converter> {
  // mathjax 的 components/version.js 在没有打包器注入 PACKAGE_VERSION 时，
  // 模块求值期会走 eval('require') 读 package.json —— Hermes 的 eval 作用域
  // 拿不到 require，直接 ReferenceError。先补上该全局常量让它走静态分支。
  const g = globalThis as Record<string, unknown>;
  if (typeof g.PACKAGE_VERSION === 'undefined') g.PACKAGE_VERSION = '3.2.1';
  // Metro 按 ESM 编译模块，作用域里没有 CommonJS require；动态 import()
  // 是 Metro 的原生懒加载通道，模块求值推迟到首个公式出现时。
  const modules: any[] = await Promise.all([
    import('mathjax-full/js/mathjax.js'),
    import('mathjax-full/js/input/tex.js'),
    import('mathjax-full/js/output/svg.js'),
    import('mathjax-full/js/adaptors/liteAdaptor.js'),
    import('mathjax-full/js/handlers/html.js'),
    import('mathjax-full/js/input/tex/AllPackages.js'),
  ]);
  const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] = modules;
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  // autoload/require 走动态装载路径，脱离浏览器环境不可用。
  const packages = (AllPackages as string[]).filter((p) => p !== 'autoload' && p !== 'require');
  const tex = new TeX({ packages, maxMacros: 1000, maxBuffer: 5 * 1024 });
  const svg = new SVG({ fontCache: 'local' });
  const doc = mathjax.document('', { InputJax: tex, OutputJax: svg });
  return (source: string, display: boolean) => {
    const node = doc.convert(source, { display, em: 16, ex: 8, containerWidth: 16 * 60 });
    return adaptor.innerHTML(node);
  };
}

export function mathJaxReady(): boolean {
  return converter !== null;
}

/**
 * 供 useSyncExternalStore 使用：订阅即触发加载。就绪时在同一个回调里同步
 * 通知全部订阅者 —— 会话里可能同时挂着上百个公式组件，若各自 .then 链上
 * converterPromise，resolve 会摊到上百个连续微任务里、每个各提交一次更新，
 * React 连续嵌套提交超过 50 次即抛 Maximum update depth exceeded。
 */
export function subscribeMathJaxReady(listener: () => void): () => void {
  readyListeners.add(listener);
  void loadMathJax();
  return () => { readyListeners.delete(listener); };
}

/** 异步初始化 MathJax（求值 ~1MB JS，一次性）；失败后不再自动重试。 */
export function loadMathJax(): Promise<void> {
  if (converter || loadFailed) return Promise.resolve();
  if (!converterPromise) {
    converterPromise = createConverter().then((c) => {
      converter = c;
      for (const listener of [...readyListeners]) listener();
      return c;
    });
    converterPromise.catch(() => { loadFailed = true; converterPromise = null; });
  }
  return converterPromise.then(() => undefined, () => undefined);
}

const SVG_WIDTH_RE = /\bwidth="(-?[\d.]+)ex"/;
const SVG_HEIGHT_RE = /\bheight="(-?[\d.]+)ex"/;
const SVG_VALIGN_RE = /vertical-align:\s*(-?[\d.]+)ex/;

/**
 * TeX → SVG。MathJax 未就绪 / 超预算 / 转换失败返回 null（调用方回退原文）。
 * 尺寸按 fontSize 折算（MathJax 的 ex 单位 ≈ fontSize/2）。
 */
export function texToSvg(source: string, display: boolean, fontSize: number): MathSvg | null {
  if (!converter || !mathWithinRenderBudget(source)) return null;
  const key = `${display ? 'B' : 'I'}\0${source}`;
  const cached = svgCache.get(key);
  if (cached !== undefined) {
    // 命中刷新插入顺序，长会话里高频公式不被淘汰。
    svgCache.delete(key);
    svgCache.set(key, cached);
    return cached ? scale(cached, fontSize) : null;
  }
  let result: MathSvg | null = null;
  try {
    const svg = converter(source, display);
    const width = Number.parseFloat(SVG_WIDTH_RE.exec(svg)?.[1] ?? '');
    const height = Number.parseFloat(SVG_HEIGHT_RE.exec(svg)?.[1] ?? '');
    const depth = Number.parseFloat(SVG_VALIGN_RE.exec(svg)?.[1] ?? '0');
    if (
      svg.includes('<svg') && Number.isFinite(width) && Number.isFinite(height) &&
      width <= MATH_MAX_WIDTH_EX && height <= MATH_MAX_HEIGHT_EX
    ) {
      // 缓存存 ex 尺寸（width/height/depth 字段单位为 ex），取用时按字号换算。
      result = { svg, width, height, depth: Number.isFinite(depth) ? Math.max(0, -depth) : 0 };
    }
  } catch {
    result = null;
  }
  if (svgCache.size >= SVG_CACHE_MAX) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) svgCache.delete(oldest);
  }
  svgCache.set(key, result);
  return result ? scale(result, fontSize) : null;
}

function scale(exSized: MathSvg, fontSize: number): MathSvg {
  const exPx = fontSize / 2;
  return {
    svg: exSized.svg,
    width: exSized.width * exPx,
    height: exSized.height * exPx,
    depth: exSized.depth * exPx,
  };
}
