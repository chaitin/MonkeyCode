/**
 * Agent 活动流的消息块渲染 —— 对齐设计稿 screen-chat.jsx。
 * 复用 messages/handler 的 ChatMessage 类型（user / agent / thought / tool / error / system / ask）。
 */
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Dimensions, Image, Keyboard, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Markdown, { MarkdownIt } from 'react-native-markdown-display';
import { parse as parseSvg, SvgAst, type JsxAST } from 'react-native-svg';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import type { AskQuestion, ChatMessage } from '@/messages/handler';
import { buildAskAnswers, CUSTOM_ANSWER_KEY, type AnswerMap } from '@/messages/askAnswers';
import { resolveAssetUrl } from '@/api/client';
import { Icons, Spinner } from '@/components/Icons';
import { mathJaxReady, mathPlugin, subscribeMathJaxReady, texToSvg } from '@/components/math';
import { buildMermaidHtml, fenceLanguage, trimFenceContent } from '@/components/mermaidHtml';
import { spacing, useTheme, type Theme } from '@/theme';

export type { AnswerMap } from '@/messages/askAnswers';
export type AnswerSubmitResult = 'sent' | 'queued' | 'rejected';
export type AnswerSubmitState = Exclude<AnswerSubmitResult, 'rejected'>;

const MERMAID_RUNTIME_ASSET = require('../../assets/mermaid.min.mermaidjs');
let mermaidRuntimePromise: Promise<string> | null = null;

function loadMermaidRuntime(): Promise<string> {
  if (mermaidRuntimePromise) return mermaidRuntimePromise;
  mermaidRuntimePromise = (async () => {
    const asset = Asset.fromModule(MERMAID_RUNTIME_ASSET);
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    if (!uri) throw new Error('Mermaid runtime asset is unavailable');
    return FileSystem.readAsStringAsync(uri);
  })().catch((error) => {
    mermaidRuntimePromise = null;
    throw error;
  });
  return mermaidRuntimePromise;
}

// 与库内默认 MarkdownIt({typographer:true}) 配置一致，仅追加数学公式分词。
const markdownItWithMath = MarkdownIt({ typographer: true }).use(mathPlugin);

/** MathJax 就绪状态：订阅即触发异步加载；就绪时全部公式组件在一次批量重渲中切换。 */
function useMathJax(): boolean {
  return useSyncExternalStore(subscribeMathJaxReady, mathJaxReady);
}

const MD_FONT_SIZE = 14.5;

// markdown-display 每次解析都重建整棵 AST（父节点 key 全换 → 公式组件必然重挂载），
// SvgXml 每次挂载都要重新解析数 KB 的 MathJax XML。按 svg 字符串缓存解析产物 +
// SvgAst 直渲，重挂载就只剩原生视图重建。
const MATH_AST_CACHE_MAX = 256;
const mathAstCache = new Map<string, JsxAST | null>();

function mathSvgAst(svg: string): JsxAST | null {
  const cached = mathAstCache.get(svg);
  if (cached !== undefined) {
    // 命中刷新插入顺序（LRU）：否则超容量后先淘汰的是屏幕上正在用的早期公式。
    mathAstCache.delete(svg);
    mathAstCache.set(svg, cached);
    return cached;
  }
  let ast: JsxAST | null = null;
  try { ast = parseSvg(svg); } catch { ast = null; }
  if (mathAstCache.size >= MATH_AST_CACHE_MAX) {
    const oldest = mathAstCache.keys().next().value;
    if (oldest !== undefined) mathAstCache.delete(oldest);
  }
  mathAstCache.set(svg, ast);
  return ast;
}

// mdStyles.body 的行高；Android 行内公式的可用高度以它为上限。
const MD_LINE_HEIGHT = 23;

