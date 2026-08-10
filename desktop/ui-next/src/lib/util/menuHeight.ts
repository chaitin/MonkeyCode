// 向上弹出菜单的可用高度(composer 上方的模型/思考档/云端配置菜单)。
//
// 为什么不能写死上限:固定 max-h 在矮窗口下会把菜单顶出视口——菜单从
// composer 向上长,窗口一矮,上沿就越过视图头部甚至标题栏(2026-08-07 对表
// 旧 UI menuPosition 补回)。边界要按**真实 DOM 位置**算,因为它随平台与
// 视图变:Windows 自绘标题栏 36px、各视图 h-13 头部、mac 红绿灯预留区,
// 硬编码任何一个都会在别的组合下失准。
import { useLayoutEffect, useRef, useState } from "react";

/** 菜单上沿与边界之间留的视觉间距(触发器上弹时菜单底边约在 anchorTop-6)。 */
const MENU_EDGE_GAP = 16;

/** 纯几何:锚点顶 - 边界底 - 间距,再夹到 [0, cap]。分出来是为了可单测。 */
export function upwardMenuMaxHeight(anchorTop: number, boundaryBottom: number, cap: number): number {
  return Math.max(0, Math.min(cap, Math.floor(anchorTop - boundaryBottom - MENU_EDGE_GAP)));
}

/** 边界候选:窗体标题栏 / 视图头部 / 显式标注的边界。取**锚点之上最低的
 *  那条**——多层 chrome 叠着时,只有最靠下的那条才是真正的天花板。 */
const BOUNDARY_SELECTOR = "[data-window-titlebar], [data-view-header], [data-menu-boundary]";

/** 返回挂在触发器上的 ref 与算好的菜单最大高度(px)。
 *  open=false 时不测量(菜单没渲染,量了也没用),保持上一次的值即可。 */
export function useUpwardMenuHeight<T extends HTMLElement>(open: boolean, cap = 288) {
  const anchorRef = useRef<T>(null);
  const [maxHeight, setMaxHeight] = useState(cap);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const anchorTop = anchor.getBoundingClientRect().top;
      let boundaryBottom = MENU_EDGE_GAP;
      for (const node of document.querySelectorAll<HTMLElement>(BOUNDARY_SELECTOR)) {
        const bottom = node.getBoundingClientRect().bottom;
        if (bottom <= anchorTop && bottom > boundaryBottom) boundaryBottom = bottom;
      }
      setMaxHeight(upwardMenuMaxHeight(anchorTop, boundaryBottom, cap));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, cap]);

  return { anchorRef, maxHeight };
}
