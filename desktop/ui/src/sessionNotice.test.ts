import { describe, expect, it } from "vitest";

import { noticeForSessionEvent } from "./sessionNotice";

describe("noticeForSessionEvent", () => {
  it("本轮正常结束只提示已回复，不宣称整个任务完成", () => {
    expect(noticeForSessionEvent({ type: "session-status", id: "idle", title: "继续优化", status: "idle" })).toEqual({
      text: "「继续优化」已回复",
      tone: "success",
      targetSessionId: "idle",
    });
  });

  it("按后台会话状态生成不同颜色并携带跳转目标", () => {
    expect(noticeForSessionEvent({ type: "session-status", id: "done", title: "完成任务", status: "finished" })).toEqual({
      text: "「完成任务」已完成",
      tone: "success",
      targetSessionId: "done",
    });
    expect(noticeForSessionEvent({ type: "session-status", id: "bad", title: "失败任务", status: "error" })?.tone).toBe("error");
    expect(noticeForSessionEvent({ type: "session-status", id: "stop", title: "中断任务", status: "interrupted" })?.tone).toBe("warning");
  });

  it("等待审批使用警示色，运行中和审批关闭不提示", () => {
    expect(noticeForSessionEvent({ type: "session-ask", id: "ask", title: "审批任务", open: true })).toEqual({
      text: "「审批任务」等待权限审批",
      tone: "warning",
      targetSessionId: "ask",
    });
    expect(noticeForSessionEvent({ type: "session-ask", id: "ask", title: "审批任务", open: false })).toBeNull();
    expect(noticeForSessionEvent({ type: "session-status", id: "run", title: "运行任务", status: "running" })).toBeNull();
  });

  it("摘要更新不提示:它在轮次收尾之后异步到达,提示会与「已回复」重复", () => {
    expect(
      noticeForSessionEvent({ type: "session-summary", id: "sum", title: "运行任务", summary: "修复登录流程" }),
    ).toBeNull();
  });
});