/** 行内公式：SVG 以内联视图排进文字流；未就绪/失败回退原文。 */
function MathInline({ tex, display, t }: { tex: string; display: boolean; t: Theme }) {
  const ready = useMathJax();
  const rendered = ready ? texToSvg(tex, display, MD_FONT_SIZE) : null;
  const ast = rendered ? mathSvgAst(rendered.svg) : null;
  if (!rendered || !ast) {
    return <Text style={{ color: t.tx2, fontFamily: 'monospace', fontSize: 13 }}>{display ? `$$${tex}$$` : `$${tex}$`}</Text>;
  }
  // 行内视图没有横滚能力，超出屏宽会被右缘直接裁掉：按可用宽度（屏宽减列表左右
  // 内边距）等比缩小兜底。真正的长公式应走块级（单行 $$…$$ 已提升，见 math.ts）。
  const availWidth = Dimensions.get('window').width - spacing.pad * 2 - 4;
  let k = rendered.width > availWidth ? availWidth / rendered.width : 1;
  if (Platform.OS === 'android') {
    // Android 的 lineHeight 由 CustomLineHeightSpan 钉死为固定行高，内联视图高过
    // 行盒会直接画到相邻行上；translateY 下移（占位 span descent=0）同样会叠行。
    // 这里把公式等比缩进行盒、底边落在基线上，不再做基线下移。
    const maxH = MD_LINE_HEIGHT - 3;
    if (rendered.height * k > maxH) k = maxH / rendered.height;
    return <SvgAst ast={ast} override={{ pointerEvents: 'none' as const, width: rendered.width * k, height: rendered.height * k, color: t.tx }} />;
  }
  // iOS 内联视图底边落在基线上，向下平移 depth 让公式自身基线与正文基线对齐。
  return (
    <SvgAst
      ast={ast}
      override={{
        // SvgView 的 interceptsTouchEvent 无条件认领触摸（Android），会挡住祖先
        // ScrollView/Pressable；公式不需要触摸，整体退出 hit-test。
        pointerEvents: 'none' as const,
        width: rendered.width * k,
        height: rendered.height * k,
        color: t.tx,
        style: { transform: [{ translateY: rendered.depth * k }] },
      }}
    />
  );
}

// 块级公式可读性下限：缩放低于该值时提示点按放大（列表内不再做横滚——嵌套反向
// 滚动的手势仲裁里竖向列表永远占先手，横滑基本触发不了）。
const MIN_BLOCK_MATH_SCALE = 0.72;

/** 块级公式：一律等比缩放进一屏、居中展示；缩得过小的长公式点按弹出全屏查看器
 *（独立 Modal 内的横滑没有手势竞争，滑动必定顺畅）。 */
