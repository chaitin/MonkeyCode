// 视图镶边:标题栏、「文件」按钮、⋯ 菜单外壳与危险操作的二段确认页。
import type { ReactNode } from "react";
import { IconDots, IconFolder, IconTrash } from "./icons";

// ==================== 视图镶边共享件(ChatView / CloudTaskView / Sidebar) ====================

/** 视图标题栏:56px 双行,空白区可拖拽窗口(macOS 常规行为)。
 * 几何为本地会话与云端任务两个视图逐像素共用;副标题行整体作 ReactNode
 * 传入(两侧内容与 gap 各异,原样保留)。 */
export function ViewHeader({
  title,
  titleTip,
  subtitle,
  children,
}: {
  title: ReactNode;
  /** 标题的悬停提示(云端传完整任务名;本地不传) */
  titleTip?: string;
  subtitle: ReactNode;
  /** 右侧控件(文件按钮 / ⋯ 菜单) */
  children?: ReactNode;
}) {
  return (
    <div data-view-header="" data-tauri-drag-region="" style={{ height: 58, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 26px", borderBottom: "1px solid var(--line2)", background: "var(--headerBg)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span className="ellipsis" title={titleTip} style={{ fontWeight: 700, fontSize: 14 }}>
          {title}
        </span>
        {subtitle}
      </div>
      <span data-tauri-drag-region="" style={{ flex: 1, alignSelf: "stretch" }} />
      {children}
    </div>
  );
}

/** 标题栏「文件」按钮(badge 位:本地放改动计数徽标) */
export function HeaderFilesButton({ title, onClick, badge }: { title: string; onClick: () => void; badge?: ReactNode }) {
  return (
    <button
      className="hv"
      title={title}
      onClick={onClick}
      style={{
        height: 28,
        border: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 12px",
        borderRadius: 8,
        background: "var(--card)",
        fontSize: 12,
        color: "var(--t2)",
        cursor: "pointer",
        fontWeight: 600,
        boxShadow: "var(--cardSh)",
        flex: "none",
      }}
    >
      <IconFolder size={12} />
      文件
      {badge}
    </button>
  );
}

/** ⋯ 菜单的三态(closed/open/confirm;confirm = 危险操作的二段确认页) */
export type MenuState = "closed" | "open" | "confirm";

/** 菜单确认页:警示文案 + 确认/取消(三处菜单共用,文案差异走 props) */
export function ConfirmPane({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div style={{ padding: "6px 9px 4px", fontSize: 11.5, color: "var(--t4)", lineHeight: 1.6, maxWidth: 200, whiteSpace: "normal" }}>
        {message}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button className="hv-errbg menu-item" style={{ color: "var(--err)", fontWeight: 600 }} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button className="hv menu-item" onClick={onCancel}>
          取消
        </button>
      </div>
    </>
  );
}

/** 删除菜单项:运行中置灰(先停止才能删),否则进入二段确认 */
export function DeleteMenuItem({ running, onDelete, label = "删除" }: { running: boolean; onDelete: () => void; label?: string }) {
  return running ? (
    <button className="menu-item" style={{ cursor: "default", color: "var(--t5)" }} title="运行中,请先停止">
      <IconTrash color="var(--t5)" />
      {label}
    </button>
  ) : (
    <button className="hv-errbg menu-item" style={{ color: "var(--err)" }} onClick={onDelete}>
      <IconTrash />
      {label}
    </button>
  );
}

/** 标题栏 ⋯ 菜单外壳:触发钮 + backdrop + 上对齐弹层,open 态渲染 children,
 * confirm 态渲染确认页(状态由调用方持有——children 里的菜单项要能置 confirm)。 */
export function HeaderMenu({
  menu,
  setMenu,
  minWidth,
  confirm,
  children,
}: {
  menu: MenuState;
  setMenu: (m: MenuState) => void;
  minWidth: number;
  confirm: { message: string; confirmLabel: string; onConfirm: () => void };
  children: ReactNode;
}) {
  return (
    <div style={{ position: "relative", flex: "none" }}>
      <button
        className="hv icon-btn"
        title="更多"
        onClick={() => setMenu(menu === "closed" ? "open" : "closed")}
        style={{ width: 28, height: 28, borderRadius: 8, background: menu !== "closed" ? "var(--hov)" : "transparent" }}
      >
        <IconDots size={14} color="var(--t5)" />
      </button>
      {menu !== "closed" && (
        <>
          <div className="backdrop" onClick={() => setMenu("closed")} />
          <div className="pop" style={{ position: "absolute", top: 32, right: 0, minWidth }}>
            {menu === "open" ? (
              children
            ) : (
              <ConfirmPane
                message={confirm.message}
                confirmLabel={confirm.confirmLabel}
                onConfirm={() => {
                  setMenu("closed");
                  confirm.onConfirm();
                }}
                onCancel={() => setMenu("closed")}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
