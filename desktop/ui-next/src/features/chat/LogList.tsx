// 消息流条目分发:协议 items 先投影成真正有视觉盒的稳定 DisplayRow，再由
// 动态高度窗口只挂载视口附近的行。加载更早时 keyBase 保证既有 row key 不变；
// 锚定审批、合并模型行和折叠工具成员不再制造 display:none 占位节点。
//
// 性能契约(2026-08-10 用户报障「长会话非常卡」):流式期间壳每 ~30ms 推一批
// 帧,state 整体换新——LogList 自身的 memo 只挡得住 composer 打字,挡不住
// 帧批。行级组件(Row / GroupHead)必须 memo,且依赖两条前提:
// - 归约层的条目**identity 稳定**(reduce.ts 只换被触碰的那个对象,见
//   appendStream/mergeToolInState 的 slice+单点覆写),未变的行按引用比对
//   直接跳过——每批帧只重渲染流式尾部那一两行;
// - 传给行的回调必须是稳定引用(ChatView 侧 useCallback,见彼处注释)。
// O(n) 的投影(join/分组/锚定表)只允许出现在结构变化；token 流式快路复用
// 布局骨架。逐条目的昂贵计算(presentToolCall、splitAttachments、markdown)
// 一律待在行组件内，靠 memo 只在该行变化时才跑。
import { IconArrowsMinimize, IconChevronRight, IconFile as FileIcon, IconSparkles } from "@tabler/icons-react";
import { forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";

import { Markdown, MarkdownInline } from "@/components/markdown/Markdown";
import { downloadUpload, Lightbox, UploadImg } from "@/components/media/UploadImg";
import { useI18n } from "@/lib/i18n";
import type { FrameSender } from "@/lib/ipc/approvals";
import { openExternal } from "@/lib/ipc/host";
import { isImagePath } from "@/lib/ipc/uploads";
import { splitAttachments } from "@/lib/protocol/attLine";
import { THINK_KEY } from "@/lib/protocol/reduce";
import type { ChatItem, ChatState, Frame, PermItem } from "@/lib/protocol/types";
import { presentToolCall } from "@/lib/tools/toolLabels";
import { thoughtLiveSummary, thoughtMarkdown, thoughtSummary } from "@/lib/util/thoughtMarkdown";
import { AskCard } from "./cards/AskCard";
import { PermCard } from "./cards/PermCard";
import { statusDot } from "./cards/statusDot";
import { ToolCard } from "./cards/ToolCard";
import { MessageTime } from "./MessageTime";
import { useTimelineProjection } from "./timeline/useTimelineProjection";
import { useTimelineWindow } from "./timeline/useTimelineWindow";

/** 用户气泡:正文 + 附件呈现(旧 UI logView 的信息布局)。附件两个来源互斥:
 * 本地会话走正文附件行约定(uploadUrl 回读工作区,点图看大图/点文件下载),
 * 云端任务走 attachments 字段(对象存储直链;文件 chip 点击在浏览器打开)。
 * 附件行只在有回读通道时剥离——无通道剥了就没法呈现,正文原样兜底。 */
function UserBubble({
  item,
  flash,
  uploadUrl,
}: {
  item: Extract<ChatItem, { kind: "user" }>;
  flash?: boolean;
  uploadUrl?: (path: string) => Promise<string>;
}) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState<string | null>(null); // 本地图:工作区相对路径
  const [zoomUrl, setZoomUrl] = useState<string | null>(null); // 云端图:直链
  const { body, images, files } = uploadUrl
    ? splitAttachments(item.text)
    : { body: item.text, images: [] as string[], files: [] as string[] };
  // 归约层对缺名附件留空串(不产成品文案),展示名在这儿兜底
  const attName = (a: { filename: string }) => a.filename || t("common.unnamedFile");
  const atts = item.attachments ?? [];
  const cloudImages = atts.filter((a) => isImagePath(a.filename));
  const cloudFiles = atts.filter((a) => !isImagePath(a.filename));
  const hasAtts = images.length + files.length + cloudImages.length + cloudFiles.length > 0;
  const thumb = "block max-h-28 max-w-36 cursor-zoom-in rounded-box";
  return (
    <div
      className={`group chat chat-end relative rounded-box ${flash ? "animate-[mc-flash_1s_ease]" : ""}`}
      data-user-seq={item.seq}
    >
      {/* 时间绝对定位在块顶空隙里(§6.2 允许的另一形态):不占流式高度,
          消息节奏不因时间线变松 */}
      <MessageTime timestamp={item.timestamp} className="absolute -top-3.5 end-1" />
      {/* 用户消息 = primary 淡染(10%,与菜单选中态同语言):实色 primary 太
          鲜艳(用户报障 2026-08-06),默认 base-300 又太淡,取中间档;文字保持
          正文色。wrap-anywhere:长串无空格内容(URL/路径/token)必须可断,
          否则从气泡右缘溢出(bubble 尾巴 background inherit,淡染一体生效) */}
      <div className="chat-bubble max-w-[85%] bg-primary/10 text-sm whitespace-pre-wrap wrap-anywhere select-text">
        {body}
        {hasAtts && (
          <div className={`flex flex-wrap items-center gap-1.5 ${body ? "mt-2" : ""}`}>
            {cloudImages.map((a) => (
              <img key={a.url} src={a.url} alt={attName(a)} title={attName(a)} className={thumb} onClick={() => setZoomUrl(a.url)} />
            ))}
            {cloudFiles.map((a) => (
              <button
                key={a.url}
                type="button"
                className="btn btn-ghost btn-xs max-w-56"
                title={t("chat.att.openTip", { name: attName(a) })}
                onClick={() => openExternal(a.url)}
              >
                <FileIcon size={12} stroke={1.75} aria-hidden className="shrink-0" />
                <span className="min-w-0 truncate">{attName(a)}</span>
              </button>
            ))}
            {images.map((p) => (
              <UploadImg key={p} load={() => uploadUrl!(p)} alt={p} title={p} className={thumb} onClick={() => setZoom(p)} />
            ))}
            {files.map((p) => (
              <button
                key={p}
                type="button"
                className="btn btn-ghost btn-xs max-w-56"
                title={t("chat.att.downloadTip", { name: p })}
                onClick={() => downloadUpload(() => uploadUrl!(p), p.split("/").pop() || p)}
              >
                <FileIcon size={12} stroke={1.75} aria-hidden className="shrink-0" />
                <span className="min-w-0 truncate">{p.split("/").pop() || p}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {zoom && uploadUrl && (
        <Lightbox alt={zoom} onClose={() => setZoom(null)}>
          <UploadImg load={() => uploadUrl(zoom)} alt={zoom} className="max-h-[84vh] max-w-full" />
        </Lightbox>
      )}
      {zoomUrl && (
        <Lightbox alt={zoomUrl} onClose={() => setZoomUrl(null)}>
          <img src={zoomUrl} alt={zoomUrl} className="max-h-[84vh] max-w-full" />
        </Lightbox>
      )}
    </div>
  );
}

function ThoughtBlock({ item, streaming }: { item: Extract<ChatItem, { kind: "thought" }>; streaming?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // 折叠流式态只处理固定大小的最新尾窗：头部随当前进度更新，且不会每
  // 30ms 为不可见正文重解析整段 Markdown。用户展开后才物化完整内容；
  // 流结束则回到稳定的首行摘要，历史记录仍保持原来的阅读语义。
  const summary = streaming
    ? thoughtLiveSummary(item.text)
    : thoughtSummary(thoughtMarkdown(item.text));
  const md = open ? thoughtMarkdown(item.text) : "";
  return (
    // 思考块走官方 collapse 形态(native details);展开指示与工具卡统一为
    // 行尾 ChevronRight(open 态转 90°,弃 collapse-arrow 的另一套箭头语言,
    // 用户定案 2026-08-05);时间与其他块一致 hover 显影(group 在 details 上)
    <details
      className="group collapse border border-base-300 bg-base-200"
      data-thought-streaming={streaming ? "true" : undefined}
      aria-busy={streaming || undefined}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      {/* ps-2.5 是对齐算出来的,不是随手取的:daisyUI .collapse-title 自带
          padding:1rem,只覆 py/pe 会留下 16px 的左内距,而工具卡/组头是 px-3
          (12px)+ 8px 状态点 → 点心在 16px。这里 12px 的 IconSparkles 要让图标中心
          也落 16px,左内距得是 16-6=10px;文字起点随之 10+12+gap-1.5 = 28px,
          与工具行的 12+8+gap-2 = 28px 齐平(用户报障 2026-08-06:两种行首图标错位) */}
      <summary className="collapse-title flex min-h-0 items-center gap-1.5 py-2 ps-2.5 pe-3 text-xs text-base-content/60">
        <IconSparkles size={12} stroke={1.75} aria-hidden className="shrink-0" />
        <span className="shrink-0">{t("chat.thought")}</span>
        {/* 摘要行走 MarkdownInline(与 FindingsCard 的发现标题同件):引擎的
            思考首行几乎都是 `**小标题**`,当纯文本贴出来就是满屏字面量星号 */}
        <MarkdownInline source={summary} className="min-w-0 flex-1 truncate opacity-70" />
        <IconChevronRight
          size={12}
          stroke={1.75}
          aria-hidden
          className="shrink-0 text-base-content/40 transition-transform group-open:rotate-90"
        />
      </summary>
      {/* 结构线走**内嵌**引用条(与 ToolCard 子代理结果同形态:border-s-2 + ps-3),
          不能挂在 collapse-content 自身:那层与卡片边缘齐平,而 daisyUI .collapse
          有 border-radius 却无 overflow 裁剪,大圆角主题(--radius-box 1rem+)下
          这条直线会戳出卡片左下的圆角轮廓,看着像块碎片。靠 collapse-content
          自带的 1rem 内距把条子推进卡内,任何圆角口径都不碰边。 */}
      <div className="collapse-content text-xs">
        <div className="border-s-2 border-base-300 ps-3">
          {open && <Markdown source={md} className="opacity-80" deferMermaid={streaming} />}
        </div>
      </div>
    </details>
  );
}

type T = ReturnType<typeof useI18n>["t"];

/** 行组件间共传的稳定引用集(memo 生效的前提,见文件头「性能契约」)。 */
interface RowShared {
  sessionId: string;
  sendFrame?: FrameSender;
  readonly?: boolean;
  onOpenChildSession?: (id: string) => void;
  uploadUrl?: (path: string) => Promise<string>;
  onLocalLink?: (path: string) => void;
  workdir?: string;
  loadFullTool?: (seq: number) => Promise<Frame>;
}

interface RenderOpts extends RowShared {
  /** 归约层只给 i18n 键,系统行文案在渲染时求值(见 sysText) */
  t: T;
  /** 本条工具卡锚定的未决审批(LogList 由 permAnchors 表解析后**按条**下发:
   *  行组件收 Map 的话表每渲染都换新,memo 就永远打不中)。 */
  perm?: PermItem;
  /** 大纲跳转命中本条(仅 user):同理按条下发,flashSeq 变化只重渲两行。 */
  flash?: boolean;
  /** 相邻工具卡共享外框(旧 tool-stack;LogList 按可见邻居计算)。 */
  joinPrev?: boolean;
  joinNext?: boolean;
  /** 当前仍在追加正文的行暂缓 Mermaid 渲染。 */
  streaming?: boolean;
}

function renderItem(item: ChatItem, o: RenderOpts) {
  switch (item.kind) {
    case "user":
      return <UserBubble item={item} flash={o.flash} uploadUrl={o.uploadUrl} />;
    case "agent":
      // 时间绝对定位在块顶空隙(悬停显影,不占流式高度)
      return (
        <div className="group relative flex flex-col">
          <MessageTime timestamp={item.timestamp} className="absolute -top-3.5 start-0" />
          <Markdown
            source={item.text}
            localImageUrl={o.uploadUrl}
            onLocalLink={o.onLocalLink}
            deferMermaid={o.streaming}
          />
        </div>
      );
    case "thought":
      // 与助手块同构:时间线在块顶空隙
      return (
        <div className="group relative flex flex-col">
          <MessageTime timestamp={item.timestamp} className="absolute -top-3.5 start-0" />
          <ThoughtBlock item={item} streaming={o.streaming} />
        </div>
      );
    case "tool":
      // 只读回放不递交锚定审批:工具卡不出内嵌按钮行,按 run/ok/fail 常态渲染。
      // 时间线只在组首(非 joinPrev)卡顶空隙——组中插时间行会撕开共享外框
      return (
        <div className="group relative flex flex-col">
          {!o.joinPrev && <MessageTime timestamp={item.timestamp} className="absolute -top-3.5 start-0" />}
          <ToolCard
            item={item}
            perm={o.readonly ? undefined : o.perm}
            sessionId={o.sessionId}
            sendFrame={o.sendFrame}
            onOpenChild={o.onOpenChildSession}
            uploadUrl={o.uploadUrl}
            onLocalLink={o.onLocalLink}
            workdir={o.workdir}
            loadFullTool={o.loadFullTool}
            joinPrev={o.joinPrev}
            joinNext={o.joinNext}
          />
        </div>
      );
    case "perm":
      return <PermCard item={item} sessionId={o.sessionId} sendFrame={o.sendFrame} readonly={o.readonly} />;
    case "ask":
      return <AskCard item={item} sessionId={o.sessionId} sendFrame={o.sendFrame} readonly={o.readonly} />;
    case "sys":
      // turn-end 收敛为 2px 呼吸位:消息天然按用户/助手交替,不再用文字
      // 切碎正文;全文留在 title 供悬停查证(旧 UI TurnDivider 同语义)
      if (item.tag === "turn-end") return <div aria-hidden title={sysText(item, o.t)} className="h-0.5" />;
      // h-auto/py/whitespace-normal 不可省:daisyUI 的 .badge 是
      // `height: var(--size)` **写死**(badge-sm = 20px),且不带 white-space
      // 也不裁切。系统行的文案长度不受控——reduce.ts 把引擎/RPC 的原始错误串、
      // 子代理 task_notification 的整句 description 原样灌进来,760px 列宽下
      // 62 个汉字就折行,折行后内容高度超出那 20px,再以 align-items:center
      // 上下对称溢出:药丸底色只盖住中间一条带,文字从上下缘探出去,看着像
      // 渲染坏了,超长时还压到相邻消息块。
      // select-text:错误文案要能复制走(body 级 user-select:none 之下,
      // 这一支祖先链上没有任何放开点;旧 UI 的白名单点名了「系统行」)。
      return (
        <div
          className={`badge badge-ghost badge-sm h-auto max-w-full gap-1 self-center py-0.5 whitespace-normal select-text ${
            item.error ? "text-error" : "text-base-content/40"
          }`}
        >
          {/* 压缩行的图标走组件而非文案字符:字符图标(旧 ⟳)在部分平台被
              渲染成彩色 emoji,与系统行的灰阶气质打架;Tabler 线条图标
              单色随文字颜色,与全 UI 同一套图标语言 */}
          {item.tag === "compact" && (
            <IconArrowsMinimize size={14} stroke={1.75} aria-hidden className="shrink-0" />
          )}
          {sysText(item, o.t)}
        </div>
      );
  }
}

/** 系统行文案:归约层只给 key(+原始参数),这里按当前 locale 求值。
 *  key 缺席 = 上游自由文本(notify 通知正文),原样渲染。
 *  think 单列一条:params 里存的是**原始档位**(low/high…),要再过一次
 *  THINK_KEY 才拿得到当前语言的档位名——直接插值会把中文档位名带进英文句子。 */
function sysText(item: Extract<ChatItem, { kind: "sys" }>, t: T): string {
  if (!item.key) return item.text;
  if (item.key === "chat.sys.think") {
    const level = item.params?.level ?? "";
    return t("chat.sys.think", { level: t(THINK_KEY[level] ?? THINK_KEY[""]!) });
  }
  return t(item.key, item.params);
}

/** 单条目行(含工具组展开后的成员行):memo 按引用比对,流式期间每批帧
 *  只有尾部那一两行的 item/join 变了,其余行整棵子树跳过(文件头「性能契约」)。
 *  i18n 经组件内 useI18n 订阅——locale 切换走 store 通知,不受 memo 拦截。 */
const Row = memo(function Row({
  item,
  perm,
  flash,
  streaming,
  joinPrev,
  joinNext,
  gap,
  ...shared
}: RowShared & {
  item: ChatItem;
  perm?: PermItem;
  flash?: boolean;
  streaming?: boolean;
  joinPrev: boolean;
  joinNext: boolean;
  /** 消息块间距(组内工具卡零距共享外框);包裹层 margin,见 LogList 注释 */
  gap: boolean;
}) {
  const { t } = useI18n();
  return (
    // 包裹 div 自身是 flex 列:系统行等条目的 self-center 才有对齐上下文
    // (包裹层是块级时 align-self 无效,居中丢失)。
    // 块间距用 padding 不用 margin:MessageTime 悬在块顶空隙(内层 -top-3.5),
    // 间距若是 margin,时间会画在虚拟行测量盒之外，ResizeObserver 记不到
    // 这段高度，累计后滚动映射会漂。padding 让时间与留白都落在行盒内。
    // 首行(gap=false 且非
    // join)给 pt-3.5 刚好容下时间行;join 行零距契约不变(不渲时间)。
    <div className={`flex flex-col ${gap ? "pt-4" : joinPrev ? "" : "pt-3.5"}`}>
      {renderItem(item, { t, perm, flash, streaming, joinPrev, joinNext, ...shared })}
    </div>
  );
});

/** 工具组组首:摘要头(状态点/失败数/开合)+ 展开时的首成员卡。
 *  摘要要对每个成员跑 presentToolCall——这正是搬出 LogList 的原因:原先它在
 *  每批帧上对**所有组的所有成员**重算一遍,长会话流式期间是主要热点之一。
 *  members 数组是父层每渲染新造的,memo 用自定义比较器逐元素比引用;比对
 *  通过则整行跳过,不通过(某成员真变了)才重算 useMemo 里的摘要。 */
const GroupHead = memo(
  function GroupHead({
    item,
    members,
    active,
    failCount,
    expanded,
    stackKey,
    onToggle,
    gap,
    joinNext,
    perm,
    ...shared
  }: RowShared & {
    item: ChatItem;
    members: readonly ChatItem[];
    active: boolean;
    failCount: number;
    expanded: boolean;
    stackKey: number;
    onToggle: (key: number, expanded: boolean) => void;
    gap: boolean;
    joinNext: boolean;
    perm?: PermItem;
  }) {
    const { t, locale } = useI18n();
    // 头部摘要:按动作词计数,保首现顺序,只列前三种
    const summary = useMemo(() => {
      const counts = new Map<string, number>();
      for (const it of members) {
        if (it.kind !== "tool") continue;
        const action = presentToolCall(it.title, it.rawInput, { locale, toolKind: it.toolKind, meta: it._meta }).action;
        counts.set(action, (counts.get(action) ?? 0) + 1);
      }
      const parts = [...counts.entries()].slice(0, 3).map(([a, c]) => (c > 1 ? `${a} ×${c}` : a));
      const more = counts.size > 3 ? " · …" : "";
      return `${t("chat.tool.groupSteps", { n: members.length })} · ${parts.join(" · ")}${more}`;
    }, [members, locale, t]);
    const tone = statusDot(active ? "run" : failCount > 0 ? "fail" : "ok");
    return (
      // 间距用 padding 不用 margin(缘由见 Row 注释)。本组件的定位父就是
      // 直接子行自身,时间戳定 top-0 落在 padding 带内,不悬出行盒
      <div className={`group relative flex flex-col ${gap ? "pt-4" : "pt-3.5"}`}>
        <MessageTime timestamp={item.kind === "tool" ? item.timestamp : undefined} className="absolute top-0 start-0" />
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={t("chat.tool.groupLabel")}
          className={`card card-border flex-row items-center gap-2 overflow-hidden bg-base-100 px-3 py-2 text-xs ${expanded ? "rounded-b-none border-b-0" : ""} cursor-pointer`}
          onClick={() => onToggle(stackKey, expanded)}
        >
          <span aria-hidden className={tone} />
          {/* 与单条工具卡的动作名同字重(都不加粗):两者在流里交替出现,
              一个粗一个不粗会读成两级信息 */}
          <span className="min-w-0 flex-1 truncate text-start">{summary}</span>
          {failCount > 0 && (
            <span className="shrink-0 text-error">{t("chat.tool.groupFailed", { n: failCount })}</span>
          )}
          <IconChevronRight
            size={12}
            stroke={1.75}
            aria-hidden
            className={`shrink-0 text-base-content/40 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </button>
        {expanded && renderItem(item, { t, perm, joinPrev: true, joinNext, ...shared })}
      </div>
    );
  },
  (prev, next) => {
    for (const k of Object.keys(next) as (keyof typeof next)[]) {
      if (k === "members") continue;
      if (!Object.is(prev[k], next[k])) return false;
    }
    return prev.members.length === next.members.length && prev.members.every((m, i) => m === next.members[i]);
  },
);

export interface LogListHandle {
  resolveKey(key: string): string | null;
  ensureKey(key: string): boolean;
  ensureRawIndex(rawIndex: number): boolean;
  ensureUserSeq(seq: number): boolean;
  activeUser(): Extract<ChatItem, { kind: "user" }> | null;
}

interface LogListProps {
  state: ChatState;
  sessionId: string;
  /** 大纲跳转的目标 user seq:命中的气泡播放一次 mc-flash 闪光。 */
  flashSeq?: number;
  /** 审批/提问答复的上行管道注入(云端任务经 stream WS 发帧);
   * 缺省 = sessionId 的本地 sender(壳侧 session_send)。 */
  sendFrame?: FrameSender;
  /** 只读回放(子代理会话浮层):审批/提问卡按已决/禁用渲染,不出交互按钮。 */
  readonly?: boolean;
  /** 子代理工具卡「查看子会话」入口(缺省不渲染入口)。 */
  onOpenChildSession?: (id: string) => void;
  /** 本地附件回读通道(路径 → data URL);缺省 = 不剥附件行、正文原样。 */
  uploadUrl?: (path: string) => Promise<string>;
  /** markdown 工作区文件链接点击代理(reveal);缺省点击无动作。 */
  onLocalLink?: (path: string) => void;
  /** 会话工作目录:工具卡 path 型目标剥绝对前缀;缺省不剥。 */
  workdir?: string;
  /** 工具卡大字段回读通道(按帧 seq 取原帧);缺省只展示截断头部。 */
  loadFullTool?: (seq: number) => Promise<Frame>;
}

const LogListSession = forwardRef<LogListHandle, LogListProps>(function LogListSession({
  state,
  sessionId,
  flashSeq,
  sendFrame,
  readonly,
  onOpenChildSession,
  uploadUrl,
  onLocalLink,
  workdir,
  loadFullTool,
}: LogListProps, ref) {
  // 长工具组折叠的展开记录(键 = 组首条目的 itemKey,keyBase 感知,前插
  // 不漂移);仅内存,切会话重挂即复位。open/closed 双集合:用户手动开合
  // 优先于「运行中默认展开、终态默认收起」的推导
  const [openGroups, setOpenGroups] = useState<Set<number>>(new Set());
  const [closedGroups, setClosedGroups] = useState<Set<number>>(new Set());
  // 稳定引用(GroupHead 是 memo,内联箭头会让开合按钮那行永远比不中)
  const toggleGroup = useCallback((stackKey: number, expanded: boolean) => {
    if (expanded) {
      setClosedGroups((prev) => new Set(prev).add(stackKey));
      setOpenGroups((prev) => {
        const next = new Set(prev);
        next.delete(stackKey);
        return next;
      });
    } else {
      setOpenGroups((prev) => new Set(prev).add(stackKey));
      setClosedGroups((prev) => {
        const next = new Set(prev);
        next.delete(stackKey);
        return next;
      });
    }
  }, []);
  const projection = useTimelineProjection(state, { openGroups, closedGroups, flashSeq });
  const rows = projection.rows;
  const rootRef = useRef<HTMLDivElement>(null);
  const virtual = useTimelineWindow(projection.layoutRows, rootRef);
  useImperativeHandle(
    ref,
    () => ({
      resolveKey: virtual.resolveKey,
      ensureKey: virtual.ensureKey,
      ensureRawIndex: virtual.ensureRawIndex,
      ensureUserSeq: virtual.ensureUserSeq,
      activeUser: virtual.activeUser,
    }),
    [virtual.resolveKey, virtual.ensureKey, virtual.ensureRawIndex, virtual.ensureUserSeq, virtual.activeUser],
  );
  // 行级稳定引用集(每个 prop 自身稳定,对象本身逐渲染新造没关系——memo
  // 比的是展开后的单个 prop)
  const shared: RowShared = { sessionId, sendFrame, readonly, onOpenChildSession, uploadUrl, onLocalLink, workdir, loadFullTool };
  return (
    <div ref={rootRef} data-chat-items="" className="flex flex-col">
      <div data-virtual-spacer="top" aria-hidden style={{ height: virtual.topHeight }} />
      {rows.slice(virtual.start, virtual.end).map((row) => (
        <div key={row.key} data-virtual-row="" data-row-key={row.key} data-raw-index={row.rawIndex} className="flex flex-col">
          {row.type === "group" ? (
            <GroupHead
              item={row.item}
              members={row.members}
              active={row.active}
              failCount={row.failCount}
              expanded={row.expanded}
              stackKey={row.stackKey}
              onToggle={toggleGroup}
              gap={row.gap}
              joinNext={row.joinNext}
              perm={row.perm}
              {...shared}
            />
          ) : (
            <Row
              item={row.item}
              perm={row.perm}
              flash={row.flash}
              streaming={row.streaming}
              joinPrev={row.joinPrev}
              joinNext={row.joinNext}
              gap={row.gap}
              {...shared}
            />
          )}
        </div>
      ))}
      <div data-virtual-spacer="bottom" aria-hidden style={{ height: virtual.bottomHeight }} />
      {state.running && (
        <span className="loading loading-dots loading-sm mt-3 text-base-content/40" aria-hidden />
      )}
    </div>
  );
});

// 同一个 ChatView 会在 sessionId 切换时复用实例；内部 key 强制重建窗口、
// 实测高度与工具组开合状态，避免相同数字 row key 把上一会话缓存带过来。
const LogListInner = forwardRef<LogListHandle, LogListProps>(function LogList(props, ref) {
  return <LogListSession key={props.sessionId} {...props} ref={ref} />;
});

export const LogList = memo(LogListInner);
