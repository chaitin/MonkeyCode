// Windows 壳的自绘标题栏:壳去掉了原生装饰栏(decorations=false),这里补回
// 与侧栏分区连续的品牌 + 拖拽区 + Windows 窗口按钮。
// 刻意**不**复述页面上下文:任务标题的唯一归属是内容区 ViewHeader(此前
// 标题栏灰字与其正下方的大标题连着重复两遍);窗口级上下文写进原生窗口
// 标题(App 侧 setWindowTitle),Alt-Tab/任务栏那里才是它该在的地方——
// 与 mac 的分工一致(品牌带 + 视图头,各管各的)。
// 仅 isWindowsShell() 时由 App 渲染;mac 壳走 Overlay 红绿灯,浏览器模式无此栏。
import { useEffect, useState, type CSSProperties } from "react";
import {
  isMacShell,
  onWindowResized,
  windowClose,
  windowIsMaximized,
  windowMinimize,
  windowToggleFullscreen,
  windowToggleMaximize,
} from "./host";
import logoUrl from "./logo.png";

/** 品牌字后的小徽标。文案与含义由产品定,这里只保证它跟着品牌走。 */
const BRAND_BADGE = "work";

/** 品牌组合(字标 + 徽标,可选前置 logo)。Windows 自绘标题栏的两种
 * 布局各用一次——写死在两处的话,迟早长歪。
 * 每个可见子节点都要自带 data-tauri-drag-region:Tauri 按指针下的元素判定拖拽区,
 * 落在没有该属性的子节点上就拖不动窗口(logo 用 pointerEvents:none 穿透给父级)。 */
function Brand({ logo = false }: { logo?: boolean }) {
  return (
    <>
      {logo && (
        <img src={logoUrl} alt="" draggable={false} style={{ width: 18, height: 18, borderRadius: 5, flex: "none", pointerEvents: "none" }} />
      )}
      <span data-tauri-drag-region="" style={{ flex: "none", fontSize: 12, fontWeight: 700, color: "var(--t2)", letterSpacing: 0.1 }}>
        MonkeyCode
      </span>
      <span
        data-tauri-drag-region=""
        style={{
          flex: "none",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.3,
          lineHeight: "15px",
          padding: "0 5px",
          borderRadius: 4,
          background: "var(--accBg)",
          color: "var(--accTx)",
          whiteSpace: "nowrap",
        }}
      >
        {BRAND_BADGE}
      </span>
    </>
  );
}

/** mac 自绘小红绿灯:原生 NSWindow 按钮的尺寸与间距是 AppKit 私有绘制改不了,
 * 壳里已把原生三颗隐藏(src/main.rs hide_native_window_buttons),这里画 10px
 * 的替身,行为经 core window 命令接回——关闭走壳的托盘拦截(与原生一致)、
 * 最小化、绿点进/出系统全屏(⌥ 点击缩放,mac 惯例)。悬停整组浮现字形、
 * 窗口失焦整组退灰(样式在 styles.css .mac-lights)。
 * 高 50px 与品牌带同一条中线,整条是拖拽区(双击缩放由 Tauri 内建处理),
 * Tauri 的拖拽区机制是 data-tauri-drag-region 属性,不是 CSS app-region;
 * 一级栏与设置页左导航共用,保证两态顶部对齐不跳动。
 * 非 mac 壳退化为 12px 留白(Windows 的窗口按钮在自绘标题栏右侧)。
 * 已知放弃:macOS 15 悬停绿点的系统平铺菜单无法复刻。 */
export function MacWindowControls() {
  const [blurred, setBlurred] = useState(false);
  useEffect(() => {
    if (!isMacShell()) return;
    const focus = () => setBlurred(false);
    const blur = () => setBlurred(true);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
    };
  }, []);
  if (!isMacShell()) return <div style={{ height: 12, flex: "none" }} />;
  const glyph = "rgba(0,0,0,0.55)";
  return (
    <div
      className="mac-lights"
      data-tauri-drag-region=""
      data-blurred={blurred ? "" : undefined}
      style={{ height: 50, flex: "none", alignSelf: "stretch", display: "flex", alignItems: "center", gap: 3, paddingLeft: 9 }}
    >
      <button className="mac-light" title="关闭" aria-label="关闭" onClick={() => void windowClose()} style={{ "--c": "#ff5f57" } as CSSProperties}>
        <span className="mac-light-dot">
          <svg className="mac-light-glyph" width={8} height={8} viewBox="0 0 8 8">
            <path d="M2 2l4 4M6 2L2 6" stroke={glyph} strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      <button className="mac-light" title="最小化" aria-label="最小化" onClick={() => void windowMinimize()} style={{ "--c": "#febc2e" } as CSSProperties}>
        <span className="mac-light-dot">
          <svg className="mac-light-glyph" width={8} height={8} viewBox="0 0 8 8">
            <path d="M1.6 4h4.8" stroke={glyph} strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      <button
        className="mac-light"
        title="全屏"
        aria-label="全屏"
        onClick={(e) => void (e.altKey ? windowToggleMaximize() : windowToggleFullscreen())}
        style={{ "--c": "#28c840" } as CSSProperties}
      >
        <span className="mac-light-dot">
          <svg className="mac-light-glyph" width={8} height={8} viewBox="0 0 8 8">
            <path d="M1.6 6.4V3.7L4.3 6.4Z M6.4 1.6V4.3L3.7 1.6Z" fill={glyph} />
          </svg>
        </span>
      </button>
    </div>
  );
}

/** macOS 壳主侧栏顶部的品牌带:与 Windows 自绘标题栏同款字标 + 徽标,
 * 高度同 MacWindowControls(50px),同一条中线,整条可拖拽。
 * 与一级栏 31px logo 并存是有意的:字标在带内、logo 在带下方,
 * 分属两层不再同排争位。
 * 非 mac 壳退化为 12px 留白——Windows 的品牌在自绘标题栏里,不重复。 */
export function MacBrandBand() {
  return isMacShell() ? (
    <div data-tauri-drag-region="" style={{ height: 50, flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "0 14px", overflow: "hidden" }}>
      <Brand />
    </div>
  ) : (
    <div style={{ height: 12, flex: "none" }} />
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

export default function TitleBar({ layout = "sidebar" }: { layout?: "sidebar" | "settings" }) {
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
            style={{ width: "var(--railW)", height: "100%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--rail)", borderRight: "1px solid var(--line2)" }}
          >
            <img src={logoUrl} alt="" draggable={false} style={{ width: 19, height: 19, borderRadius: 5, pointerEvents: "none" }} />
          </span>
          <span
            data-tauri-drag-region=""
            style={{ width: "var(--sideW)", height: "100%", flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "0 14px", overflow: "hidden", background: "var(--side)", borderRight: "1px solid var(--line)" }}
          >
            <Brand />
          </span>
        </>
      ) : (
        <span
          data-tauri-drag-region=""
          style={{ width: "var(--setNavW)", height: "100%", flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "0 14px", overflow: "hidden", background: "var(--side)", borderRight: "1px solid var(--line)" }}
        >
          <Brand logo />
        </span>
      )}
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
