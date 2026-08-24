// Esc 分层:全应用**唯一**一条 window capture 监听,按后进先出派发给最上层。
//
// 为什么要收口(2026-08-09):此前每个消费者各自 `window.addEventListener(
// "keydown", h, true)` + `stopImmediatePropagation()`,同 target 同阶段的监听
// **按注册先后触发**——而视图级 Esc(设置页/新建任务)在挂载时就注册,浮层
// (useDismiss)只在打开时才注册,于是永远是视图先吃掉这一下:开着下拉按 Esc
// 关掉的是整个设置页,草稿一起没。谁先注册取决于挂载时序,不是语义,任何
// "在正确的地方加一条 addEventListener" 都修不了它。
//
// 收口后语义由**层序**决定而非注册时序:后 push 的(= 后打开的浮层)先拿到。
// handler 返回 true 表示已消费,此时截断整条链(preventDefault +
// stopImmediatePropagation);返回 false 表示放行,继续问下一层。
//
// 与审批热键的关系不变:app/shortcuts.ts 的 esc=deny 挂在**冒泡**阶段,只有
// 本模块没人消费时才轮得到它——Esc 绝不会"关浮层 + 拒绝审批"双消费。
import { useEffect } from "react";

/** 返回 true = 这一下 Esc 归我,链路就此截断。 */
export type EscHandler = () => boolean;

const stack: EscHandler[] = [];
let installed = false;

function onKey(e: KeyboardEvent): void {
  // 组合输入期间 Esc 属于候选词/输入法，不得顺手关闭浮层。
  if (e.key !== "Escape" || e.isComposing) return;
  // 自顶向下:上层可以"在场但放行"(如视图层让位给自己开着的浮层)
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]!()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
  }
}

/** 命令式入栈(非 React 场景,如 lib/contextMenu);返回出栈函数。 */
export function pushEscLayer(handler: EscHandler): () => void {
  if (!installed) {
    window.addEventListener("keydown", onKey, true);
    installed = true;
  }
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** React 绑定:active 为真时占一层。handler 用 ref 读最新闭包由调用方保证
 *  (与 useDismiss 同口径:传稳定的 setState 包装,或自己 useCallback)。 */
export function useEscLayer(active: boolean, handler: EscHandler): void {
  useEffect(() => {
    if (!active) return;
    return pushEscLayer(handler);
  }, [active, handler]);
}

/** 测试用:清空层栈(模块级状态跨用例会串)。 */
export function resetEscLayersForTest(): void {
  stack.length = 0;
}
