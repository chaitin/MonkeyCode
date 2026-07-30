// 会话/云端任务共用的 composer 组件:输入卡(textarea 自适应高度 + IME 守卫
// + 发送按钮)、运行条、排队 chip。原先 chat.tsx 与 cloudtask.tsx 各持一份
// 逐字相同的样式、靠注释对表,现收敛于此;两侧的扩展位(本地:附件条/权限
// pill/模型切换/ctx 环;云端:状态行/云端模型选择器)走 above/controls 槽位。
import { useEffect, useRef, type ClipboardEvent, type ReactNode } from "react";
import { IconClock, IconSend, IconStop, IconX } from "./icons";

// 输入法(IME)组合态的 Enter 只是确认候选词,不能当作提交。Chromium 上该 keydown
// 的 isComposing 为 true 即可拦截;但 WebKit(macOS 壳的 WKWebView)顺序相反:
// compositionend 先于 keydown 触发且 isComposing 已复位。故再记录组合结束时刻,
// 紧随其后的 Enter(同一次按键,时间差远小于人手连按)一律视为选字确认。
let imeEndedAt = -Infinity;
export const markImeEnd = (e: { timeStamp: number }) => {
  imeEndedAt = e.timeStamp;
};
export const isImeEnter = (e: { timeStamp: number; nativeEvent: { isComposing: boolean } }) =>
  e.nativeEvent.isComposing || e.timeStamp - imeEndedAt < 100;

/** 运行条:spinner + 状态文案 + 轮次说明 + 停止按钮(文案/停止语义走 props) */
export function RunningBar({
  label,
  detail,
  stopTitle,
  onStop,
}: {
  label: string;
  detail: string;
  stopTitle?: string;
  onStop: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span className="spinner" />
      <span style={{ fontWeight: 600, fontSize: 12.5 }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--t5)" }}>{detail}</span>
      <span style={{ flex: 1 }} />
      <button
        className="hv-errbg"
        title={stopTitle}
        onClick={onStop}
        style={{
          height: 26,
          border: "1px solid var(--errBd)",
          background: "transparent",
          color: "var(--err)",
          borderRadius: 13,
          padding: "0 12px",
          fontSize: 11.5,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <IconStop />
        停止
      </button>
    </div>
  );
}

/** 排队 chip:运行中发送的内容先排队,结束后自动发出(时机提示走 props) */
export function QueuedChip({ text, hint, onClear }: { text: string; hint: string; onClear: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--panel2)",
        border: "1px solid var(--cardBd)",
        borderRadius: 10,
        padding: "7px 12px",
        fontSize: 12,
        margin: "0 -12px",
      }}
    >
      <IconClock />
      <span style={{ color: "var(--t3)", flex: "none" }}>已排队</span>
      <span className="ellipsis" style={{ fontWeight: 600, flex: 1 }}>{text}</span>
      <span style={{ color: "var(--t6)", flex: "none", fontSize: 11.5 }}>{hint}</span>
      <button className="hv2 icon-btn" title="取消排队" onClick={onClear} style={{ width: 20, height: 20, borderRadius: 5 }}>
        <IconX />
      </button>
    </div>
  );
}

/** 输入卡:textarea 随内容自适应高度,Enter 发送(IME 组合态守卫)、⇧↩ 换行 */
export function Composer({
  value,
  placeholder,
  sendActive,
  onChange,
  onSend,
  onPaste,
  above,
  controls,
}: {
  value: string;
  placeholder: string;
  /** 发送按钮点亮(内容/附件非空;置灰仍可点,行为交 onSend 自行裁决) */
  sendActive: boolean;
  onChange: (v: string) => void;
  onSend: () => void;
  /** 粘贴处理(本地:剪贴板文件转附件;不给则默认文本粘贴) */
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  /** 卡片顶部扩展位(本地:附件条) */
  above?: ReactNode;
  /** 底部操作行(发送按钮左侧,含中缝 spacer 由调用方排布) */
  controls?: ReactNode;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 输入框随内容自适应高度
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [value]);

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--inputBd)",
        borderRadius: 14,
        boxShadow: "var(--panelSh)",
        display: "flex",
        flexDirection: "column",
        // 光学对齐:硬边卡片向两侧出血 12px,卡内文字(textarea 左内距 15px)
        // 与对话文字左缘几乎重合,消除"输入框显窄"的错觉
        margin: "0 -10px",
      }}
    >
      {above}
      <textarea
        ref={taRef}
        rows={2}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onCompositionEnd={markImeEnd}
        onKeyDown={(e) => {
          // 输入法组合态(选字/确认候选)的 Enter 不发送
          if (e.key === "Enter" && !e.shiftKey && !isImeEnter(e)) {
            e.preventDefault();
            onSend();
          }
        }}
        onPaste={onPaste}
        style={{
          border: "none",
          outline: "none",
          resize: "none",
          background: "transparent",
          color: "var(--t1)",
          padding: "13px 15px 3px",
          fontSize: 13.5,
          lineHeight: 1.5,
          maxHeight: 160,
          display: "block",
          width: "100%",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px 10px" }}>
        {controls}
        <button
          className="hv-acc icon-btn"
          title="发送 ↩ · 换行 ⇧↩"
          onClick={onSend}
          style={{ width: 29, height: 29, borderRadius: 9, background: "var(--acc)", opacity: sendActive ? 1 : 0.45 }}
        >
          <IconSend />
        </button>
      </div>
    </div>
  );
}