function MathBlock({ tex, t }: { tex: string; t: Theme }) {
  const ready = useMathJax();
  const [expanded, setExpanded] = useState(false);
  const rendered = ready ? texToSvg(tex, true, MD_FONT_SIZE + 1.5) : null;
  const ast = rendered ? mathSvgAst(rendered.svg) : null;
  if (!rendered || !ast) {
    return <Text style={{ color: t.tx2, fontFamily: 'monospace', fontSize: 12.5, lineHeight: 19, marginVertical: 7 }}>{`$$\n${tex}\n$$`}</Text>;
  }
  const availWidth = Dimensions.get('window').width - spacing.pad * 2;
  const fit = Math.min(1, availWidth / rendered.width);
  return (
    <>
      <Pressable disabled={fit >= 1} onPress={() => setExpanded(true)} style={{ marginVertical: 7, paddingVertical: 4, alignItems: 'center' }}>
        <SvgAst ast={ast} override={{ pointerEvents: 'none' as const, width: rendered.width * fit, height: rendered.height * fit, color: t.tx }} />
        {fit < MIN_BLOCK_MATH_SCALE ? (
          <Text style={{ marginTop: 6, color: t.tx3, fontSize: 11.5 }}>公式过长已缩小 · 点按放大查看</Text>
        ) : null}
      </Pressable>
      {expanded ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setExpanded(false)} statusBarTranslucent>
          {/* 背板与滚动内容必须是兄弟层级（对齐「更多」弹层的 Scrim 结构）：Pressable
              作为 ScrollView 祖先时会与原生滚动抢触摸——拖动不滚、抬手还触发 onPress
              把弹层直接关掉。竖直方向加大 padding，扩大可滑动条带的命中区。 */}
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Pressable onPress={() => setExpanded(false)}
              style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: t.dark ? 'rgba(8,8,8,0.92)' : 'rgba(252,252,250,0.97)' }} />
            <ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 56, alignItems: 'center' }}>
              <SvgAst ast={ast} override={{ pointerEvents: 'none' as const, width: rendered.width, height: rendered.height, color: t.tx }} />
            </ScrollView>
            <Text pointerEvents="none" style={{ position: 'absolute', bottom: 48, alignSelf: 'center', color: t.tx3, fontSize: 12.5 }}>左右滑动查看 · 点按空白处关闭</Text>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function mdStyles(t: Theme) {
  return {
    body: { color: t.tx, fontSize: 14.5, lineHeight: 23 },
    paragraph: { color: t.tx, fontSize: 14.5, lineHeight: 23, marginTop: 0, marginBottom: 8 },
    heading1: { color: t.tx, fontSize: 20, fontWeight: '700', marginVertical: 6 },
    heading2: { color: t.tx, fontSize: 17, fontWeight: '700', marginVertical: 5 },
    heading3: { color: t.tx, fontSize: 15, fontWeight: '700', marginVertical: 4 },
    strong: { color: t.tx, fontWeight: '700' },
    em: { color: t.tx, fontStyle: 'italic' },
    link: { color: t.acTx },
    bullet_list: { marginVertical: 4 },
    ordered_list: { marginVertical: 4 },
    list_item: { color: t.tx, marginVertical: 1 },
    code_inline: { color: t.acTx, backgroundColor: t.bg3, borderRadius: 5, paddingHorizontal: 5, fontFamily: 'monospace', fontSize: 13 },
    code_block: { color: t.termTx, backgroundColor: t.termBg, borderRadius: 11, padding: 12, fontFamily: 'monospace', fontSize: 12 },
    fence: { color: t.termTx, backgroundColor: t.termBg, borderRadius: 11, padding: 12, fontFamily: 'monospace', fontSize: 12 },
    blockquote: { backgroundColor: t.bg3, borderColor: t.line2, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    hr: { backgroundColor: t.line2, height: 1 },
  } as const;
}

// markdown 里的图片（AI 常用 ![](url) 返回图）。默认 react-native-markdown-display 用 react-native-fit-image
// 渲染 → 它把含 key 的 props 展开进 JSX（React19 告警），且 indicator 转圈在新架构上不消失。
// 这里用普通 <Image> + Image.getSize 自适应比例替代：无转圈、无告警；点按可保存到相册。
function MarkdownImage({ uri, t, onSave }: { uri: string; t: Theme; onSave?: (url: string) => void }) {
  const [ratio, setRatio] = useState(1.6);
  const [failed, setFailed] = useState(false);
  // uri 变化时重置，避免上一张的失败/比例残留到新图（流式重渲染、列表复用时）。
  useEffect(() => { setFailed(false); setRatio(1.6); }, [uri]);
  if (failed || !uri) return null;
  // 直接用渲染这张图时的 onLoad 拿尺寸（单次加载），不再额外 Image.getSize 探测一遍。
  return (
    <Pressable onPress={() => onSave?.(uri)} style={{ marginVertical: 6 }}>
      <Image source={{ uri }} resizeMode="contain"
        onLoad={(e) => { const s = e?.nativeEvent?.source; if (s?.width && s?.height) setRatio(s.width / s.height); }}
        onError={() => setFailed(true)}
        style={{ width: '100%', aspectRatio: ratio, borderRadius: 10, backgroundColor: t.bg3 }} />
    </Pressable>
  );
}

function MermaidDiagram({ code, t }: { code: string; t: Theme }) {
  const [height, setHeight] = useState(120);
  const [failed, setFailed] = useState(false);
  const [runtime, setRuntime] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMermaidRuntime()
      .then((script) => { if (!cancelled) setRuntime(script); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { setHeight(120); setFailed(false); }, [code]);

  const html = useMemo(() => runtime ? buildMermaidHtml(code, t, runtime) : '', [code, runtime, t]);

  if (failed) {
    return <Text style={mdStyles(t).fence}>{code}</Text>;
  }

  return (
    <View style={{ marginVertical: 7, height: runtime ? height : 120, borderRadius: 12, overflow: 'hidden', backgroundColor: t.bg2 }}>
      {!runtime ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 120, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color={t.acTx} />
        </View>
      ) : null}
      {runtime ? (
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          javaScriptEnabled
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          onMessage={(event) => {
            try {
              const msg = JSON.parse(event.nativeEvent.data);
              if (msg.type === 'height' && Number.isFinite(msg.value)) setHeight(Math.max(32, Math.min(1600, Number(msg.value))));
              if (msg.type === 'error') setFailed(true);
            } catch { /* ignore malformed WebView messages */ }
          }}
          onError={() => setFailed(true)}
          style={{ height, backgroundColor: 'transparent' }}
        />
      ) : null}
    </View>
  );
}

// 内容哈希 key：markdown-display 的 node.key 每次解析都重新生成，直接用它会让
// mermaid/公式这类重组件在流式期间每个节流帧都整个重挂载。仅对顶层节点有效，
// 且前提是 body 根节点的 key 恒定（见 markdownRules 的 body 覆盖）；行内公式因
// 父级 textgroup/paragraph key 仍会翻新而照旧重挂载，靠 svg/AST 缓存把成本压低。
function stableNodeKey(prefix: string, node: { index?: number; tokenIndex?: number }, text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 31) + text.charCodeAt(i)) | 0;
  return `${prefix}-${node.tokenIndex ?? node.index ?? 0}-${text.length}-${hash >>> 0}`;
}

function stableMermaidKey(node: { content?: string; index?: number; tokenIndex?: number }): string {
  return stableNodeKey('mermaid', node, trimFenceContent(node.content));
}

