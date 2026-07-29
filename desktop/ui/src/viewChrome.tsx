// 视图镶边:标题栏、「文件」按钮、⋯ 菜单外壳与危险操作的二段确认页。
import { useState, type ChangeEvent, type CompositionEvent, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { isImeEnter, markImeEnd } from "./composer";
import { IconDots, IconFolder, IconSpark, IconTrash } from "./icons";

/** 标题栏字重:700 在 mac 的 San Francisco 下明显偏重,三端统一降到 600。
 * 展示态与改名输入框必须同值,编辑态切换时文字观感才不跳。 */
const TITLE_WEIGHT = 600;

// ==================== 会话改名的编辑态(侧栏行 / 视图标题栏共用) ====================

/** 内核截断到 80 字符(session_patch),输入框同步设限,免得输进去又被悄悄切掉。 */
const TITLE_MAX = 80;

/** 提交语义:trim 后为空(内核只收非空标题)或与原标题相同,都按放弃处理。 */
export function nextRenameTitle(draft: string, current: string): string | null {
  const next = draft.trim();
  return next && next !== current ? next : null;
}

export interface RenameDraft {
  editing: boolean;
  /** 进入编辑态(标题栏双击 / 菜单项「重命名」) */
  start: () => void;
  /** 摊到 <input> 上:受控值 + 提交/放弃语义。调用方只管样式与额外的事件拦截。 */
  inputProps: {
    autoFocus: true;
    value: string;
    maxLength: number;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
    onCompositionEnd: (e: CompositionEvent<HTMLInputElement>) => void;
    onFocus: (e: FocusEvent<HTMLInputElement>) => void;
    onBlur: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  };
}

/** 改名的编辑态:Enter 提交(挡输入法选字回车)、Esc 放弃、失焦提交。
 * 两个入口共用同一份实现——各写各的必然漂移。 */
export function useRenameDraft(current: string, onRename: (title: string) => void): RenameDraft {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const commit = () => {
    setEditing(false);
    const next = nextRenameTitle(draft, current);
    if (next) onRename(next);
  };
  return {
    editing,
    start: () => {
      setDraft(current);
      setEditing(true);
    },
    inputProps: {
      autoFocus: true,
      value: draft,
      maxLength: TITLE_MAX,
      onChange: (e) => setDraft(e.target.value),
      onCompositionEnd: markImeEnd,
      // 进编辑态即全选(Finder 改名的手感:直接打字覆盖,想改局部再点一下)。
      // 挂在 onFocus 而非 mount:autoFocus 触发的是真 focus,而编辑态一失焦就
      // 提交并卸载,不存在"编辑中重新聚焦被强行全选"的场景。
      onFocus: (e) => e.currentTarget.select(),
      onBlur: commit,
      onKeyDown: (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !isImeEnter(e)) commit();
        else if (e.key === "Escape") setEditing(false);
      },
    },
  };
}

// ==================== 视图镶边共享件(ChatView / CloudTaskView / Sidebar) ====================

/** 视图标题栏:56px 双行,空白区可拖拽窗口(macOS 常规行为)。
 * 几何为本地会话与云端任务两个视图逐像素共用;副标题行整体作 ReactNode
 * 传入(两侧内容与 gap 各异,原样保留)。副标题缺席(对话头部)时标题
 * 垂直居中,收成单行,外框高度不变。 */
export function ViewHeader({
  title,
  titleTip,
  subtitle,
  rename,
  children,
}: {
  title: ReactNode;
  /** 标题的悬停提示(云端传完整任务名;本地不传) */
  titleTip?: string;
  subtitle?: ReactNode;
  /** 传入即启用「双击标题原地改名」(本地会话;云端任务不可改名,不传) */
  rename?: RenameDraft;
  /** 右侧控件(文件按钮 / ⋯ 菜单) */
  children?: ReactNode;
}) {
  return (
    <div data-view-header="" data-tauri-drag-region="" style={{ height: 58, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 26px", borderBottom: "1px solid var(--line2)", background: "var(--headerBg)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        {rename?.editing ? (
          <input
            {...rename.inputProps}
            placeholder="输入会话名称"
            // 负 margin 抵消边框+内边距,编辑态与展示态的文字左缘、行高对齐,切换时标题不跳
            style={{
              width: "min(360px, 40vw)",
              height: 22,
              boxSizing: "border-box",
              margin: "-1px 0 -1px -7px",
              border: "1px solid var(--accBd)",
              borderRadius: 5,
              padding: "0 6px",
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: TITLE_WEIGHT,
              background: "var(--card)",
              color: "var(--t1)",
              outline: "none",
            }}
          />
        ) : (
          // 双击热区严格限定在文字上:此 span 不带 data-tauri-drag-region,
          // 否则双击会被壳当作标题栏双击去切窗口最大化(Tauri 只认事件目标自身带该属性)
          <span
            className="ellipsis"
            title={titleTip ?? (rename ? "双击重命名" : undefined)}
            onDoubleClick={
              rename &&
              ((e) => {
                e.stopPropagation();
                rename.start();
              })
            }
            style={{ fontWeight: TITLE_WEIGHT, fontSize: 14, cursor: rename ? "text" : undefined }}
          >
            {title}
          </span>
        )}
        {subtitle}
      </div>
      <span data-tauri-drag-region="" style={{ flex: 1, alignSelf: "stretch" }} />
      {children}
    </div>
  );
}

/** 副标题行的尾段:引擎每轮异步生成的会话摘要(≤60 字,随对话演进改写)。
 * 标题归用户(双击改名)与首条消息,摘要只在这里露一行——两行并列才有
 * 「我说的」与「它理解的」这层信息;摘要参与命名反而会把用户改的名冲掉。
 * 摘要缺席(旧会话、首轮还没回来、引擎过旧)时整段不渲染,副标题与摘要
 * 上线前逐像素一致。 */
export function HeaderSummary({ summary }: { summary?: string }) {
  if (!summary) return null;
  return (
    <>
      <span style={{ color: "var(--t7)", flex: "none" }}>·</span>
      <span title={summary} style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, flex: "0 1 auto" }}>
        <IconSpark size={10} color="var(--t5)" style={{ flex: "none" }} />
        <span className="ellipsis" style={{ color: "var(--t4)" }}>{summary}</span>
      </span>
    </>
  );
}

/** 标题栏「文件」按钮(badge 位:本地放改动计数徽标;对话头部借同款
 * 皮相放「临时目录」入口,label 可换) */
export function HeaderFilesButton({ title, label = "文件", onClick, badge }: { title: string; label?: string; onClick: () => void; badge?: ReactNode }) {
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
      {label}
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
