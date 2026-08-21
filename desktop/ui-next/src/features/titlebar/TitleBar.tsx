// 自绘窗口 chrome:
// - Windows / Linux 壳去掉原生装饰栏,这里补 28px **扁平窗框条**(右侧
//   最小化/最大化(还原)/关闭三键,关闭键 hover 官方红;左端应用图标,
//   Windows 上点击开系统菜单、双击关窗)。
//   高度取 28 而非 Win11 caption 的标准 32:用户两次反馈 Windows 顶部太厚
//   (2026-08-09)。**宽度仍守 46px 系统度量**——横向才是真正决定"点不点得中"
//   的那一维(三键并排,错一格就点成邻居),纵向瘦一点只是少占地方。
//   本条**只做 chrome**,三条铁律(LAYOUT §1):
//   ① 不放品牌/视图信息——品牌的法定位置是侧栏头(§2),两处都摆就成了上下
//      紧挨的两行同样字样(2026-08-07 用户报障「两个 header」);
//   ② **不承列色**——曾按 rail/side/main 分三段复刻列色以求"不断色",结果
//      base-200 色块紧贴着下面又一个 base-200 侧栏头,那才是「两个 header」
//      的真正成因(2026-08-08 定案)。窗框本来就该跟内容断开,整条单色;
//   ③ 不带底边线——有线就成了 header 基线。
// - mac 壳隐藏原生红绿灯(TitleBarStyle::Overlay + 壳侧 setHidden),
//   MacWindowControls 自绘 10px 圆点(悬停整组浮现字形、窗口失焦整组
//   退灰;绿点 ⌥ 点击最大化、否则全屏)。自绘版 2026-08-18 曾退役回原生,
//   2026-08-20 用户「原生太大」再反转——原生尺寸系统私有不可调。渲染
//   位置:App 固定浮在窗口左上(工作台各形态与设置覆盖视图共用一份),
//   mac 不渲染本条;贴角 chrome 的让位见 app.css 净空规则。
// - 拖拽热区铁律:Tauri 按事件目标**自身**的 data-tauri-drag-region 判定,
//   不继承——条内每个可见的非交互子节点都要单独带;交互按钮不许带。
//   带该属性的区域双击 = 切换最大化(Tauri 原生行为,无需自绑)。
import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";

import { inDesktopShell, listen } from "@/lib/ipc/ipc";
import {
  isWindowsShell,
  windowClose,
  windowIsMaximized,
  windowMinimize,
  windowSystemMenu,
  windowToggleFullscreen,
  windowToggleMaximize,
} from "@/lib/ipc/host";

export function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!inDesktopShell()) return;
    let alive = true;
    const refresh = () => {
      void windowIsMaximized().then((v) => {
        if (alive) setMaximized(v);
      });
    };
    refresh();
    const off = listen("tauri://resize", refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return maximized;
}