/** 覆盖 markdown 的 image/fence 规则（图片修告警；mermaid fence 渲染为图；数学公式渲染为 SVG）。 */
function markdownRules(t: Theme, onSave?: (url: string) => void, renderMermaid = true) {
  return {
    // 库的 AstRenderer.render 给根 body 每次解析都发新 key（getUniqueID），导致整棵
    // 子树每帧重挂载、子级稳定 key 全部失效；覆盖成恒定 key 后，顶层稳定 key 的
    // 节点（块级公式/mermaid）在流式重解析间得以保留原生视图。
    body: (_node: unknown, children: React.ReactNode, _parent: unknown, styles: Record<string, any>) => (
      <View key="md-body" style={styles._VIEW_SAFE_body}>{children}</View>
    ),
    image: (node: { key: string; attributes?: { src?: string; alt?: string } }) => (
      <MarkdownImage key={node.key} uri={resolveAssetUrl(node.attributes?.src) ?? node.attributes?.src ?? ''} t={t} onSave={onSave} />
    ),
    fence: (node: { key: string; content?: string; sourceInfo?: string; info?: string; index?: number; tokenIndex?: number }, _children: unknown, _parent: unknown, styles: Record<string, any>, inheritedStyles: any = {}) => {
      const lang = fenceLanguage(node);
      const content = trimFenceContent(node.content);
      if (lang === 'mermaid' && renderMermaid) return <MermaidDiagram key={stableMermaidKey(node)} code={content} t={t} />;
      return <Text key={node.key} style={[inheritedStyles, styles.fence]}>{content}</Text>;
    },
    math_inline: (node: { key: string; content?: string; index?: number; tokenIndex?: number; sourceMeta?: { display?: boolean } }) => (
      <MathInline key={stableNodeKey('mathi', node, node.content ?? '')} tex={node.content ?? ''} display={!!node.sourceMeta?.display} t={t} />
    ),
    math_block: (node: { key: string; content?: string; index?: number; tokenIndex?: number }) => (
      <MathBlock key={stableNodeKey('mathb', node, node.content ?? '')} tex={node.content ?? ''} t={t} />
    ),
  };
}

function useThrottledText(text: string, active: boolean, intervalMs = 100): string {
  const [renderText, setRenderText] = useState(text);
  const lastUpdateRef = useRef(0);
  const latestTextRef = useRef(text);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  latestTextRef.current = text;

  useEffect(() => () => {
    if (pendingRef.current) clearTimeout(pendingRef.current);
  }, []);

  useEffect(() => {
    if (!active) {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = null;
      lastUpdateRef.current = Date.now();
      setRenderText(text);
      return;
    }

    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;
    if (elapsed >= intervalMs) {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = null;
      lastUpdateRef.current = now;
      setRenderText(text);
      return;
    }

    if (!pendingRef.current) {
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        lastUpdateRef.current = Date.now();
        setRenderText(latestTextRef.current);
      }, intervalMs - elapsed);
    }
  }, [active, intervalMs, text]);

  return renderText;
}

function AgentMarkdown({ text, isStreaming, t, onCopy, onSaveImage }: { text: string; isStreaming?: boolean; t: Theme; onCopy?: (text: string) => void; onSaveImage?: (url: string) => void }) {
  const displayText = useThrottledText(text, !!isStreaming);
  const rules = useMemo(() => markdownRules(t, onSaveImage, !isStreaming), [isStreaming, onSaveImage, t]);
  // style 每次新建对象会击穿 Markdown 的 memo：即使 displayText 未变（如仅回调身份
  // 变化引起的重渲）也会整篇重新解析。按主题记忆化，让 memo 真正生效。
  const style = useMemo(() => mdStyles(t) as any, [t]);
  return (
    <Pressable onPress={() => Keyboard.dismiss()} onLongPress={() => onCopy?.(text)}>
      <Markdown style={style} rules={rules} markdownit={markdownItWithMath}>{displayText}</Markdown>
    </Pressable>
  );
}

function toolIcon(kind?: string): string {
  switch (kind) {
    case 'read': return 'file';
    case 'edit': return 'edit';
    case 'create': return 'filePlus';
    case 'delete': case 'move': return 'file';
    case 'execute': return 'terminal';
    case 'search': return 'search';
    case 'fetch': return 'search';
    case 'think': return 'brain';
    default: return 'cube';
  }
}

