// DetailModal 是工具详情/子会话回放/快捷键表共用的模态原语:在场期间必须
// 令原生预览避让(原生 webview 画在所有 DOM 之上,不避让模态就被截断)。
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { nativeObscured } from "@/lib/util/nativeObscure";
import { DetailModal } from "./DetailModal";

describe("DetailModal", () => {
  it("在场即置原生预览遮挡信号,卸载释放", () => {
    expect(nativeObscured()).toBe(false);
    const view = render(
      <DetailModal ariaLabel="详情" title="标题" onClose={() => {}}>
        <div>正文</div>
      </DetailModal>,
    );
    expect(nativeObscured()).toBe(true);
    view.unmount();
    expect(nativeObscured()).toBe(false);
  });
});
