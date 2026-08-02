// 技能(Agent 上报的 available_commands,即斜杠指令)选择器:composer 上的
// 「使用技能」按钮 + 上弹菜单。入口措辞与移动端「使用技能」对齐(纯 / 图标
// 普通用户看不懂),交互保留桌面双路径——
//   1. 直接在输入框敲 `/` 即就地补全(↑↓ 选择、↩/⇥ 填入、Esc 关掉),
//   2. 不记得指令名时点「使用技能」按钮浏览全部。
// 两条路径共用同一份状态(useSlashCommands),菜单只有一个。
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { isImeEnter } from "./composer";
import { MONO } from "./fonts";
import { IconSlash } from "./icons";
import { useUpwardMenuHeight } from "./menuPosition";
import { commandText, filterCommands, nextActive, slashQuery } from "./slashCommands";
import type { SlashCommand } from "./types";

export interface SlashCommandsHandle {
  /** 菜单是否展开(按钮点开,或输入框正在敲 /xxx) */
  open: boolean;
  /** 当前过滤结果(前缀匹配优先) */
  list: SlashCommand[];
  active: number;
  setActive(i: number): void;
  pick(cmd: SlashCommand): void;
  /** 按钮开合;有指令才响应 */
  toggle(): void;
  close(): void;
  /** 输入区按键预处理:返回 true = 本次按键归菜单(Composer 不再当作发送) */
  onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean;
}

export function useSlashCommands(opts: {
  commands: SlashCommand[];
  input: string;
  setInput(v: string): void;
  /** 选完指令把焦点还给输入框(桌面上丢焦点等于打断输入) */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** 结束态等场景整体关闭 */
  enabled?: boolean;
}): SlashCommandsHandle {
  const { commands, input, setInput, inputRef, enabled = true } = opts;
  const [buttonOpen, setButtonOpen] = useState(false);
  // Esc / 已填入:压住当前这一段 `/xxx` 的自动补全,直到它被清掉
  const [typingOff, setTypingOff] = useState(false);
  const [active, setActive] = useState(0);

  const query = enabled ? slashQuery(input) : null;
  const has = enabled && commands.length > 0;
  const open = has && (buttonOpen || (query !== null && !typingOff));
  const list = useMemo(() => filterCommands(commands, query ?? ""), [commands, query]);

  // 查询词/清单变了就回到第一项:高亮停在旧下标会选中看不见的条目
  useEffect(() => setActive(0), [query, commands]);
  // 输入框里的 `/` 段被清掉 → 解除压制,下次敲 / 照常补全
  useEffect(() => {
    if (query === null) setTypingOff(false);
  }, [query]);

  const close = useCallback(() => {
    setButtonOpen(false);
    if (query !== null) setTypingOff(true);
  }, [query]);

  // Esc 关闭必须在 window **capture** 阶段拦截(与 chat.tsx 的 ModelPicker 同源):
  // 全局快捷键(appView)在云端视图里,Esc 落在输入态是 blur composer、落在
  // 别处直接关掉整个任务视图——菜单开着时这一下只能归菜单。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  const pick = (cmd: SlashCommand) => {
    setInput(commandText(cmd));
    setButtonOpen(false);
    // 填入的文本自己就是一段 `/name`,不压住的话菜单会立刻回弹匹配自己
    setTypingOff(true);
    inputRef?.current?.focus();
  };

  // 高亮下标随时按列表长度收敛:过滤把列表缩短的那一帧,旧下标会越界
  const act = Math.min(active, Math.max(0, list.length - 1));

  // Esc 不在这里收(见上面的 window capture):那条路径同时覆盖"按钮点开、
  // 焦点不在输入框"的情形,冒泡阶段的 textarea 处理器够不着。
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        setActive(nextActive(act, e.key === "ArrowDown" ? 1 : -1, list.length));
        return true;
      case "Enter":
      case "Tab":
        // 输入法组合态的 ↩ 是选字确认,不是选中指令(与 Composer 同一守卫)
        if (e.key === "Enter" && isImeEnter(e)) return false;
        if (!list.length) return false;
        e.preventDefault();
        pick(list[act]);
        return true;
      default:
        return false;
    }
  };

  return {
    open,
    list,
    active: act,
    setActive,
    pick,
    // 按 open 而非 buttonOpen 取反:输入框里正敲着 /xxx 时,菜单本就开着,
    // 这一下应该是"关掉"(只翻 buttonOpen 会看起来点了没反应)
    toggle: () => {
      if (!has) return;
      if (open) return close();
      setTypingOff(false);
      setButtonOpen(true);
    },
    close,
    onKeyDown,
  };
}

/** composer 左侧的「使用技能」按钮 + 上弹菜单(整体自带定位锚点) */
export function SlashCommandMenu({ h, count }: { h: SlashCommandsHandle; count: number }) {
  const { anchorRef, menuMaxHeight } = useUpwardMenuHeight<HTMLSpanElement>(h.open, 320);
  const disabled = count === 0;
  return (
    <span ref={anchorRef} style={{ position: "relative", display: "flex", flex: "none" }}>
      <button
        className="hv2 icon-btn"
        title={disabled ? "Agent 尚未上报可用技能(环境就绪后自动同步)" : `使用技能(${count})· 在输入框直接敲 / 也可唤起`}
        onClick={h.toggle}
        style={{
          height: 24,
          padding: "0 7px",
          gap: 4,
          borderRadius: 7,
          background: h.open ? "var(--hov)" : "transparent",
          fontSize: 11.5,
          fontWeight: 500,
          color: "var(--t3)",
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <IconSlash size={12} color="var(--t3)" />
        使用技能
      </button>
      {h.open && (
        <>
          <div className="backdrop" onClick={h.close} />
          <div
            className="pop"
            style={{
              position: "absolute",
              bottom: 30,
              left: 0,
              width: 340,
              maxHeight: menuMaxHeight,
              overflow: "hidden",
            }}
          >
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {h.list.length === 0 && (
                <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--t5)" }}>无匹配指令</div>
              )}
              {h.list.map((c, i) => (
                <button
                  key={c.name}
                  className="menu-item"
                  onMouseEnter={() => h.setActive(i)}
                  onClick={() => h.pick(c)}
                  title={c.description || `/${c.name}`}
                  style={{
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: 2,
                    whiteSpace: "normal",
                    background: i === h.active ? "var(--hov)" : "transparent",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                    <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: "var(--accTx)", flex: "none" }}>
                      /{c.name}
                    </span>
                    {c.input?.hint && (
                      <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--t6)", flex: "none" }}>
                        {c.input.hint}
                      </span>
                    )}
                  </span>
                  {c.description && (
                    <span className="ellipsis" style={{ fontSize: 11.5, color: "var(--t5)", lineHeight: 1.4 }}>
                      {c.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div
              style={{
                flex: "none",
                borderTop: "1px solid var(--line2)",
                margin: "4px -4px -4px",
                padding: "5px 10px",
                fontSize: 10.5,
                color: "var(--t6)",
              }}
            >
              ↑↓ 选择 · ↩ 填入 · Esc 关闭
            </div>
          </div>
        </>
      )}
    </span>
  );
}