function ThoughtBlock({ text, t, onCopy }: { text: string; t: Theme; onCopy?: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((o) => !o)} onLongPress={() => onCopy?.(text)} style={{ paddingVertical: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icons.brain size={14} color={t.tx3} sw={1.6} />
        <Text style={{ color: t.tx3, fontSize: 12.5, fontWeight: '500' }}>思考过程</Text>
        <Icons.chevron size={13} color={t.tx3} sw={1.9} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </View>
      {open ? <Text style={{ marginTop: 7, paddingLeft: 21, color: t.tx3, fontSize: 13, lineHeight: 20, fontStyle: 'italic' }}>{text}</Text> : null}
    </Pressable>
  );
}

// ── 错误块：默认折叠（最多 6 行），完整错误可能很长（堆栈）→ 点击展开 / 长按复制 ──────
function ErrorBlock({ text, t, onCopy }: { text: string; t: Theme; onCopy?: (s: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 200 || text.split('\n').length > 6;
  return (
    <Pressable onPress={long ? () => setExpanded((v) => !v) : undefined} onLongPress={() => onCopy?.(text)}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: t.redGhost, borderWidth: 1, borderColor: t.red, borderRadius: 13, padding: 12 }}>
      <Icons.alert size={16} color={t.red} sw={1.9} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={long && !expanded ? 6 : undefined} style={{ color: t.red, fontSize: 13.5, lineHeight: 20 }}>{text}</Text>
        {long ? <Text style={{ color: t.red, opacity: 0.75, fontSize: 11.5, fontWeight: '700', marginTop: 7 }}>{expanded ? '收起' : '展开完整错误'} · 长按复制</Text> : null}
      </View>
    </Pressable>
  );
}

// ── 工具调用卡片：两行（动作 + 目标）+ 点击展开详情（对齐 web message-toolcall）──────
type ToolMsg = Extract<ChatMessage, { kind: 'tool' }>;

const cleanStr = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim() : '');

/** 动作名：按 ACP kind；编辑类随状态变化；未知 kind 回退到中文短标题或「工具调用」。 */
function toolAction(m: ToolMsg): string {
  const editing = m.status === 'failed' ? '修改文件失败'
    : (m.status === 'pending' || m.status === 'in_progress') ? '正在修改文件' : '修改文件';
  switch (m.toolKind) {
    case 'edit': return editing;
    case 'read': return '读取文件';
    case 'execute': return '执行命令';
    case 'search': return '查找内容';
    case 'fetch': return '获取网页';
    case 'delete': return '删除文件';
    case 'move': return '移动文件';
    case 'think': return '思考';
    default:
      if (typeof m.title === 'string' && m.title.length < 24 && /[一-龥]/.test(m.title)) return m.title;
      return '工具调用';
  }
}

/** 目标：文件路径 / 命令 / 关键词 / URL。 */
function toolTarget(m: ToolMsg): string {
  const ri = m.rawInput ?? {};
  const path = cleanStr(ri.file_path ?? ri.filePath ?? ri.path);
  if (path) return path;
  if (typeof ri.command === 'string') return cleanStr(ri.command);
  if (Array.isArray(ri.command) && ri.command.length) return cleanStr(ri.command[ri.command.length - 1]);
  if (ri.parsed_cmd?.[0]?.cmd) return cleanStr(ri.parsed_cmd[0].cmd);
  if (ri.pattern) return cleanStr(ri.pattern);
  if (ri.url) return cleanStr(ri.url);
  if (ri.query) return cleanStr(ri.query);
  return '';
}

/** 展开详情：编辑 diff / 命令输出 / 文件内容 / 兜底原始入参。 */
function toolDetail(m: ToolMsg): string {
  const ri = m.rawInput ?? {};
  const ro = m.rawOutput ?? {};
  if (m.toolKind === 'edit') {
    const oldS = typeof ri.old_string === 'string' ? ri.old_string : '';
    const newS = typeof (ri.new_string ?? ri.content) === 'string' ? (ri.new_string ?? ri.content) : '';
    const minus = oldS ? oldS.split('\n').map((l: string) => '- ' + l).join('\n') : '';
    const plus = newS ? newS.split('\n').map((l: string) => '+ ' + l).join('\n') : '';
    const diff = [minus, plus].filter(Boolean).join('\n');
    if (diff) return diff;
  }
  let out = '';
  if (typeof ro.output === 'string') out = ro.output;
  else {
    if (typeof ro.stdout === 'string') out += ro.stdout;
    if (typeof ro.stderr === 'string' && ro.stderr) out += (out ? '\n' : '') + ro.stderr;
  }
  if (!out && Array.isArray(m.content) && m.content[0]?.content?.text) out = String(m.content[0].content.text);
  if (!out && typeof m.content === 'string') out = m.content;
  if (m.toolKind === 'execute') {
    const cmd = typeof ri.command === 'string' ? ri.command
      : Array.isArray(ri.command) ? ri.command[ri.command.length - 1]
      : (ri.parsed_cmd?.[0]?.cmd ?? '');
    return `$ ${cmd}\n${out || '（命令输出为空）'}`.trim();
  }
  if (out) return out;
  try { return Object.keys(ri).length ? JSON.stringify(ri, null, 2) : ''; } catch { return ''; }
}

