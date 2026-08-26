// composer 共用呈现件(本地 Composer 与云端 CloudComposer 一套件,参照
// sidebar/listKit 先例;LAYOUT §6.2「不做两套」同一精神):错误条 / 运行条 /
// 输入卡外框 / textarea 自适应高度 / 斜杠指令面板。类名是从 Composer 原样
// 搬迁的定稿形态(-mx-2.5 出血、ps-1/pe-2 光学对齐等口径见 Composer 内注),
// 改形态只改这里。
import { IconAlertCircle, IconPlayerStopFilled, IconX } from "@tabler/icons-react";
import { type CSSProperties, type ReactNode, type RefObject, type TextareaHTMLAttributes } from "react";

import { useI18n } from "@/lib/i18n";
import type { SlashCommand } from "@/lib/protocol/types";

/** composer 域错误条:soft 底 + 14px 语义图标 + truncate 正文 + 右端关闭;
 * -mx-2.5 与输入卡同出血,左右缘对齐。 */
export function ErrorBar({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="alert alert-error alert-soft -mx-2.5 flex items-center gap-2 px-3 py-1.5 text-xs">
      <IconAlertCircle size={14} stroke={1.75} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <button type="button" aria-label={t("chat.dismiss")} className="btn btn-ghost btn-square btn-xs" onClick={onDismiss}>
        <IconX size={14} stroke={1.75} aria-hidden />
      </button>
    </div>
  );
}

/** 运行条(输入卡内顶端,border-b 与卡体分隔):spinner + 文案 + 停止钮。 */
export function RunBar({
  label,
  detail,
  stopLabel,
  stopTitle,
  onStop,
}: {
  label: string;
  detail?: string;
  stopLabel: string;
  stopTitle?: string;
  onStop: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-base-300 px-3 py-1.5 text-xs">
      <span className="loading loading-spinner loading-xs text-primary" aria-hidden />
      <span className="font-semibold">{label}</span>
      {detail !== undefined && <span className="truncate text-base-content/40">{detail}</span>}
      <span className="flex-1" />
      <button
        type="button"
        aria-label={stopLabel}
        title={stopTitle ?? stopLabel}
        className="btn btn-ghost btn-square btn-xs text-error"
        onClick={onStop}
      >
        {/* 实心方块:空心描边在 16px 上就是个「空盒子」,既不像按钮也读不出
            「停止」(用户反馈 2026-08-07「太丑了,就是一个方块」)。实心是
            播放器停止键的通行形态,也是各家「停止生成」的既定语汇 */}
        <IconPlayerStopFilled size={15} aria-hidden />
      </button>
    </div>
  );
}

/** 上下文用量圆环(composer 集群右端的输入侧元信息)。
 * 两层同几何叠放:底层是走满一圈的轨道(radial-progress --value:100),上层
 * 才是实际用量弧。daisyUI 的 radial-progress 未填充段是**全透明**的,只画一层
 * 时低用量下看着就是「半截环/一根斜杠」,不像进度而像残缺图形——轨道给足
 * 「一整圈是满」的参照,弧长才读得出比例。
 * >85% 用功能性状态色示警(旧 ContextRing 的设计);tooltip 走紧凑口径:
 * 百分比 + fmtK 缩写(精确 token 数没有决策价值,长串数字把 tooltip 撑成
 * 一整行)。tooltip-left:圆环贴视口右缘,tooltip-top 居中弹会被窗口裁掉半截。 */
/** pct = null:本轮还没有 usage 帧。**照旧占位**,只画空轨道 + 「暂无数据,
 *  本轮请求后更新」——旧 UI 的 ContextRing 就是恒显的(chat.tsx:1203),
 *  ui-next 首版把整个圆环 gate 掉了:元素时有时无本身就是干扰,而且用户
 *  无从知道"这里本该有个东西、只是还没数据"。 */
export function UsageRing({ pct, tip, label }: { pct: number | null; tip: string; label: string }) {
  const geom = { "--size": "1rem", "--thickness": "2px" } as CSSProperties;
  return (
    <div className="tooltip tooltip-left mx-1 shrink-0" data-tip={tip}>
      {/* 同格叠放(col/row-start-1),不用 absolute:两层几何完全一致才不会错圈 */}
      <div className="grid size-4 place-items-center align-middle">
        <div
          aria-hidden={pct !== null}
          {...(pct === null ? { role: "img", "aria-label": label } : {})}
          className="radial-progress col-start-1 row-start-1 text-base-content/15"
          style={{ ...geom, "--value": 100 } as CSSProperties}
        />
        {pct !== null && (
          <div
            role="progressbar"
            aria-label={label}
            aria-valuenow={pct}
            className={`radial-progress col-start-1 row-start-1 ${pct > 85 ? "text-error" : "text-base-content/40"}`}
            style={{ ...geom, "--value": Math.min(100, pct) } as CSSProperties}
          />
        )}
      </div>
    </div>
  );
}

