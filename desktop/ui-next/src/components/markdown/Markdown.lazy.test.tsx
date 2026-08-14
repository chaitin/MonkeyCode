// 视口懒渲染(Markdown.tsx::useNearViewport)的行为契约。独立成文件:
// 组件模块里的共享 IntersectionObserver 是懒建单例,一旦在假 IO 环境下建出
// 就贯穿整个模块生命周期——混进 Markdown.test.tsx 会把依赖「无 IO 同步回退」
// 的既有用例整体拖进懒路径。vitest 按文件隔离模块注册表,这里自成一世界。
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Markdown } from "./Markdown";

// 假 IO:记录 observe 目标,由用例手动宣布「进入视口」
let observed: Element[] = [];
let ioCallback: IntersectionObserverCallback | null = null;

class FakeIO {
  constructor(cb: IntersectionObserverCallback) {
    ioCallback = cb;
  }
  observe(el: Element) {
    observed.push(el);
  }
  unobserve(el: Element) {
    observed = observed.filter((e) => e !== el);
  }
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", FakeIO);

const enter = (els: Element[]) => {
  act(() => {
    ioCallback?.(
      els.map((target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry),
      null as unknown as IntersectionObserver,
    );
  });
};

afterEach(() => {
  observed = [];
});

describe("Markdown 视口懒渲染", () => {
  it("视口外先渲原文占位(不解析),进入预热带后升格为解析产物", () => {
    const { container } = render(<Markdown source={"**加粗**正文"} />);
    // 占位 = 原文字面量:没有 strong,星号可见
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("**加粗**");
    enter([...observed]);
    expect(container.querySelector("strong")?.textContent).toBe("加粗");
    expect(container.textContent).not.toContain("**");
  });

  it("消息流内观察的是所在虚拟行，不是正文内部节点", () => {
    const { container } = render(
      <div data-chat-items="">
        <div data-row="">
          <div>
            <Markdown source={"**行内**"} />
          </div>
        </div>
      </div>,
    );
    const row = container.querySelector("[data-row]")!;
    // 行盒是窗口测量与预热的共同边界，必须锚在它上面(见组件头注)
    expect(observed).toContain(row);
    expect(observed).not.toContain(container.querySelector(".md"));
    enter([row]);
    expect(container.querySelector("strong")?.textContent).toBe("行内");
  });

  it("未进入视口不升格;卸载后退订观察", () => {
    const { container, unmount } = render(<Markdown source={"**待命**"} />);
    ioCallback?.([], null as unknown as IntersectionObserver);
    expect(container.querySelector("strong")).toBeNull();
    unmount();
    expect(observed).toHaveLength(0);
  });
});
