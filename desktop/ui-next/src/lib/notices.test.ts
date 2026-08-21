import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@/lib/ipc/sessions";
import { noticeForSessionEvent } from "./notices";

const ev = (over: Partial<SessionEvent>): SessionEvent => ({
  type: "session-status",
  id: "s2",
  title: "后台任务",
  ...over,
});

describe("后台会话提醒判定(D3)", () => {
  it("当前会话的事件一律不提醒(用户就在现场)", () => {
    expect(noticeForSessionEvent(ev({ type: "session-ask", open: true }), "s2")).toBeNull();
    expect(noticeForSessionEvent(ev({ status: "idle" }), "s2")).toBeNull();
  });

  it("session-ask:open 置真提醒 warning;置假(别处已答)不提醒", () => {
    expect(noticeForSessionEvent(ev({ type: "session-ask", open: true }), "s1")).toEqual({
      sessionId: "s2",
      title: "后台任务",
      kind: "ask",
    });
    expect(noticeForSessionEvent(ev({ type: "session-ask", open: false }), "s1")).toBeNull();
  });

  it("session-status:idle→done、error→error;中间态不提醒", () => {
    expect(noticeForSessionEvent(ev({ status: "idle" }), "s1")?.kind).toBe("done");
    expect(noticeForSessionEvent(ev({ status: "error" }), "s1")?.kind).toBe("error");
    expect(noticeForSessionEvent(ev({ status: "running" }), "s1")).toBeNull();
  });

  // 壳对顶层会话真的会发这个状态:引擎 turn/stopped 的 stop_reason=="interrupted"
  // (driver/normalize.rs),以及引擎进程死亡后的 reconcile-all 收尾
  // (driver/session.rs)。漏掉它 = 引擎崩溃时后台任务全被打断却一声不吭
  it("session-status:interrupted→已中断(引擎崩溃时后台任务的唯一信号)", () => {
    expect(noticeForSessionEvent(ev({ status: "interrupted" }), "s1")).toEqual({
      sessionId: "s2",
      title: "后台任务",
      kind: "interrupted",
    });
    // 当前会话仍不提醒(用户就在现场,消息流里有 task-error/中断帧)
    expect(noticeForSessionEvent(ev({ status: "interrupted" }), "s2")).toBeNull();
  });

  // finished 只留给子任务(新壳顶层会话正常收尾回 idle):子任务没有列表行,
  // 提醒点开也无处可去 —— 这条不进是对的,别"顺手补齐"
  it("finished 不提醒(子任务专用状态,没有可跳转的列表行)", () => {
    expect(noticeForSessionEvent(ev({ status: "finished" }), "s1")).toBeNull();
  });

  it("session-summary 与用户等待无关,不提醒", () => {
    expect(noticeForSessionEvent(ev({ type: "session-summary", summary: "x" }), "s1")).toBeNull();
  });

  it("未选中任何会话(currentId=null)时,任何会话的事件都算后台", () => {
    expect(noticeForSessionEvent(ev({ status: "error" }), null)?.kind).toBe("error");
  });

  // 分屏沉浸:可见格集合整体替换"当前会话"口径——格里的会话就在眼前,
  // toast 是噪音;currentId 那时**不作数**(它被分屏盖着,不在屏上)
  it("分屏可见集:在格内不提醒,屏外照提醒;currentId 不再豁免", () => {
    const visible = new Set(["s2", "s3"]);
    expect(noticeForSessionEvent(ev({ type: "session-ask", open: true }), "s1", visible)).toBeNull();
    expect(noticeForSessionEvent(ev({ id: "s9", status: "error" }), "s1", visible)?.kind).toBe("error");
    // currentId=s1 被分屏盖住,s1 自己的事件此刻属于"屏外"
    expect(noticeForSessionEvent(ev({ id: "s1", status: "idle" }), "s1", visible)?.kind).toBe("done");
  });
});
