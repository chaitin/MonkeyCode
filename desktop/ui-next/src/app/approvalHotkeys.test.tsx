// useApprovalHotkeys 的 enabled 门控(分屏多格并存的命门):window 级
// keydown 按实例注册,不门控的话一次 ⏎ 会把每个格子的待审批一起应答,
// 而"允许"不可撤销。判定纯函数已有表驱动测试(shortcuts.test.ts),
// 这里只钉"谁在听"。.tsx 归 dom 工程(unit 工程无 DOM,挂不了 window)。
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatState } from "@/lib/protocol/types";
import { useApprovalHotkeys } from "./shortcuts";

const sent: Array<{ sid: string; id: string; answer: string }> = [];
vi.mock("@/lib/ipc/approvals", () => ({
  localFrameSender: (sid: string) => sid,
  sendPermAnswerVia: (sender: string, id: string, answer: string) => {
    sent.push({ sid: sender, id, answer });
    return Promise.resolve(true);
  },
}));

/** 只造 openPermIdOf 消费的最小面(items 尾部一张待答复审批卡)。 */
const stateWithPerm = (id: string) =>
  ({ items: [{ kind: "perm", state: "open", id }] }) as unknown as ChatState;

const press = (key: string) =>
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

afterEach(() => {
  sent.length = 0;
});

describe("useApprovalHotkeys enabled 门控", () => {
  it("两实例并存(分屏双格各有待审批):⏎ 只落到 enabled 的那格", () => {
    const focused = renderHook(() => useApprovalHotkeys(stateWithPerm("p1"), "s1", undefined, true));
    const blurred = renderHook(() => useApprovalHotkeys(stateWithPerm("p2"), "s2", undefined, false));
    press("Enter");
    expect(sent).toEqual([{ sid: "s1", id: "p1", answer: "allow" }]);
    focused.unmount();
    blurred.unmount();
  });

  it("焦点切换(enabled 翻面)后监听跟着走", () => {
    const hook = renderHook(({ on }) => useApprovalHotkeys(stateWithPerm("p1"), "s1", undefined, on), {
      initialProps: { on: false },
    });
    press("Enter");
    expect(sent).toEqual([]);
    hook.rerender({ on: true });
    press("Enter");
    expect(sent).toEqual([{ sid: "s1", id: "p1", answer: "allow" }]);
    hook.unmount();
  });

  it("缺省 enabled=true:单会话视图行为不变(esc = 拒绝)", () => {
    const hook = renderHook(() => useApprovalHotkeys(stateWithPerm("p1"), "s1"));
    press("Escape");
    expect(sent).toEqual([{ sid: "s1", id: "p1", answer: "deny" }]);
    hook.unmount();
  });
});
