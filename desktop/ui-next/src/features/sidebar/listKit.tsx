// 侧栏列表共用件:本地/对话/云端三列表同一套呈现与交互(用户定案
// 2026-08-05「统一风格和交互,不要做两套」;后续三空间会并入同一 tab 的
// 横向双 tab,先在组件层归一)。形态语汇 = LAYOUT.md §6.1/§6.2:
// - ListRow 安静行:单行主文案顶行首截断 + 行尾要紧态状态点(点替代
//   文字词,词进 title/aria);右键 = 行菜单。行首身份图标槽已撤(用户
//   定案 2026-08-06:侧栏行宽本就紧,图标占掉 20px 不值——身份由空间
//   tab 表达,行内不再重复)。
// - 组头/小节头图标保留(Folder/History/Archive):组级标签要锚点,
//   且一组只出一次不吃行宽。
// - GroupLabel 区块标签:组头 12px 图标 + 与行同档 14px 文字(font-medium
//   /50 的安静形态;2026-08-16 用户定案:行回 14px 后组头字号跟进,从属
//   靠浓淡与缩进),放进 summary(flex 覆写、after:hidden 去尾箭头)。
// - SectionFold 小节折叠:Archive 形小节头(10px 图标行首、无计数),
//   开合走 prefs 契约键持久化,收起即卸载(部分 webview 里 details 收起
//   后嵌套 ul 残留占位空间)。
import { IconArchive, IconChevronDown, IconPlus, type TablerIcon } from "@tabler/icons-react";
import { useState, type DragEvent, type MouseEvent, type ReactNode } from "react";

import { openMenu, type MenuItem } from "@/lib/contextMenu";
import { readFold, writeFold, type FoldKey } from "@/lib/util/prefs";

// 嵌套 ul 的缩进引导竖线:**已撤**(用户定案 2026-08-10「本地会话项目列表的
// 竖线都去掉,包括 archive 的列表」;三列表同取此件,云端/对话一并去,§6.2
// 「不做两套」)。层级只剩缩进 + 组头小标签。
//
// 这条类串不是「什么都不做」,别当冗余删掉:竖线本体是 **daisyUI 自带的**
// `.menu :where(li ul,li menu):before`(menu.css,`opacity:.1` 的 1px 淡线),
// 只要嵌套 ul 待在 `.menu` 里它就恒在——早前的 GUIDE_L1/L2 也只是给它改了
// 颜色/宽度/位置,并非自己画的线。所以「去掉竖线」= 显式关掉那个伪元素,
// 类串一摘反而会退回 daisyUI 的默认线(位置还在 ul 左缘,更难看)。
export const NEST_NO_GUIDE = "before:hidden";

// 「这行在等你处理」的行标记:**行首 2px 警示条**,不是整行淡底。
//
// 为什么不能是淡底(2026-08-10 用户报障「有点分不清哪个是选中的」):
// 选中态是 `menu-active` → primary 12% 混进 base-100 的整行淡填充,而 attention
// 原本是 `bg-warning/10` 的整行淡填充——**两种语义共用同一个视觉通道,只靠
// 色相区分**。而在列表里「哪一行被填充了」本身就读作「这行是选中的」,于是
// 屏幕上同时出现两个填充行,选中的那个就淹了。色相拉得再开也治不了:问题在
// 通道重叠,不在颜色不够远。
// 改成边缘条之后分工是干净的:**填充只表示选中(只此一义)**,边缘条表示
// 「这行在等你」,两者可叠加(既选中又待办的行既有填充也有条),互不打架。
// 主流树/列表组件(VS Code 资源管理器、JetBrains、邮件客户端)都是这个分工。
//
// 绝对定位不参与布局(§6.2 hover 显隐铁律同理:标记出现/消失不许挤动行内容);
// inset-y-1 让条子上下各缩 4px,不顶满行高,免得连成一根通栏竖线。
//
// x 位置**跟着本行缩进走**,不钉在行左缘(用户报障 2026-08-10「最左侧的提醒条
// 是不是太靠左了,感觉很奇怪」):初版钉 `start-0` 是想让各层级的待办行对齐在
// 同一条 x 上、一眼数得清。但同日引导竖线撤掉后,x=0 那一列**空无一物**——条子
// 比项目组头的 Folder 图标(12px)还靠左,孤悬在整个内容列之外,读起来不像
// 「这一行的标记」,倒像贴在侧栏边框上的一道杂线。现在落在**本行文字左缘 - 8px**
// (条宽 2px,留 6px 呼吸),正是引导竖线原先占的那条沟。
// 代价是跨层级不再严格同 x;层级本就只有两三级、每级只差 12px,扫下来照样成列。
// 行尾的 warning 脉动点照旧(§6.1 状态点)。
const ATTENTION_BAR =
  "before:absolute before:inset-y-1 before:w-0.5 before:rounded-full before:bg-warning before:content-['']";