function ToolCard({ msg, t, onCopy }: { msg: ToolMsg; t: Theme; onCopy?: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const I = Icons[toolIcon(msg.toolKind)] ?? Icons.cube;
  const running = msg.status === 'in_progress' || msg.status === 'pending';
  const failed = msg.status === 'failed';
  const action = toolAction(msg);
  const target = toolTarget(msg);
  const detail = toolDetail(msg);
  const canExpand = !running && detail.trim().length > 0;
  const isEdit = msg.toolKind === 'edit';
  const copyText = detail || [action, target].filter(Boolean).join(' ');

  return (
    <View style={{ backgroundColor: t.bg2, borderWidth: 1, borderColor: t.line, borderRadius: 13, overflow: 'hidden' }}>
      <Pressable onPress={() => { if (canExpand) setOpen((o) => !o); }} onLongPress={() => onCopy?.(copyText)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
        <View style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: t.bg4, alignItems: 'center', justifyContent: 'center' }}>
          <I size={15} color={failed ? t.red : t.acTx} sw={1.8} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: failed ? t.red : t.tx }}>{action}</Text>
          {target ? <Text numberOfLines={1} style={{ fontSize: 11.5, color: t.tx3, fontFamily: 'monospace', marginTop: 1.5 }}>{target}</Text> : null}
        </View>
        {running ? <Spinner size={15} color={t.acTx} sw={2} />
          : failed ? <Icons.alert size={15} color={t.red} sw={2} />
          : <Icons.check size={16} color={t.acTx} sw={2.4} />}
        {canExpand ? <Icons.chevron size={13} color={t.tx3} sw={2} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} /> : null}
      </Pressable>
      {open && canExpand ? (
        <View style={{ borderTopWidth: 1, borderColor: t.line, backgroundColor: t.termBg }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12 }}>
            <View>
              {detail.split('\n').slice(0, 200).map((line, i) => {
                const color = isEdit && line.startsWith('+') ? '#3fb950'
                  : isEdit && line.startsWith('-') ? '#f85149'
                  : t.termTx;
                return <Text key={i} style={{ fontFamily: 'monospace', fontSize: 11.5, lineHeight: 17, color }}>{line || ' '}</Text>;
              })}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function StreamBlockBase({ message, canAnswer, answerSubmitState, isStreaming, onAnswer, onAskFocus, onCopy, onSaveImage }: { message: ChatMessage; canAnswer?: boolean; answerSubmitState?: AnswerSubmitState; isStreaming?: boolean; onAnswer?: (askId: string, answers: AnswerMap) => AnswerSubmitResult; onAskFocus?: (askId: string) => void; onCopy?: (text: string) => void; onSaveImage?: (url: string) => void }) {
  const t = useTheme();
  switch (message.kind) {
    case 'user': {
      const atts = message.attachments ?? [];
      return (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => Keyboard.dismiss()} onLongPress={() => onCopy?.(message.text)} style={{ maxWidth: '84%', backgroundColor: t.acGhost, borderWidth: 1, borderColor: t.acLine, borderRadius: 16, borderBottomRightRadius: 5, paddingHorizontal: 14, paddingVertical: 10 }}>
            {atts.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, marginBottom: message.text ? 8 : 0 }}>
                {atts.map((a, i) => {
                  const uri = resolveAssetUrl(a.url);
                  return (
                    <Pressable key={i} onPress={() => uri && onSaveImage?.(uri)}>
                      <Image source={{ uri }} resizeMode="cover" style={{ width: 116, height: 116, borderRadius: 10, backgroundColor: t.bg3 }} />
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {message.text ? <Text style={{ color: t.tx, fontSize: 14.5, lineHeight: 21 }}>{message.text}</Text> : null}
          </Pressable>
        </View>
      );
    }
    case 'agent':
      return <AgentMarkdown text={message.text} isStreaming={isStreaming} t={t} onCopy={onCopy} onSaveImage={onSaveImage} />;
    case 'thought':
      return <ThoughtBlock text={message.text} t={t} onCopy={onCopy} />;
    case 'tool':
      return <ToolCard msg={message} t={t} onCopy={onCopy} />;
    case 'error':
      return <ErrorBlock text={message.text} t={t} onCopy={onCopy} />;
    case 'system':
      return <Text style={{ color: t.tx3, fontSize: 12, textAlign: 'center', paddingHorizontal: 12 }}>{message.text}</Text>;
    case 'ask':
      return <AskBlock askId={message.askId} status={message.status} questions={message.questions} canAnswer={!!canAnswer && message.status === 'pending'} answerSubmitState={answerSubmitState} onAnswer={onAnswer} onCustomFocus={onAskFocus} t={t} />;
    default:
      return null;
  }
}

// 按内容比较：流式更新时消息数组会整体重建，只有真正变化的消息（通常是最后一条）才重渲染，
// 其余 Markdown 块不再反复解析/测量 —— 避免列表中间空白与高度跳动。
type MsgCmp = { id?: string; kind?: string; text?: string; title?: string; status?: string; questions?: unknown };
export const StreamBlock = React.memo(StreamBlockBase, (a, b) => {
  const m = a.message as MsgCmp;
  const n = b.message as MsgCmp;
  if (m.kind === 'ask' && (a.canAnswer !== b.canAnswer || a.answerSubmitState !== b.answerSubmitState || a.onAnswer !== b.onAnswer || a.onAskFocus !== b.onAskFocus)) return false;
  if (m.kind === 'agent' && a.isStreaming !== b.isStreaming) return false;
  if (a.onCopy !== b.onCopy || a.onSaveImage !== b.onSaveImage) return false;
  return (
    m.id === n.id &&
    m.kind === n.kind &&
    m.text === n.text &&
    m.title === n.title &&
    m.status === n.status &&
    m.questions === n.questions
  );
});

function AskBlock({ askId, status, questions, canAnswer, answerSubmitState, onAnswer, onCustomFocus, t }: { askId: string; status: string; questions: AskQuestion[]; canAnswer: boolean; answerSubmitState?: AnswerSubmitState; onAnswer?: (askId: string, answers: AnswerMap) => AnswerSubmitResult; onCustomFocus?: (askId: string) => void; t: Theme }) {
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});
  const [submitState, setSubmitState] = useState<'idle' | AnswerSubmitState>('idle');

  // 初始状态本就是空的，只在 askId 真正变化（组件被复用）时重置——挂载时跳过，
  // 避免每次挂载都用新 {} 引用调度一次空更新（passive flush 内的多余调度）。
  const askIdRef = useRef(askId);
  useEffect(() => {
    if (askIdRef.current === askId) return;
    askIdRef.current = askId;
    setSelected({});
    setCustomAnswers({});
    setSubmitState('idle');
  }, [askId]);

  useEffect(() => {
    if (answerSubmitState) setSubmitState(answerSubmitState);
  }, [answerSubmitState, askId]);

  const toggle = (qi: number, label: string, multi: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      const set = new Set(next[qi] ?? []);
      if (multi) {
        if (set.has(label)) set.delete(label);
        else set.add(label);
      }
      else { set.clear(); set.add(label); }
      next[qi] = set;
      return next;
    });
  };

  const submit = () => {
    if (!onAnswer) return;
    const answers = buildAskAnswers(questions, selected, customAnswers);
    if (!answers) return;
    const result = onAnswer(askId, answers);
    if (result !== 'rejected') setSubmitState(result);
  };

  const interactive = canAnswer && submitState === 'idle';
  const answered = status === 'completed';
  const expired = status === 'expired' || status === 'failed';
  const statusLabel = answered ? '已回答' : expired ? '问题已过期' : null;
  const canSubmit = interactive && buildAskAnswers(questions, selected, customAnswers) !== null;

  return (
    <View style={{ backgroundColor: t.bg2, borderWidth: 1, borderColor: expired ? t.line : t.acLine, borderRadius: 13, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {expired ? <Icons.alert size={15} color={t.tx3} sw={1.8} /> : <Icons.sparkle size={15} color={t.acTx} sw={1.8} />}
        <Text style={{ color: expired ? t.tx3 : t.acTx, fontSize: 13.5, fontWeight: '700', flex: 1 }}>AI 提问</Text>
        {statusLabel ? <Text style={{ color: t.tx3, fontSize: 11.5 }}>{statusLabel}</Text> : null}
      </View>
      {questions.map((q, qi) => (
        <View key={qi} style={{ gap: 4 }}>
          {q.header ? <Text style={{ color: t.tx3, fontSize: 11.5, fontWeight: '600' }}>{q.header}</Text> : null}
          <Text style={{ color: t.tx, fontSize: 13.5, lineHeight: 20 }}>{q.question}</Text>
          <View style={{ gap: 6, marginTop: 4 }}>
            {q.options.map((opt) => {
              const isSel = answered
                ? Array.isArray(q.answer) ? q.answer.includes(opt.label) : q.answer === opt.label
                : (selected[qi]?.has(opt.label) ?? false);
              return (
                <Pressable key={opt.label} disabled={!interactive} onPress={() => toggle(qi, opt.label, q.multiSelect)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: isSel ? t.ac : t.line, backgroundColor: isSel ? t.acGhost : 'transparent', borderRadius: 11, paddingHorizontal: 11, paddingVertical: 10 }}>
                  {q.multiSelect
                    ? <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: isSel ? t.ac : t.line2, backgroundColor: isSel ? t.ac : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{isSel ? <Icons.check size={12} color={t.acInk} sw={3} /> : null}</View>
                    : <View style={{ width: 18, height: 18, borderRadius: 99, borderWidth: 1.5, borderColor: isSel ? t.ac : t.line2, alignItems: 'center', justifyContent: 'center' }}>{isSel ? <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: t.ac }} /> : null}</View>}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: isSel ? t.tx : t.tx2, fontSize: 13.5, fontWeight: isSel ? '600' : '400' }}>{opt.label}</Text>
                    {opt.description ? <Text style={{ color: t.tx3, fontSize: 11.5, marginTop: 2 }}>{opt.description}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
            {(() => {
              const optionLabels = new Set(q.options.map((opt) => opt.label));
              const recordedAnswers = Array.isArray(q.answer) ? q.answer : q.answer ? [q.answer] : [];
              const recordedCustom = recordedAnswers.find((answer) => !optionLabels.has(answer));
              const customSelected = answered ? !!recordedCustom : (selected[qi]?.has(CUSTOM_ANSWER_KEY) ?? false);
              if (!interactive && !recordedCustom) return null;
              return (
                <View style={{ gap: 6 }}>
                  <Pressable disabled={!interactive} onPress={() => toggle(qi, CUSTOM_ANSWER_KEY, q.multiSelect)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: customSelected ? t.ac : t.line, backgroundColor: customSelected ? t.acGhost : 'transparent', borderRadius: 11, paddingHorizontal: 11, paddingVertical: 10 }}>
                    {q.multiSelect
                      ? <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: customSelected ? t.ac : t.line2, backgroundColor: customSelected ? t.ac : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{customSelected ? <Icons.check size={12} color={t.acInk} sw={3} /> : null}</View>
                      : <View style={{ width: 18, height: 18, borderRadius: 99, borderWidth: 1.5, borderColor: customSelected ? t.ac : t.line2, alignItems: 'center', justifyContent: 'center' }}>{customSelected ? <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: t.ac }} /> : null}</View>}
                    <Text style={{ flex: 1, color: customSelected ? t.tx : t.tx2, fontSize: 13.5, fontWeight: customSelected ? '600' : '400' }}>其他</Text>
                  </Pressable>
                  {interactive && customSelected ? (
                    <TextInput
                      value={customAnswers[qi] ?? ''}
                      onChangeText={(value) => setCustomAnswers((prev) => ({ ...prev, [qi]: value }))}
                      placeholder="请输入回答"
                      placeholderTextColor={t.tx3}
                      autoFocus
                      // 键盘弹出会遮住列表下部：聚焦后由外层把整张提问卡滚回键盘上方
                      onFocus={() => onCustomFocus?.(askId)}
                      style={{ minHeight: 42, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, color: t.tx, fontSize: 13.5 }}
                    />
                  ) : recordedCustom ? (
                    <Text style={{ color: t.tx2, fontSize: 12.5, lineHeight: 18, paddingHorizontal: 4 }}>{recordedCustom}</Text>
                  ) : null}
                </View>
              );
            })()}
          </View>
        </View>
      ))}
      {interactive ? (
        <Pressable disabled={!canSubmit} onPress={submit} style={{ backgroundColor: t.ac, borderRadius: 12, paddingVertical: 11, alignItems: 'center', marginTop: 2, opacity: canSubmit ? 1 : 0.45 }}>
          <Text style={{ color: t.acInk, fontSize: 14, fontWeight: '700' }}>提交回答</Text>
        </Pressable>
      ) : expired ? (
        <Text style={{ color: t.tx3, fontSize: 11.5, fontStyle: 'italic' }}>问题已过期（可在下方直接输入消息）</Text>
      ) : !answered && submitState === 'queued' ? (
        <Text style={{ color: t.amber, fontSize: 11.5 }}>网络恢复后将自动发送回答</Text>
      ) : !answered && submitState === 'sent' ? (
        <Text style={{ color: t.tx3, fontSize: 11.5 }}>回答已发送，等待处理</Text>
      ) : !answered && status !== 'pending' ? (
        <Text style={{ color: t.tx3, fontSize: 11.5, fontStyle: 'italic' }}>该提问已失效（可在下方直接输入消息）</Text>
      ) : null}
    </View>
  );
}
