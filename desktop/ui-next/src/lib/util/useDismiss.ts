// 浮层(受控 dropdown)关闭胶水:pointerdown 落在容器外 → 关;Esc 走
// lib/util/escLayer 的层栈(浮层 open 时入栈,后开的先拿到)。
// 为什么不用 onBlur + relatedTarget:壳内核 WebKitGTK 与 Safari 同源,点击
// 按钮不把焦点给按钮——focusout 的 relatedTarget 恒为 null,「焦点移出即
// 收起」在 mousedown 阶段就误关浮层,click 因内容卸载而丢失(思考菜单
// 弹不出、模型菜单点来源 tab 即消失的根因)。pointerdown 判定不依赖焦点
// 语义,各内核一致。
// Esc 为什么不再自己挂 window capture(2026-08-09):同 target 同阶段按注册
// 先后触发,而视图级 Esc 挂载即注册、浮层只在打开时注册,于是永远是视图
// 先吃掉——开着下拉按 Esc 关掉的是整个设置页。见 escLayer 头注。
import { useEffect, type RefObject } from "react";

import { pushEscLayer } from "./escLayer";

export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const box = ref.current;
      if (box && e.target instanceof Node && box.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    const popEsc = pushEscLayer(() => {
      onClose();
      return true;
    });
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      popEsc();
    };
    // onClose 是稳定的 setState 包装(调用方保证),不追函数身份
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ref]);
}