/** 行缩进阶梯(§6.2「缩进进行内、行底满宽」——嵌套 margin 会把 hover/选中底
 * 压窄错位):基准 item padding 12px,**每级 +20px**(= 头部图标 12 +
 * gap-2 8)。这样每级**行文字与其父头文字同线**:组头文字 = 12+20 = 32 =
 * L1 行;组内小节头文字 = 32+20 = 52 = L2 行。2026-08-18 用户报障「好几条
 * 对齐线,好乱」定案——旧阶梯 +12/头文字 +20 双增量并存,32/40、44/50
 * 两对"差一点对齐"的近失误全并进 20px 网格(小节头 10px 图标要坐 12px
 * 定宽槽,增量才恒 20)。
 * pad 与 bar 必须成对改:bar = 该级文字左缘 - 8px,拆开写迟早对不齐。 */
const LEVELS = [
  { pad: "", bar: "before:start-1" }, //       L0 文字 12px(平铺行)
  { pad: "ps-8", bar: "before:start-6" }, //   L1 文字 32px = 组头文字线
  { pad: "ps-13", bar: "before:start-11" }, // L2 文字 52px = 组内小节头文字线
  { pad: "ps-18", bar: "before:start-16" }, // L3 文字 72px
] as const;

/** 缩进级 → 行内起始 padding 类(给非 ListRow 的同列元素对齐用,如改名输入框)。 */
export function levelPad(level = 0): string {
  return (LEVELS[level] ?? LEVELS[0]).pad;
}

/** 列表行(menu 的 li>button 载体)。 */
export function ListRow({
  primary,
  trailing,
  tooltip,
  level = 0,
  active,
  archived,
  attention,
  onSelect,
  menuItems,
  onDragStart,
  dataId,
}: {
  primary: string;
  /** 行尾状态点:仅要紧态给(tone = 纯 status-* 语义色);状态词不上行
   * (用户定案 2026-08-05「文字换状态图标」),进点的 title/aria-label。
   * pulse = 进行中的活态(运行中/等待确认),渲染成「实心点 + 扩散环」 */
  trailing?: { tone: string; label: string; pulse?: boolean } | null;
  tooltip: string;
  /** 缩进级(见 LEVELS):0 = 平铺行,1 = 项目内任务行,依此类推 */
  level?: number;
  active?: boolean;
  /** 已归档:主文案降到 /55(旧 UI `--t4` 同档)——归档区的行还用正文色,
   *  在列表里和活跃任务一样抢眼(2026-08-07 用户报障「已归档的任务标题
   *  怎么还是黑色的」)。选中态不降,选中就该看清 */
  archived?: boolean;
  /** 后台提醒未读(D3):行首警示条(见 ATTENTION_BAR——**不占用「填充」
   *  这个通道**,那是选中态的唯一表达) */
  attention?: boolean;
  onSelect: () => void;
  menuItems: MenuItem[];
  /** HTML5 拖拽透传(工作台任务列行拖进格装载;不传即不可拖)。 */
  onDragStart?: (e: DragEvent<HTMLButtonElement>) => void;
  /** 行定位锚(data-row-id;焦点格换人时任务列 scrollIntoView 用)。 */
  dataId?: string;
}) {
  const lv = LEVELS[level] ?? LEVELS[0];
  return (
    <li>
      <button
        type="button"
        className={`relative flex w-full min-w-0 items-center gap-2 overflow-hidden text-start transition-colors duration-150 ${lv.pad} ${active ? "menu-active" : ""}${attention ? ` ${ATTENTION_BAR} ${lv.bar}` : ""}`}
        data-attention={attention ? "" : undefined}
        data-row-id={dataId}
        title={tooltip}
        draggable={onDragStart ? true : undefined}
        onDragStart={onDragStart}
        onClick={onSelect}
        onContextMenu={(e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu({ x: e.clientX, y: e.clientY }, menuItems);
        }}
      >
        {/* 活跃行走正文色(不覆写);归档降到 /55,选中态不降——选中就该看清 */}
        <span className={`min-w-0 flex-1 truncate ${archived && !active ? "text-base-content/55" : ""}`}>{primary}</span>
        {trailing && <StatusDot {...trailing} />}
      </button>
    </li>
  );
}

/** 行尾状态点(会话行与待办行共用):活态 = 实心点常驻 + 外环扩散
 * (daisyUI status 的官方 ping 形态)。
 * 原先是 animate-pulse——8px 的点在 opacity 1↔0.5 之间慢慢淡进淡出,
 * 用户反馈「呼吸效果不明显」(2026-08-07)。根因不是幅度不够:pulse
 * 与「更狠的呼吸」都是**靠让点变淡来制造动效**,等于削弱信号来表达
 * 信号,随便哪一眼瞥过去都可能正赶上最淡那帧。换成 ping 后点本身
 * 恒满色(状态任何时刻都读得出),动的是环。
 * motion-safe:仅在用户没要求减弱动效时animate;减弱时环退化成与
 * 实心点重合的静态点,不影响状态可读。 */
