// Linux 无边框窗口的边缘拉伸热区(LAYOUT §8.1 豁免:daisyUI 无对应形态)。
//
// 壳在 Linux 走 decorations(false) 之后,WM 画的那圈 resize 边随装饰栏一起
// 没了——窗口从此拉不动。这里在窗口内侧补 8 个透明热区(4 边 4px / 4 角
// 12px),按下即把拖拽交给壳(plugin:window|start_resize_dragging → X11 的
// _NET_WM_MOVERESIZE),几何全归 WM 算,UI 侧不跟踪指针。
//
// 只在 Linux 渲染:Windows 的无边框 resize 由 tao 自己处理(它在
// WM_NCHITTEST 里给无装饰窗口返回 HTTOP/HTLEFT 等,见 tao 的
// platform_impl/windows/event_loop.rs);mac 走 Overlay 保留原生窗体边。
//
// 最大化时不渲染:热区贴着屏幕边,最大化后那几像素正是用户去够任务栏/
// 顶栏的必经之路,留着只会误触。
import { useI18n } from "@/lib/i18n";
import { isLinuxShell, windowStartResize, type ResizeDirection } from "@/lib/ipc/host";

import { useMaximized } from "./TitleBar";

/** 边 4px(h-1/w-1)、角 12px(size-3);边用 inset-*-3 让开角,免得两者叠在
 *  一起时方向取到错的那个。 */
const EDGES: ReadonlyArray<{ dir: ResizeDirection; cls: string }> = [
  { dir: "North", cls: "top-0 inset-x-3 h-1 cursor-n-resize" },
  { dir: "South", cls: "bottom-0 inset-x-3 h-1 cursor-s-resize" },
  { dir: "West", cls: "left-0 inset-y-3 w-1 cursor-w-resize" },
  { dir: "East", cls: "right-0 inset-y-3 w-1 cursor-e-resize" },
  { dir: "NorthWest", cls: "top-0 left-0 size-3 cursor-nw-resize" },
  { dir: "NorthEast", cls: "top-0 right-0 size-3 cursor-ne-resize" },
  { dir: "SouthWest", cls: "bottom-0 left-0 size-3 cursor-sw-resize" },
  { dir: "SouthEast", cls: "bottom-0 right-0 size-3 cursor-se-resize" },
];

export function ResizeEdges() {
  const { t } = useI18n();
  const maximized = useMaximized();
  if (!isLinuxShell() || maximized) return null;
  return (
    <div aria-hidden data-resize-edges="" role="presentation">
      {EDGES.map(({ dir, cls }) => (
        <div
          key={dir}
          title={t("titlebar.resize")}
          // z 必须压过 **daisyUI 模态**:.modal 写死 z-index:999(modal.css),
          // 原先的 z-60 沉在它之下——Linux 上点开图片灯箱/子会话回放/未保存
          // 确认期间,左右下三条边与左下右下两角热区被遮罩完全盖住,拖不动
          // 窗口,按下去反而把刚打开的弹层关了(命中落到 .modal-backdrop)。
          // 顶边与左上右上角因模态从 --chrome-h 起而幸存,所以只坏一半、更难发现。
          // 唯一压在它之上的是 caption 三键(--z-window-controls,见 TitleBar.CAPTION_BTN):
          // 那处重叠必须让按钮赢,否则右上角点不了关闭。
          className={`fixed z-[var(--z-resize-edge)] ${cls}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            windowStartResize(dir);
          }}
        />
      ))}
    </div>
  );
}
