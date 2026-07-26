// Windows 壳的自绘标题栏:壳去掉了原生装饰栏(decorations=false),这里补回
// 与侧栏分区连续的品牌/页面上下文 + 拖拽区 + Windows 窗口按钮。
// 仅 isWindowsShell() 时由 App 渲染;mac 壳走 Overlay 红绿灯,浏览器模式无此栏。
import { useEffect, useState, type CSSProperties } from "react";
import {
  isMacShell,
  onWindowResized,
  windowClose,
  windowIsMaximized,
  windowMinimize,
  windowToggleMaximize,
} from "./host";
import logoUrl from "./logo.png";

/** macOS 壳最左栏顶部的红绿灯落区:50px 拖拽区(Tauri 的拖拽区机制是
 * data-tauri-drag-region 属性,不是 CSS app-region);非 mac 壳 12px 普通留白。
 * 主侧栏与设置页左导航共用,保证两态顶部对齐不跳动。
 *
 * brand:二级侧栏顶部兼作品牌位。Windows 上这块是自绘标题栏的第二格(见下方
 * layout === "sidebar" 分支),mac 没有那条栏、这 50px 原本空着,品牌就落在这里,
 * 字号/字重/色/边距与 Windows 那一格逐项对齐,两平台品牌位置观感一致。
 * 只给二级栏用:一级栏顶部被红绿灯占着(它们横跨到 x≈66),摆不下东西;
 * 二级栏自 x=62 起,再加 14px 内边距,文字从 x≈76 开始,正好在按钮右侧。 */
export function MacDragSpacer({ brand = false }: { brand?: boolean } = {}) {
  if (!isMacShell()) return <div style={{ height: 12, flex: "none" }} />;
  return (
    <div
      data-tauri-drag-region=""
      style={{ height: 50, flex: "none", display: "flex", alignItems: "center", padding: "0 14px" }}
    >
      {brand && (
        <span data-tauri-drag-region="" style={{ fontSize: 12, fontWeight: 700, color: "var(--t2)", letterSpacing: 0.1 }}>
          MonkeyCode
        </span>
      )}
    </div>
  );
}

const btn: CSSProperties = {
  width: 46,
  height: "100%",
  border: "none",
  background: "transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--t3)",
  cursor: "default", // Windows 惯例:窗口按钮不是手型
  padding: 0,
  flex: "none",
};

/** 窗口按钮图标(Windows 10/11 caption 字形,1px 细线,currentColor 随 hover 变色) */
function Glyph({ d }: { d: string }) {
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" fill="none" style={{ display: "block" }}>
      <path d={d} stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export default function TitleBar({ context, layout = "sidebar" }: { context: string; layout?: "sidebar" | "settings" }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const sync = () => void windowIsMaximized().then(setMaximized);
    sync();
    return onWindowResized(sync);
  }, []);

  return (
    <div
      data-window-titlebar=""
      data-tauri-drag-region=""
      style={{
        height: 36,
        flex: "none",
        display: "flex",
        alignItems: "center",
        background: "var(--bg)",
        borderBottom: "1px solid var(--line2)",
        userSelect: "none",
      }}
    >
      {layout === "sidebar" ? (
        <>
          <span
            data-tauri-drag-region=""
            style={{ width: 62, height: "100%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--rail)", borderRight: "1px solid var(--line2)" }}
          >
            <img src={logoUrl} alt="" draggable={false} style={{ width: 19, height: 19, borderRadius: 5, pointerEvents: "none" }} />
          </span>
          <span
            data-tauri-drag-region=""
            style={{ width: 232, height: "100%", flex: "none", display: "flex", alignItems: "center", padding: "0 14px", background: "var(--side)", borderRight: "1px solid var(--line)" }}
          >
            <span data-tauri-drag-region="" style={{ fontSize: 12, fontWeight: 700, color: "var(--t2)", letterSpacing: 0.1 }}>MonkeyCode</span>
          </span>
        </>
      ) : (
        <span
          data-tauri-drag-region=""
          style={{ width: 168, height: "100%", flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 14px", background: "var(--side)", borderRight: "1px solid var(--line)" }}
        >
          <img src={logoUrl} alt="" draggable={false} style={{ width: 18, height: 18, borderRadius: 5, pointerEvents: "none" }} />
          <span data-tauri-drag-region="" style={{ fontSize: 12, fontWeight: 700, color: "var(--t2)" }}>MonkeyCode</span>
        </span>
      )}
      <span className="ellipsis" data-tauri-drag-region="" title={context} style={{ maxWidth: 420, padding: "0 14px", fontSize: 11.5, fontWeight: 550, color: "var(--t4)" }}>
        {context}
      </span>
      <span data-tauri-drag-region="" style={{ flex: 1, alignSelf: "stretch" }} />
      <button className="hv" title="最小化" onClick={() => void windowMinimize()} style={btn}>
        <Glyph d="M0 5h10" />
      </button>
      <button
        className="hv"
        title={maximized ? "向下还原" : "最大化"}
        onClick={() => void windowToggleMaximize()}
        style={btn}
      >
        {maximized ? (
          // 还原:前后两个错位方框
          <Glyph d="M.5 2.5h7v7h-7zM2.5 2.5v-2h7v7h-2" />
        ) : (
          <Glyph d="M.5 .5h9v9h-9z" />
        )}
      </button>
      <button className="hv-caption-close" title="关闭" onClick={() => void windowClose()} style={btn}>
        <Glyph d="M0 0l10 10M10 0L0 10" />
      </button>
    </div>
  );
}
