import { useLayoutEffect, useRef, useState } from "react";

// 触发器上弹时菜单底边约在 anchorTop - 6px；这里再预留 10px 视觉间距。
const MENU_EDGE_GAP = 16;

/** 向上弹出的菜单可用高度：上沿不能越过窗口标题栏或当前视图 header。 */
export function upwardMenuMaxHeight(anchorTop: number, boundaryBottom: number, cap: number): number {
  const available = Math.floor(anchorTop - boundaryBottom - MENU_EDGE_GAP);
  return Math.max(0, Math.min(cap, available));
}

/**
 * 根据触发器与顶部镶边的真实 DOM 位置限制向上弹窗。
 * 固定像素上限在矮窗口、Windows 自绘标题栏下会越过 header；几何计算同时
 * 覆盖标题栏、ViewHeader 与 macOS 红绿灯预留区带来的位置变化。
 */
export function useUpwardMenuHeight<T extends HTMLElement>(open: boolean, cap = 360) {
  const anchorRef = useRef<T>(null);
  const [menuMaxHeight, setMenuMaxHeight] = useState(cap);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const anchorTop = anchor.getBoundingClientRect().top;
      let boundaryBottom = MENU_EDGE_GAP;
      document.querySelectorAll<HTMLElement>("[data-window-titlebar], [data-view-header], [data-menu-boundary]").forEach((node) => {
        const bottom = node.getBoundingClientRect().bottom;
        if (bottom <= anchorTop && bottom > boundaryBottom) boundaryBottom = bottom;
      });
      setMenuMaxHeight(upwardMenuMaxHeight(anchorTop, boundaryBottom, cap));
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, cap]);

  return { anchorRef, menuMaxHeight };
}