/** 输入卡外框:结构线 + 默认底,聚焦时边线加深并即时画 outline(焦点反馈不挂动画)。**不得**给这层卡片挂
 * daisyUI dropdown 类:daisyUI 的隐藏规则是后代选择器
 * (`.dropdown:not(...) .dropdown-content`),外层 dropdown 处于关态时会把
 * 嵌套在内的菜单一并 display:none(思考菜单弹不出来的根因,修复经历见
 * tasks/lessons.md)。
 * -mx-2.5 光学对齐(旧 UI 出血 10px 随迁):textarea 自带 ~12px 内距,
 * 硬边卡片与正文同宽会显得输入文字向右缩;向两侧出血后卡内文字左缘与
 * 对话文字几乎重合,卡片略宽于正文列。 */
export function ComposerCard({ children, attachedTop = false }: { children: ReactNode; attachedTop?: boolean }) {
  return (
    <div
      className={`mc-workbench-material-interactive relative -mx-2.5 flex flex-col rounded-box border border-base-300 shadow-sm focus-within:border-base-content/25 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-primary ${
        attachedTop ? "[border-top-left-radius:0] [border-top-right-radius:0]" : ""
      }`}
    >
      {children}
    </div>
  );
}

/** textarea 与影子副本共用的度量类。两者字体/内距/最小高必须逐项一致,
 * 副本量出的高度才是 textarea 的真实内容高——收口成一个字面量,改度量
 * 只改这里(类是源码字面量,Tailwind 扫得到)。 */
const TA_METRICS = "textarea min-h-10 w-full border-0 text-sm";

/** 输入框随内容自适应高度(~160px 封顶,超出内滚),纯 CSS 影子副本实现:
 * 同格 grid 叠放一个 invisible 的 pre-wrap 副本,内容撑高格子,textarea
 * 拉伸填满;max-h-40(160px)封顶后 textarea 内滚。
 *
 * 为什么不是「写 height:auto → 读 scrollHeight」的 JS 量高(2026-08-10
 * recording4 定案):那是每次按键一记同步强制样式刷新。当时的全量历史 DOM
 * 即使用 content-visibility 剪枝，JS 强制读也会让 WKWebKit 当场结清布局；
 * daisyUI 的 :has() 规则族又扩大样式失效，于是每个键都重付 ~230ms(28/28 次长重算全部
 * 嵌在 input 派发内,采样 342/342 命中量高回调)。WKWebView 对照实验:
 * 同样的失效交给自然重算 6ms,JS 强制读 94~200ms。打字路径上禁止任何
 * 同步布局读,量高这件事整个取消——副本模式连测量都不存在。 */
export function ComposerTextarea({
  taRef,
  value,
  ...rest
}: {
  taRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "className" | "rows" | "ref">) {
  return (
    <div className="grid">
      {/* 副本尾附一个空格:值以换行收尾时,pre-wrap 的裸尾换行不渲染,
          补个空格才能把最后那行空行的高度撑出来(textarea 是渲染的) */}
      <div
        aria-hidden
        className={`${TA_METRICS} col-start-1 row-start-1 invisible max-h-40 overflow-hidden whitespace-pre-wrap break-words`}
      >
        {value + " "}
      </div>
      <textarea
        ref={taRef}
        className={`${TA_METRICS} col-start-1 row-start-1 resize-none overflow-x-hidden overflow-y-auto bg-transparent shadow-none focus:outline-none`}
        rows={2}
        value={value}
        {...rest}
      />
    </div>
  );
}

/** 斜杠指令面板(本地与云端同一件):贴输入卡上缘上弹的候选列表。
 * 纯呈现——过滤/高亮/键盘循环的状态机在调用方(lib/util/slash 纯函数),
 * 这里只画 listbox 与条目。 */
export function SlashPanel({
  list,
  active,
  onHover,
  onPick,
}: {
  list: readonly SlashCommand[];
  /** 高亮项下标(调用方已按 list 长度收敛) */
  active: number;
  onHover: (i: number) => void;
  onPick: (cmd: SlashCommand) => void;
}) {
  const { t } = useI18n();
  return (
    <ul
      role="listbox"
      aria-label={t("chat.slash.label")}
      className="menu absolute start-2 bottom-full z-50 mb-1 max-h-64 w-80 flex-nowrap [&_li]:flex-nowrap overflow-x-hidden overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
    >
      {list.length === 0 && (
        <li className="menu-disabled">
          <span className="text-xs">{t("chat.slash.empty")}</span>
        </li>
      )}
      {list.map((c, i) => (
        <li key={c.name}>
          <button
            type="button"
            role="option"
            aria-selected={i === active}
            className={`flex items-baseline gap-2 ${i === active ? "menu-active" : ""}`}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(c)}
          >
            <span className="font-mono text-xs font-bold">/{c.name}</span>
            {c.input?.hint && <span className="font-mono text-2xs opacity-50">{c.input.hint}</span>}
            {c.description && <span className="min-w-0 flex-1 truncate text-xs opacity-60">{c.description}</span>}
          </button>
        </li>
      ))}
      <li className="menu-disabled mt-1 border-t border-base-300">
        <span className="text-2xs">{t("chat.slash.hint")}</span>
      </li>
    </ul>
  );
}