export function StatusDot({ tone, label, pulse }: { tone: string; label: string; pulse?: boolean }) {
  return (
    <span role="img" aria-label={label} title={label} className="inline-grid shrink-0 *:[grid-area:1/1]">
      {pulse && <span aria-hidden className={`status ${tone} motion-safe:animate-ping`} />}
      <span aria-hidden className={`status ${tone}`} />
    </span>
  );
}

/** 待办/临时会话固定组共用头：数量紧跟标题，新增按钮保留占位，
 * 折叠箭头固定在最右。整行是折叠按钮，新增按钮绝对覆盖在箭头左侧，
 * 避免两个嵌套 button，也避免 hover 时挤动标题。 */
export function FixedGroupHeader({
  icon: Icon,
  name,
  count = 0,
  collapsed,
  onToggle,
  onAdd,
  addLabel,
}: {
  icon: TablerIcon;
  name: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div className="group/fixed relative flex w-full min-w-0 items-stretch p-0">
      <button
        type="button"
        className="flex min-h-8 min-w-0 flex-1 items-center gap-2 py-1.5 ps-3 pe-18 text-start"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <Icon size={12} stroke={1.75} className="shrink-0 text-base-content/40" aria-hidden />
        <span className="min-w-0 truncate font-medium text-base-content/50">{name}</span>
        {count > 0 && <span className="badge badge-ghost badge-xs shrink-0 tabular-nums">{count}</span>}
        <span className="min-w-0 flex-1" />
        <IconChevronDown
          size={12}
          stroke={1.75}
          aria-hidden
          className={`absolute end-2 shrink-0 text-base-content/40 transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>
      <button
        type="button"
        aria-label={addLabel}
        title={addLabel}
        className="btn btn-ghost btn-square btn-xs invisible absolute end-8 top-0 h-8 min-h-8 w-9 group-hover/fixed:visible group-focus-within/fixed:visible"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAdd();
        }}
      >
        <IconPlus size={14} stroke={1.75} aria-hidden />
      </button>
    </div>
  );
}

/** 区块标签(组头 summary 内容):图标裸放 flex 行(12px 图标不需要定宽
 * 槽,多包一层反而竖向对不齐;图标不随字号放大——缩进几何按它算),
 * 名称保留原大小写。
 *
 * 组头保持**安静形态**(淡色 /50 + font-medium,2026-08-04 定案的重量
 * 口径不变,不是锚点形态);字号与行同档 14px(2026-08-16 用户定案:
 * 列表行回 14px 后组头跟进——12px 组头挂在 14px 行上头显得过小)。
 * 从属层级由缩进与浓淡承担(§6.2)。 */
export function GroupLabel({ icon: Icon, name }: { icon: TablerIcon; name: string }) {
  return (
    <>
      <Icon size={12} stroke={1.75} className="shrink-0 text-base-content/40" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium text-base-content/50">{name}</span>
    </>
  );
}

/** 底部小节折叠(已归档项目/已归档会话/云端历史任务):开合态走旧 UI
 * 契约键;标签不带计数(用户定案 2026-08-05)。 */
export function SectionFold({
  label,
  icon: Icon = IconArchive,
  foldKey,
  forceOpen = false,
  children,
}: {
  label: string;
  icon?: TablerIcon;
  foldKey: FoldKey;
  /** 搜索命中等场景强制展开:不写盘、不响应开合 */
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => readFold(foldKey));
  const isOpen = forceOpen || open;
  return (
    <li>
      <details
        open={isOpen}
        onToggle={(e) => {
          if (e.target !== e.currentTarget) return; // toggle 合成冒泡守卫
          if (forceOpen) return;
          const next = e.currentTarget.open;
          if (next === open) return;
          setOpen(next);
          writeFold(foldKey, next);
        }}
      >
        {/* Archive 形小节头:图标行首(与组头 Folder 同构)、去 menu 默认尾箭头 */}
        {/* 10px 图标坐 12px 定宽槽:小节头文字与子行同线(20px 网格) */}
        <summary className="flex items-center gap-2 text-xs text-base-content/50 after:hidden">
          <span className="inline-flex w-3 shrink-0 justify-center">
            <Icon size={10} stroke={1.75} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </summary>
        {/* 收起即卸载:防 details 收起后嵌套 ul 残留占位空间 */}
        {isOpen && <ul className={`ms-0 min-w-0 ps-0 pb-1.5 ${NEST_NO_GUIDE}`}>{children}</ul>}
      </details>
    </li>
  );
}
