import { afterEach, describe, expect, it, vi } from "vitest";

import { pushEscLayer, resetEscLayersForTest } from "./escLayer";

afterEach(() => resetEscLayersForTest());

const esc = () => {
  const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  const stopped = vi.fn();
  e.stopImmediatePropagation = stopped;
  window.dispatchEvent(e);
  return { event: e, stopped };
};

describe("escLayer", () => {
  it("后入栈的先拿到:浮层压过视图,与注册时序无关", () => {
    const seen: string[] = [];
    // 视图级先注册(挂载即注册),浮层后注册(打开才注册)——旧写法下
    // 视图必赢,正是「开着下拉按 Esc 关掉整个设置页」的成因
    pushEscLayer(() => {
      seen.push("view");
      return true;
    });
    pushEscLayer(() => {
      seen.push("popover");
      return true;
    });
    esc();
    expect(seen).toEqual(["popover"]);
  });

  it("上层返回 false = 在场但放行,继续问下一层", () => {
    const seen: string[] = [];
    pushEscLayer(() => {
      seen.push("view");
      return true;
    });
    pushEscLayer(() => {
      seen.push("passthrough");
      return false;
    });
    esc();
    expect(seen).toEqual(["passthrough", "view"]);
  });

  it("有人消费即截断事件链(审批热键挂冒泡,绝不双消费)", () => {
    pushEscLayer(() => true);
    const { event, stopped } = esc();
    expect(stopped).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("无人消费时不动事件:Esc 照常落到下层(冒泡阶段的审批 deny)", () => {
    pushEscLayer(() => false);
    const { event, stopped } = esc();
    expect(stopped).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("出栈后不再参与派发;重复出栈无害", () => {
    const seen: string[] = [];
    pushEscLayer(() => {
      seen.push("view");
      return true;
    });
    const pop = pushEscLayer(() => {
      seen.push("popover");
      return true;
    });
    pop();
    pop();
    esc();
    expect(seen).toEqual(["view"]);
  });

  it("只认 Escape,别的键一概不拦", () => {
    const handler = vi.fn(() => true);
    pushEscLayer(handler);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("IME 组合中的 Escape 留给输入法", () => {
    const handler = vi.fn(() => true);
    pushEscLayer(handler);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
  });
});