/** 窗口失焦跟踪:mac 红绿灯失焦整组退灰(原生同款行为)。 */
function useWindowBlurred(): boolean {
  const [blurred, setBlurred] = useState(false);
  useEffect(() => {
    const onFocus = () => setBlurred(false);
    const onBlur = () => setBlurred(true);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return blurred;
}

const CAPTION_GLYPH = { strokeWidth: 1.1, stroke: "currentColor", fill: "none" } as const;

/** 品牌字后的小徽标。文案与含义由产品定,这里只保证它跟着品牌走。 */
const BRAND_BADGE = "work";

/** 品牌组合(字标 + 徽标),侧栏头与 Windows 标题栏共用。
 *  每个可见子节点自带 data-tauri-drag-region(LAYOUT.md §7)。 */
export function Brand() {
  return (
    <>
      <span data-tauri-drag-region="" className="shrink-0 text-xs font-bold tracking-tight text-base-content/80">
        MonkeyCode
      </span>
      <span data-tauri-drag-region="" className="badge badge-soft badge-primary badge-xs shrink-0 font-bold">
        {BRAND_BADGE}
      </span>
    </>
  );
}

/** caption 三键共用皮相:46×全条高(=28px)的**直角通高**块,触到窗口上下边。
 *  与视图头部那排 `btn-ghost btn-square btn-sm` 的圆角内缩胶囊形成形状对比
 *  ——眼睛靠"贴不贴边"分组,不靠间距硬撑(2026-08-08 定案)。 */
// relative --z-window-controls:必须压过 ResizeEdges(--z-resize-edge)。Linux 走 CSD 后窗口内侧
// 补了 8 个透明拉伸热区,其中 NorthEast 的 12×12 **整块落在关闭键内部**、North
// 又吃掉三键顶部 4px(28px 条高的 1/7,而这条刚因用户两次报障从 32 压到 28)。
// 不抬 z 的话:把指针甩到右上角点关闭,窗口不关——原地点击的结果是 WM 起了
// 一次空的 resize 抓取(看起来就是"点了没反应"),按下时指针稍有移动则窗口
// 被拉变形。抬的是**三键自己**而非整条:条上其余部分(拖拽区)顶边照旧可
// 拉伸,只让出三键这 138px。代价是窗口右上角那 12px 的对角拉伸没了——
// 关窗远比从这一个角拉伸常用,右边缘(y>28)与其余三角都还在。
const CAPTION_BTN =
  "relative z-[var(--z-window-controls)] flex h-full w-[46px] cursor-default items-center justify-center text-base-content/70 transition-[background-color,color] duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-base-content";

export function TitleBar({ leading = null }: { leading?: ReactNode } = {}) {
  const { t } = useI18n();
  const maximized = useMaximized();
  // 系统菜单只在 Windows 有(mac 不渲染本条;GTK 侧无对等 API,图标纯展示)
  const sysMenu = (e: ReactMouseEvent) => {
    if (!isWindowsShell()) return;
    e.preventDefault();
    windowSystemMenu();
  };
  return (
    <header
      data-tauri-drag-region=""
      data-window-titlebar=""
      onContextMenu={sysMenu}
      className="flex h-7 shrink-0 items-stretch bg-base-300 select-none"
    >
      {/* 整条单色、无底边线、**除三键外不放品牌/视图信息**(LAYOUT §1 三条
          铁律)。品牌标记曾摆在这条左端(为的是别让窗口左上角空着一块深色
          方格),2026-08-09 挪去 rail 角落格——那格在 Windows/Linux 上本来
          就是空的(它存在的唯一理由是 mac 要在那儿放红绿灯),标记落进去
          两处空档一次填平,这条也回归"只做 chrome"。
          leading = 左端寄宿位(2026-08-20 修订:任务列收起时工作台的
          ☰/新建两颗**功能钮**经 App 的 slot 元素 portal 进来——此前它们
          单开一行 h-10 顶条,用户报障「空了一行,好丑」。铁律拦的是品牌/
          列色/底线这些"冒充 header"的东西,不拦功能 chrome)。
          系统菜单改由**本条右键**唤起:它是标题栏的东西,挂到侧栏图标上会变成
          「双击侧栏图标把应用关了」的陷阱 */}
      {leading}
      <div data-tauri-drag-region="" className="flex-1" />
      <button
        type="button"
        aria-label={t("titlebar.minimize")}
        className={`${CAPTION_BTN} hover:bg-base-content/10 active:bg-base-content/20`}
        onClick={windowMinimize}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" {...CAPTION_GLYPH} aria-hidden>
          <path d="M0 5h10" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
        className={`${CAPTION_BTN} hover:bg-base-content/10 active:bg-base-content/20`}
        onClick={windowToggleMaximize}
      >
        {maximized ? (
          // 还原:双框字形
          <svg width="10" height="10" viewBox="0 0 10 10" {...CAPTION_GLYPH} aria-hidden>
            <path d="M2.5 2.5V.5h7v7h-2" />
            <rect x="0.5" y="2.5" width="7" height="7" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" {...CAPTION_GLYPH} aria-hidden>
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>
      <button
        type="button"
        aria-label={t("titlebar.close")}
        className={`${CAPTION_BTN} hover:bg-caption-close hover:text-caption-close-content active:bg-caption-close active:text-caption-close-content active:brightness-75`}
        onClick={windowClose}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" {...CAPTION_GLYPH} aria-hidden>
          <path d="M0 0l10 10M10 0L0 10" />
        </svg>
      </button>
    </header>
  );
}

// dot 是完整字面量类串(不动态拼,Tailwind 扫描依赖源码文本):
// 本色 → 失焦整组退灰 → 悬停(即使失焦)恢复本色,后者优先级靠书写顺序。
const MAC_LIGHTS = [
  {
    key: "close",
    labelKey: "titlebar.close" as const,
    dot: "bg-mac-close group-data-[blurred]:bg-base-content/20 group-hover:bg-mac-close",
    glyph: <path d="M2 2l4 4M6 2L2 6" />,
  },
  {
    key: "min",
    labelKey: "titlebar.minimize" as const,
    dot: "bg-mac-min group-data-[blurred]:bg-base-content/20 group-hover:bg-mac-min",
    glyph: <path d="M1.5 4h5" />,
  },
  {
    key: "zoom",
    labelKey: "titlebar.zoom" as const,
    dot: "bg-mac-zoom group-data-[blurred]:bg-base-content/20 group-hover:bg-mac-zoom",
    glyph: <path d="M2 5.6V2h3.6M6 2.4V6H2.4" />,
  },
] as const;

export function MacWindowControls({ compact = false }: { compact?: boolean } = {}) {
  const { t } = useI18n();
  const blurred = useWindowBlurred();
  const act = (key: (typeof MAC_LIGHTS)[number]["key"], alt: boolean) => {
    if (key === "close") return windowClose();
    if (key === "min") return windowMinimize();
    // mac 原生行为:绿点默认全屏,⌥ 点击才是最大化
    if (alt) return windowToggleMaximize();
    void windowToggleFullscreen();
  };
  return (
    <div
      data-tauri-drag-region=""
      data-blurred={blurred || undefined}
      className={`group flex items-center ${compact ? "h-full gap-1 px-1.5" : "gap-2 px-3 py-4"}`}
    >
      {MAC_LIGHTS.map((light) => (
        <button
          key={light.key}
          type="button"
          aria-label={t(light.labelKey)}
          /* mac 惯例:窗口按钮不是手型;失焦整组退灰、悬停恢复本色并浮现字形 */
          className="flex h-3.5 w-3.5 cursor-default items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-base-content active:scale-90"
          onClick={(e) => act(light.key, e.altKey)}
        >
          <span
            aria-hidden
            className={`flex h-2.5 w-2.5 items-center justify-center rounded-full text-mac-control-glyph ${light.dot}`}
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 8 8"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
              className="opacity-0 group-hover:opacity-100"
              aria-hidden
            >
              {light.glyph}
            </svg>
          </span>
        </button>
      ))}
    </div>
  );
}
