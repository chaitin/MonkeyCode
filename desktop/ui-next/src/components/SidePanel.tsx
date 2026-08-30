// 会话右侧侧边栏壳(2026-08-30 用户 mockup 定案):文件/变更/终端/预览
// 等辅助面板统一收进右侧栏——顶部一排扁平 tab,面板是主区的 flex 兄弟列
// (非模态,无 scrim,旧 FilesDrawer 的浮层形态随之退役)。开合唯一入口是
// header 的开合钮(2026-08-30 用户报障「面板内收起钮与 header 重复」,
// 面板内不再放第二颗)。
// 本组件只管壳:宽度(左缘拖宽,localStorage 落盘,本地/云端共用一键)与
// tab 条;各 tab 的内容与懒挂载策略由调用方(ChatView/CloudTaskView)
// 自持——终端/预览这类有连接生命周期的面板,切 tab 只能藏不能卸。
import { useRef, useState, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";

const WIDTH_KEY = "mc.sidePanelWidth";
const MIN_WIDTH = 320; // 与设计预览工作台旧下限一致(min-w-80)
const KEEP_MAIN = 360; // 拖宽时给主区留的呼吸位(设计预览旧值随迁)

function readWidth(): number | string {
  try {
    const v = parseInt(localStorage.getItem(WIDTH_KEY) ?? "", 10);
    if (Number.isFinite(v) && v >= MIN_WIDTH) return v;
  } catch {
    /* 存储不可读走默认 */
  }
  return "60%"; // 首次打开给足预览空间;拖过一次后按像素记忆
}

export interface SidePanelTab {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: number;
  /** 禁用原因(云端文件在 runtime 未就绪时不许直连);有值即禁用。 */
  disabledReason?: string;
}

export function SidePanel({
  tabs,
  active,
  onSelect,
  children,
}: {
  tabs: SidePanelTab[];
  active: string;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const paneRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState<number | string>(readWidth);

  return (
    <aside
      ref={paneRef}
      aria-label={t("side.label")}
      style={{ width }}
      className="relative flex min-w-80 max-w-[85%] shrink-0 flex-col border-s border-base-300 bg-base-100"
    >
      {/* 左缘拖宽把手(设计预览工作台同款 pointer capture;松手落盘) */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("side.resize")}
        className="absolute inset-y-0 -start-1 z-30 w-2 cursor-col-resize"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const parent = paneRef.current?.parentElement?.getBoundingClientRect();
          const move = (event: PointerEvent) =>
            parent && setWidth(Math.max(MIN_WIDTH, Math.min(parent.width - KEEP_MAIN, parent.right - event.clientX)));
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            setWidth((w) => {
              if (typeof w === "number") {
                try {
                  localStorage.setItem(WIDTH_KEY, String(Math.round(w)));
                } catch {
                  /* 只丢持久化 */
                }
              }
              return w;
            });
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up, { once: true });
        }}
      />
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-base-300 px-2">
        {/* overflow-**clip**,不是 hidden(LAYOUT §5 同族坑):单写一轴
            hidden 会把另一轴算成 auto,tab 条自己变成纵向滚动容器——点击
            tab 获焦触发 scrollIntoView,整排按钮上下跳、右缘冒细滚动条
            (2026-08-30 用户报障)。clip 连程序滚动都禁止,窄面板下长
            标签只裁不滚 */}
        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1 overflow-clip">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              title={tab.disabledReason ?? tab.label}
              disabled={!!tab.disabledReason}
              className={`btn btn-xs shrink-0 gap-1.5 ${active === tab.id ? "btn-active" : "btn-ghost text-base-content/70"}`}
              onClick={() => onSelect(tab.id)}
            >
              {tab.icon}
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="badge badge-soft badge-primary badge-xs">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>
      </header>
      {children}
    </aside>
  );
}
