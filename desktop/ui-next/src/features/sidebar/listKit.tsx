// 侧栏列表共用件:本地/对话/云端三列表同一套呈现与交互(用户定案
// 2026-08-05「统一风格和交互,不要做两套」;后续三空间会并入同一 tab 的
// 横向双 tab,先在组件层归一)。形态语汇 = LAYOUT.md §6.1/§6.2:
// - ListRow 安静行:单行主文案顶行首截断 + 行尾要紧态状态点(点替代
//   文字词,词进 title/aria);右键 = 行菜单。行首身份图标槽已撤(用户
//   定案 2026-08-06:侧栏行宽本就紧,图标占掉 20px 不值——身份由空间
//   tab 表达,行内不再重复)。
// - 组头/小节头图标保留(Folder/History/Archive):组级标签要锚点,
//   且一组只出一次不吃行宽。
// - GroupLabel 区块标签:组头 12px 图标 + text-xs font-medium /50(比行
//   小一档;行 14px 后从 11px 提到 12px,免得差距拉到 3px 显得过小),
//   放进 summary(flex 覆写、after:hidden 去尾箭头)。
// - SectionFold 小节折叠:Archive 形小节头(10px 图标行首、无计数),
//   开合走 prefs 契约键持久化,收起即卸载(部分 webview 里 details 收起
//   后嵌套 ul 残留占位空间)。
import { IconArchive, type TablerIcon } from "@tabler/icons-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import { openMenu, type MenuItem } from "@/lib/contextMenu";
import { t } from "@/lib/i18n";
import type { TokenUsage } from "@/lib/ipc/usageStats";
import { pushEscLayer } from "@/lib/util/escLayer";
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
 * 压窄错位):基准 item padding 12px,每级 +12px(= 组头图标宽)。
 * pad 与 bar 必须成对改:bar = 该级文字左缘 - 8px,拆开写迟早对不齐。 */
const LEVELS = [
  { pad: "", bar: "before:start-1" }, //      L0 文字 12px(chat 平铺行)
  { pad: "ps-6", bar: "before:start-4" }, //  L1 文字 24px(项目内任务行)
  { pad: "ps-9", bar: "before:start-7" }, //  L2 文字 36px(项目内归档行)
  { pad: "ps-12", bar: "before:start-10" }, // L3 文字 48px(归档项目内的归档行)
] as const;

/** 缩进级 → 行内起始 padding 类(给非 ListRow 的同列元素对齐用,如改名输入框)。 */
export function levelPad(level = 0): string {
  return (LEVELS[level] ?? LEVELS[0]).pad;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

/** 紧凑数字:12.3k / 1.2M(行宽紧,徽标只放得下短格式) */
export const fmtCompact = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
};

let tokenPopCleanup: (() => void) | null = null;

function closeTokenPop() {
  tokenPopCleanup?.();
}

/** 行尾 token 用量弹窗:命令式 fixed 定位(行容器 overflow-hidden 会裁
 * 掉普通 dropdown,与 openMenu 同一套机制)。点击徽标弹出,点外部/Esc 关。 */
export function showTokenPopover(pos: { x: number; y: number }, usage: TokenUsage) {
  closeTokenPop();
  const backdrop = document.createElement("div");
  backdrop.className = "fixed inset-0 z-40";
  const box = document.createElement("div");
  box.className = "fixed z-50 w-60 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg";

  const title = document.createElement("div");
  title.className = "mb-1.5 text-xs font-semibold";
  title.textContent = t("sidebar.row.tokens");
  box.appendChild(title);

  const summary = document.createElement("div");
  summary.className = "mb-2 text-[11px] text-base-content/70";
  summary.textContent = `${t("stats.input")} ${fmt(usage.input)} · ${t("stats.output")} ${fmt(usage.output)} · ${t("stats.calls")} ${fmt(usage.calls)}`;
  box.appendChild(summary);

  if (usage.models.length > 0) {
    const sep = document.createElement("div");
    sep.className = "border-t border-base-300 pt-1.5";
    const head = document.createElement("div");
    head.className = "mb-0.5 text-[10px] text-base-content/50";
    head.textContent = t("stats.byModel");
    sep.appendChild(head);
    for (const m of usage.models) {
      const row = document.createElement("div");
      row.className = "flex items-center justify-between gap-2 text-[11px]";
      const name = document.createElement("span");
      name.className = "min-w-0 truncate font-mono text-base-content/70";
      name.textContent = m.model;
      const val = document.createElement("span");
      val.className = "shrink-0 tabular-nums text-base-content/60";
      val.textContent = fmt(m.input_tokens + m.output_tokens);
      row.append(name, val);
      sep.appendChild(row);
    }
    box.appendChild(sep);
  }

  backdrop.addEventListener("mousedown", closeTokenPop);
  backdrop.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    closeTokenPop();
  });
  const popEsc = pushEscLayer(() => {
    closeTokenPop();
    return true;
  });
  window.addEventListener("resize", closeTokenPop);
  window.addEventListener("blur", closeTokenPop);
  tokenPopCleanup = () => {
    tokenPopCleanup = null;
    popEsc();
    window.removeEventListener("resize", closeTokenPop);
    window.removeEventListener("blur", closeTokenPop);
    backdrop.remove();
    box.remove();
  };
  document.body.append(backdrop, box);
  const rect = box.getBoundingClientRect();
  box.style.left = `${Math.max(0, Math.min(pos.x, window.innerWidth - rect.width - 8))}px`;
  box.style.top = `${Math.max(0, Math.min(pos.y, window.innerHeight - rect.height - 8))}px`;
}

/** 列表行(menu 的 li>a 载体)。 */
export function ListRow({
  primary,
  trailing,
  usage,
  tooltip,
  level = 0,
  active,
  archived,
  attention,
  onSelect,
  menuItems,
}: {
  primary: string;
  /** 行尾状态点:仅要紧态给(tone = 纯 status-* 语义色);状态词不上行
   * (用户定案 2026-08-05「文字换状态图标」),进点的 title/aria-label。
   * pulse = 进行中的活态(运行中/等待确认),渲染成「实心点 + 扩散环」 */
  trailing?: { tone: string; label: string; pulse?: boolean } | null;
  /** 该会话的 token 用量(>0 才显示行尾徽标;点击弹明细)。 */
  usage?: TokenUsage | null;
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
}) {
  const lv = LEVELS[level] ?? LEVELS[0];
  return (
    <li>
      <a
        className={`relative flex min-w-0 items-center gap-2 overflow-hidden transition-colors duration-150 ${lv.pad} ${active ? "menu-active" : ""}${attention ? ` ${ATTENTION_BAR} ${lv.bar}` : ""}`}
        data-attention={attention ? "" : undefined}
        title={tooltip}
        onClick={onSelect}
        onContextMenu={(e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu({ x: e.clientX, y: e.clientY }, menuItems);
        }}
      >
        {/* 活跃行走正文色(不覆写);归档降到 /55,选中态不降——选中就该看清 */}
        <span className={`min-w-0 flex-1 truncate ${archived && !active ? "text-base-content/55" : ""}`}>{primary}</span>
        {/* token 用量徽标:紧凑总数,点击弹明细(命令式弹窗,见 showTokenPopover) */}
        {usage && usage.input + usage.output > 0 && (
          <button
            type="button"
            className="shrink-0 rounded bg-base-200/70 px-1 font-mono text-[10px] leading-4 text-base-content/55 hover:text-base-content"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              showTokenPopover({ x: e.clientX, y: e.clientY }, usage);
            }}
          >
            {fmtCompact(usage.input + usage.output)}
          </button>
        )}
        {trailing && <StatusDot {...trailing} />}
      </a>
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

/** 区块标签(组头 summary 内容):图标裸放 flex 行(12px 图标不需要定宽
 * 槽,多包一层反而竖向对不齐),名称保留原大小写。
 *
 * 组头保持**安静的小标签**(用户定案 2026-08-04,2026-08-07 复核后维持):
 * 期间试过按旧 UI 换成「与行同字号 + font-semibold + 满色」的锚点形态
 * ——旧 UI 正是靠组头比行更重来表达从属——但用户定案回退,组头继续小一档、
 * 淡一档。层级改由缩进承担(§6.2)。**别再提锚点形态。** */
export function GroupLabel({ icon: Icon, name }: { icon: TablerIcon; name: string }) {
  return (
    <>
      <Icon size={12} stroke={1.75} className="shrink-0 text-base-content/40" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-base-content/50">{name}</span>
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
        <summary className="flex items-center gap-2 text-xs text-base-content/50 after:hidden">
          <Icon size={10} stroke={1.75} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </summary>
        {/* 收起即卸载:防 details 收起后嵌套 ul 残留占位空间 */}
        {isOpen && <ul className={`ms-0 min-w-0 ps-0 pb-1.5 ${NEST_NO_GUIDE}`}>{children}</ul>}
      </details>
    </li>
  );
}
