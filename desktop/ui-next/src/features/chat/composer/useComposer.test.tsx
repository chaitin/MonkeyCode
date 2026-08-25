import { act, renderHook, waitFor } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { b64decode } from "@/lib/protocol/codec";
import {
  ackSteering,
  claimSteering,
  createSendQueueItem,
  emptySendQueueLane,
  enqueue,
  localSendQueueTarget,
  pausePending,
  readSendQueueLane,
  resetSendQueueMemoryForTests,
  writeSendQueueLane,
} from "./sendQueue";
import { resetStashForTests, stashGet } from "./stash";
import { useComposer, type ComposerFeed } from "./useComposer";

interface Call {
  cmd: string;
  args?: Record<string, unknown>;
}

function stubShell(impl: (cmd: string, args?: Record<string, unknown>) => unknown = () => null) {
  const calls: Call[] = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        try {
          return Promise.resolve(impl(cmd, args));
        } catch (error) {
          return Promise.reject(error);
        }
      },
    },
  };
  return calls;
}

const feed = (over: Partial<ComposerFeed> = {}): ComposerFeed => ({
  running: false,
  historyLoaded: true,
  lastSeq: 0,
  lastTurnStartSeq: 0,
  lastTerminalSeq: 0,
  steerConfirmations: {},
  ...over,
});
const settle = () => act(async () => void (await Promise.resolve()));
const sends = (calls: Call[]) => calls.filter((call) => call.cmd === "session_send");
const sentText = (call: Call) => b64decode(String((call.args?.payload as { content?: string } | undefined)?.content ?? ""));

function queueTexts(id: string) {
  return readSendQueueLane(localSendQueueTarget(id)).pending.map((item) => item.content);
}

beforeEach(() => {
  localStorage.clear();
  resetSendQueueMemoryForTests();
  resetStashForTests();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useComposer 本地持久 lane", () => {
  it("运行中连续提交三条按 FIFO 追加，不覆盖并清空草稿", () => {
    stubShell();
    const { result } = renderHook(() => useComposer("a", feed({ running: true })));

    for (const text of ["第一条", "第二条", "第三条"]) {
      act(() => result.current.setDraft(text));
      act(() => expect(result.current.send()).toBe(true));
      expect(result.current.draft).toBe("");
    }

    expect(result.current.queue.pending.map((item) => item.content)).toEqual(["第一条", "第二条", "第三条"]);
    expect(queueTexts("a")).toEqual(["第一条", "第二条", "第三条"]);
  });

  it("能力查询撞重启闸门时退避重试，前两次 reject 后恢复 steering", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const calls = stubShell((cmd) => {
      if (cmd !== "engine_caps") return null;
      attempts += 1;
      if (attempts <= 2) throw new Error("engine applying");
      return { steering: true };
    });

    const { result } = renderHook(() => useComposer("a", feed()));
    await act(async () => void (await Promise.resolve()));
    expect(result.current.steeringSupported).toBe(false);
    expect(attempts).toBe(1);

    await act(async () => void (await vi.advanceTimersByTimeAsync(80)));
    expect(result.current.steeringSupported).toBe(false);
    expect(attempts).toBe(2);

    await act(async () => void (await vi.advanceTimersByTimeAsync(160)));
    expect(result.current.steeringSupported).toBe(true);
    expect(attempts).toBe(3);
    expect(calls.filter((call) => call.cmd === "engine_caps")).toHaveLength(3);
  });

  it("steering claim 先持久化并携带 client_id；ACK 隐藏但 confirmed 才清 outbox", async () => {
    let resolveSteer: () => void = () => {};
    const pendingSteer = new Promise<void>((resolve) => (resolveSteer = resolve));
    const calls = stubShell((cmd, args) => {
      if (cmd === "engine_caps") return { steering: true };
      if (cmd === "session_call" && args?.kind === "session_steer") return pendingSteer;
      if (cmd === "upload_file_path") return { path: ".monkeycode/uploads/a.png" };
      return null;
    });
    const { result, rerender } = renderHook(
      ({ running, confirmations }: { running: boolean; confirmations: ComposerFeed["steerConfirmations"] }) =>
        useComposer("a", feed({ running, steerConfirmations: confirmations })),
      { initialProps: { running: true, confirmations: {} as ComposerFeed["steerConfirmations"] } },
    );
    await waitFor(() => expect(result.current.steeringSupported).toBe(true));
    await act(() => result.current.addPaths([".monkeycode/uploads/a.png"]));
    act(() => result.current.setDraft("  补充正文  "));
    act(() => result.current.send());
    const id = result.current.queue.pending[0]!.id;

    act(() => result.current.steerQueued(id));
    expect(result.current.queue.pending).toEqual([]);
    expect(result.current.queue.steering?.[0]).toMatchObject({ item: { id }, phase: "dispatching" });
    expect(JSON.parse(localStorage.getItem("mc.sendQueue.v1.local.a") ?? "null").steering[0]).toMatchObject({
      item: { id }, phase: "dispatching",
    });
    const call = calls.find((entry) => entry.cmd === "session_call" && entry.args?.kind === "session_steer")!;
    const payload = call.args?.payload as { content?: string; client_id?: string };
    expect(payload.client_id).toBe(id);
    expect(b64decode(String(payload.content))).toBe("补充正文\n[图片] .monkeycode/uploads/a.png");

    rerender({ running: true, confirmations: {} });
    await settle();
    expect(sends(calls)).toHaveLength(0);
    expect(result.current.steeringId).toBe(id);

    await act(async () => {
      resolveSteer();
      await pendingSteer;
    });
    await waitFor(() => expect(result.current.steeringId).toBeNull());
    expect(result.current.queue.steering?.[0]).toMatchObject({ item: { id }, phase: "acked" });
    expect(JSON.parse(localStorage.getItem("mc.sendQueue.v1.local.a") ?? "null").steering[0].phase).toBe("acked");

    rerender({ running: true, confirmations: { [id]: 12 } });
    await waitFor(() => expect(result.current.queue.steering).toEqual([]));
    // 同 client_id 换批重放仍幂等。
    rerender({ running: true, confirmations: { [id]: 13 } });
    expect(result.current.queue.steering).toEqual([]);
    expect(sends(calls)).toHaveLength(0);
  });

  it("同一归约批次的两个 confirmed 分别清除两条 acked outbox", async () => {
    const target = localSendQueueTarget("a");
    const a = createSendQueueItem("补充 A", [], { id: "client-a", createdAt: 1 });
    const b = createSendQueueItem("补充 B", [], { id: "client-b", createdAt: 2 });
    let lane = enqueue(enqueue(emptySendQueueLane(), a), b);
    lane = ackSteering(claimSteering(lane, a.id, 10), a.id);
    lane = ackSteering(claimSteering(lane, b.id, 11), b.id);
    writeSendQueueLane(target, lane);

    stubShell((cmd) => cmd === "engine_caps" ? { steering: true } : null);
    const { result } = renderHook(() =>
      useComposer("a", feed({ running: false, steerConfirmations: { "client-a": 41, "client-b": 42 } })),
    );
    await waitFor(() => expect(result.current.queue.steering).toEqual([]));
    expect(JSON.parse(localStorage.getItem("mc.sendQueue.v1.local.a") ?? "null").steering).toEqual([]);
  });

  it("迟到 steering 确认清空 outbox 后释放空取消屏障", async () => {
    const target = localSendQueueTarget("a");
    const item = createSendQueueItem("迟到确认", [], { id: "late-steering", createdAt: 1 });
    let lane = ackSteering(claimSteering(enqueue(emptySendQueueLane(), item), item.id, 10), item.id);
    lane = pausePending(lane, 11);
    writeSendQueueLane(target, lane);

    stubShell((cmd) => cmd === "engine_caps" ? { steering: true } : null);
    const { result, rerender } = renderHook(
      ({ confirmations }) => useComposer("a", feed({ running: false, steerConfirmations: confirmations })),
      { initialProps: { confirmations: {} as ComposerFeed["steerConfirmations"] } },
    );
    await waitFor(() => expect(result.current.queue.steering?.[0]?.phase).toBe("uncertain"));
    expect(result.current.queue.blocked?.code).toBe("user-paused");

    rerender({ confirmations: { [item.id]: 30 } });
    await waitFor(() => expect(result.current.queue.steering).toEqual([]));
    await waitFor(() => expect(result.current.queue.blocked).toBeNull());
  });

  it("ACK 后 task end 无 confirmed 转 uncertain，并阻止后续 pending 自动越过", async () => {
    const calls = stubShell((cmd) => {
      if (cmd === "engine_caps") return { steering: true };
      return null;
    });
    const { result, rerender } = renderHook(
      ({ running, confirmations }) => useComposer("a", feed({ running, steerConfirmations: confirmations })),
      { initialProps: { running: true, confirmations: {} as Record<string, number> } },
    );
    await waitFor(() => expect(result.current.steeringSupported).toBe(true));
    act(() => result.current.setDraft("已 ACK 的补充"));
    act(() => result.current.send());
    const id = result.current.queue.pending[0]!.id;
    act(() => result.current.steerQueued(id));
    await waitFor(() => expect(result.current.queue.steering?.[0]?.phase).toBe("acked"));

    act(() => result.current.setDraft("不能越过的不同行消息"));
    act(() => result.current.send());
    rerender({ running: false, confirmations: {} });
    await waitFor(() => expect(result.current.queue.steering?.[0]?.phase).toBe("uncertain"));
    expect(result.current.queue.pending.map((item) => item.content)).toEqual(["不能越过的不同行消息"]);
    expect(sends(calls)).toHaveLength(0);

    rerender({ running: false, confirmations: { [id]: 30 } });
    await waitFor(() => expect(result.current.queue.steering).toEqual([]));
  });

  it("steering 失败保留原项并外显错误", async () => {
    let rejectSteer: (error: Error) => void = () => {};
    const pendingSteer = new Promise<void>((_, reject) => (rejectSteer = reject));
    stubShell((cmd, args) => {
      if (cmd === "engine_caps") return { steering: true };
      if (cmd === "session_call" && args?.kind === "session_steer") return pendingSteer;
      return null;
    });
    const { result } = renderHook(() => useComposer("a", feed({ running: true })));
    await waitFor(() => expect(result.current.steeringSupported).toBe(true));
    act(() => result.current.setDraft("不能丢"));
    act(() => result.current.send());
    const id = result.current.queue.pending[0]!.id;
    act(() => result.current.steerQueued(id));

    await act(async () => rejectSteer(new Error("runtime busy")));
    expect(result.current.steeringId).toBeNull();
    expect(result.current.queue.pending[0]?.id).toBe(id);
    expect(result.current.error).toContain("runtime busy");
  });

  it("clear during dispatching + RPC failure 不恢复也不普通发送", async () => {
    let rejectSteer: (error: Error) => void = () => {};
    const pendingSteer = new Promise<void>((_, reject) => (rejectSteer = reject));
    const calls = stubShell((cmd, args) => {
      if (cmd === "engine_caps") return { steering: true };
      if (cmd === "session_call" && args?.kind === "session_steer") return pendingSteer;
      return null;
    });
    const { result, rerender } = renderHook(({ running }) => useComposer("a", feed({ running })), {
      initialProps: { running: true },
    });
    await waitFor(() => expect(result.current.steeringSupported).toBe(true));
    act(() => result.current.setDraft("清空后绝不能回来"));
    act(() => result.current.send());
    const id = result.current.queue.pending[0]!.id;
    act(() => result.current.steerQueued(id));
    act(() => result.current.clearQueue());
    expect(result.current.queue.steering?.[0]).toMatchObject({ item: { id }, discardRequested: true });

    await act(async () => rejectSteer(new Error("agent stopped")));
    expect(result.current.queue.pending).toEqual([]);
    expect(result.current.queue.steering).toEqual([]);
    rerender({ running: false });
    await settle();
    expect(sends(calls)).toHaveLength(0);
  });

  it("idle 重挂把 durable dispatching 外显为 uncertain，ACK 后仍不普通重复发送", async () => {
    let resolveSteer: () => void = () => {};
    const pendingSteer = new Promise<void>((resolve) => (resolveSteer = resolve));
    const calls = stubShell((cmd, args) => {
      if (cmd === "engine_caps") return { steering: true };
      if (cmd === "session_call" && args?.kind === "session_steer") return pendingSteer;
      return null;
    });
    const first = renderHook(() => useComposer("a", feed({ running: true })));
    await waitFor(() => expect(first.result.current.steeringSupported).toBe(true));
    act(() => first.result.current.setDraft("只插入一次"));
    act(() => first.result.current.send());
    const id = first.result.current.queue.pending[0]!.id;
    act(() => first.result.current.steerQueued(id));
    first.unmount();

    const second = renderHook(
      ({ running, confirmations }) => useComposer("a", feed({ running, steerConfirmations: confirmations })),
      { initialProps: { running: false, confirmations: {} as Record<string, number> } },
    );
    await waitFor(() => expect(second.result.current.queue.steering?.[0]?.phase).toBe("uncertain"));
    expect(second.result.current.steeringId).toBeNull();
    expect(sends(calls)).toHaveLength(0);

    await act(async () => {
      resolveSteer();
      await pendingSteer;
    });
    // ACK 回调不能把 idle 时已外显的不确定项重新隐藏。
    expect(second.result.current.queue.steering?.[0]?.phase).toBe("uncertain");
    second.rerender({ running: true, confirmations: {} });
    second.rerender({ running: false, confirmations: {} });
    await settle();
    expect(second.result.current.queue.pending).toEqual([]);
    expect(second.result.current.queue.steering?.[0]).toMatchObject({ item: { id }, phase: "uncertain" });
    expect(sends(calls)).toHaveLength(0);
    second.rerender({ running: false, confirmations: { [id]: 20 } });
    await waitFor(() => expect(second.result.current.queue.steering).toEqual([]));
  });

  it("steering 迟到 ACK 只更新 original target/id", async () => {
    let resolveSteer: () => void = () => {};
    const pendingSteer = new Promise<void>((resolve) => (resolveSteer = resolve));
    stubShell((cmd, args) => {
      if (cmd === "engine_caps") return { steering: true };
      if (cmd === "session_call" && args?.kind === "session_steer") return pendingSteer;
      return null;
    });
    const { result, rerender } = renderHook(({ id }) => useComposer(id, feed({ running: true })), {
      initialProps: { id: "a" },
    });
    await waitFor(() => expect(result.current.steeringSupported).toBe(true));
    act(() => result.current.setDraft("A 补充"));
    act(() => result.current.send());
    const steeringId = result.current.queue.pending[0]!.id;
    act(() => result.current.steerQueued(steeringId));

    rerender({ id: "b" });
    act(() => result.current.setDraft("B 保留"));
    act(() => result.current.send());
    await act(async () => {
      resolveSteer();
      await pendingSteer;
    });

    expect(queueTexts("a")).toEqual([]);
    expect(readSendQueueLane(localSendQueueTarget("a")).steering?.[0]).toMatchObject({
      item: { id: steeringId }, phase: "acked",
    });
    expect(queueTexts("b")).toEqual(["B 保留"]);
    expect(result.current.queue.pending.map((item) => item.content)).toEqual(["B 保留"]);
  });

  it("队列按会话隔离，草稿/当前附件仍只由 stash 恢复", () => {
    stubShell();
    const { result, rerender } = renderHook(({ id }) => useComposer(id, feed({ running: true })), {
      initialProps: { id: "a" },
    });
    act(() => result.current.setDraft("给 A 排队"));
    act(() => result.current.send());
    act(() => result.current.setDraft("A 草稿"));

    rerender({ id: "b" });
    expect(result.current.draft).toBe("");
    expect(result.current.queue.pending).toHaveLength(0);
    act(() => result.current.setDraft("给 B 排队"));
    act(() => result.current.send());

    rerender({ id: "a" });
    expect(result.current.draft).toBe("A 草稿");
    expect(result.current.queue.pending.map((item) => item.content)).toEqual(["给 A 排队"]);
    expect(queueTexts("b")).toEqual(["给 B 排队"]);
  });

  it("入队结构化绑定附件并立即清附件，附件行仅在投递时生成", async () => {
    const calls = stubShell((cmd, args) => {
      if (cmd === "upload_file_path") return { path: String(args?.path ?? ".monkeycode/uploads/a.png") };
      return null;
    });
    const { result, rerender } = renderHook(({ running }) => useComposer("a", feed({ running })), {
      initialProps: { running: true },
    });
    await act(() => result.current.addPaths([".monkeycode/uploads/a.png"]));
    act(() => result.current.setDraft("看图"));
    act(() => result.current.send());

    expect(result.current.atts).toEqual([]);
    expect(result.current.queue.pending[0]).toMatchObject({
      content: "看图",
      attachments: [{ path: ".monkeycode/uploads/a.png", isImage: true }],
    });
    expect(result.current.queue.pending[0]?.content).not.toContain("[图片]");

    rerender({ running: false });
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    expect(sentText(sends(calls)[0]!)).toBe("看图\n[图片] .monkeycode/uploads/a.png");
  });

  it("严格逐轮：每次 running true→false 只推进并发送一个队首", async () => {
    const calls = stubShell();
    const { result, rerender } = renderHook(({ running, lastSeq }) => useComposer("a", feed({ running, lastSeq })), {
      initialProps: { running: true, lastSeq: 0 },
    });
    for (const text of ["一", "二", "三"]) {
      act(() => result.current.setDraft(text));
      act(() => result.current.send());
    }

    rerender({ running: false, lastSeq: 0 });
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    expect(sentText(sends(calls)[0]!)).toBe("一");
    expect(result.current.queue.pending.map((item) => item.content)).toEqual(["二", "三"]);

    rerender({ running: true, lastSeq: 1 });
    await settle();
    expect(sends(calls)).toHaveLength(1);
    rerender({ running: false, lastSeq: 2 });
    await waitFor(() => expect(sends(calls)).toHaveLength(2));
    expect(sentText(sends(calls)[1]!)).toBe("二");

    rerender({ running: true, lastSeq: 3 });
    rerender({ running: false, lastSeq: 4 });
    await waitFor(() => expect(sends(calls)).toHaveLength(3));
    expect(sentText(sends(calls)[2]!)).toBe("三");
  });

  it("空队列取消完成后下一条消息正常直发", async () => {
    const calls = stubShell();
    const { result, rerender } = renderHook(({ running }) => useComposer("a", feed({ running })), {
      initialProps: { running: true },
    });

    act(() => result.current.stop());
    expect(result.current.queue.blocked?.code).toBe("user-paused");
    rerender({ running: false });
    await waitFor(() => expect(result.current.queue.blocked).toBeNull());

    act(() => result.current.setDraft("取消后新增"));
    act(() => result.current.send());

    await waitFor(() =>
      expect(sends(calls).filter((call) => call.args?.ftype === "user-input")).toHaveLength(1),
    );
    expect(sentText(sends(calls).find((call) => call.args?.ftype === "user-input")!)).toBe("取消后新增");
    expect(result.current.queue.pending).toEqual([]);
    expect(result.current.queue.blocked).toBeNull();
  });

  it("task-ended 后 layout 阶段直发不会被迟到 effect 清除发送锁", async () => {
    const calls = stubShell();
    const { result, rerender } = renderHook(
      ({ running, sendInLayout }) => {
        const ctl = useComposer("a", feed({ running, lastSeq: 7 }));
        const sentInLayoutRef = useRef(false);
        useLayoutEffect(() => {
          if (!sendInLayout || sentInLayoutRef.current) return;
          sentInLayoutRef.current = true;
          ctl.send();
        }, [ctl, sendInLayout]);
        return ctl;
      },
      { initialProps: { running: true, sendInLayout: false } },
    );

    act(() => result.current.stop());
    act(() => result.current.setDraft("第一条"));
    rerender({ running: false, sendInLayout: true });
    expect(sends(calls).filter((call) => call.args?.ftype === "user-input")).toHaveLength(1);

    act(() => result.current.setDraft("第二条"));
    act(() => result.current.send());
    await settle();

    expect(sends(calls).filter((call) => call.args?.ftype === "user-input")).toHaveLength(1);
    expect(result.current.queue.pending.map((item) => item.content)).toEqual(["第二条"]);
  });

  it("用户主动停止会暂停剩余队列，新增消息不解锁，显式继续才补投", async () => {
    const calls = stubShell();
    const { result, rerender } = renderHook(({ running }) => useComposer("a", feed({ running })), {
      initialProps: { running: true },
    });
    for (const text of ["一", "二"]) {
      act(() => result.current.setDraft(text));
      act(() => result.current.send());
    }

    act(() => result.current.stop());
    expect(result.current.queue.blocked?.code).toBe("user-paused");
    expect(sends(calls).filter((call) => call.args?.ftype === "user-cancel")).toHaveLength(1);

    act(() => result.current.setDraft("三"));
    act(() => result.current.send());
    expect(result.current.queue.blocked?.code).toBe("user-paused");
    expect(queueTexts("a")).toEqual(["一", "二", "三"]);

    rerender({ running: false });
    await settle();
    expect(sends(calls).filter((call) => call.args?.ftype === "user-input")).toHaveLength(0);

    act(() => result.current.resumeQueue());
    await waitFor(() =>
      expect(sends(calls).filter((call) => call.args?.ftype === "user-input")).toHaveLength(1),
    );
    expect(sentText(sends(calls).find((call) => call.args?.ftype === "user-input")!)).toBe("一");
  });

  it("清空暂停队列后轮末不会补投", async () => {
    const calls = stubShell();
    const { result, rerender } = renderHook(({ running }) => useComposer("a", feed({ running })), {
      initialProps: { running: true },
    });
    act(() => result.current.setDraft("不要发送"));
    act(() => result.current.send());
    act(() => result.current.stop());
    act(() => result.current.clearQueue());

    expect(result.current.queue.pending).toEqual([]);
    expect(result.current.queue.blocked).toBeNull();
    rerender({ running: false });
    await settle();
    expect(sends(calls).filter((call) => call.args?.ftype === "user-input")).toHaveLength(0);
  });

  it("发送失败时同 ID 回队首并阻塞后续，退避到点只重试失败项", async () => {
    vi.useFakeTimers();
    const calls = stubShell((cmd) => {
      if (cmd === "session_send") throw new Error("busy");
      return null;
    });
    const { result, rerender } = renderHook(({ running }) => useComposer("a", feed({ running })), {
      initialProps: { running: true },
    });
    for (const text of ["失败项", "后续项"]) {
      act(() => result.current.setDraft(text));
      act(() => result.current.send());
    }
    const failedId = result.current.queue.pending[0]!.id;

    rerender({ running: false });
    await settle();
    expect(sends(calls)).toHaveLength(1);
    expect(result.current.queue.blocked?.itemId).toBe(failedId);
    expect(result.current.queue.pending.map((item) => item.content)).toEqual(["失败项", "后续项"]);

    await act(async () => vi.advanceTimersByTimeAsync(599));
    expect(sends(calls)).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    await settle();
    expect(sends(calls)).toHaveLength(2);
    expect(sentText(sends(calls)[1]!)).toBe("失败项");
    expect(result.current.queue.pending.map((item) => item.content)).toEqual(["失败项", "后续项"]);
  });

  it("historyLoaded 与 stateSid 守卫恢复队列，不会切会话投错", async () => {
    stubShell();
    const first = renderHook(() => useComposer("a", feed({ running: true })));
    act(() => first.result.current.setDraft("只给 A"));
    act(() => first.result.current.send());
    first.unmount();
    resetSendQueueMemoryForTests();

    const calls = stubShell();
    const { result, rerender } = renderHook(
      ({ id, historyLoaded }) => useComposer(id, feed({ running: false, historyLoaded })),
      { initialProps: { id: "a", historyLoaded: false } },
    );
    await settle();
    expect(result.current.queue.pending.map((item) => item.content)).toEqual(["只给 A"]);
    expect(sends(calls)).toHaveLength(0);

    rerender({ id: "b", historyLoaded: true });
    await settle();
    expect(sends(calls).filter((call) => call.args?.id === "b")).toHaveLength(0);
  });

  it("上行在途时后发消息入队，直到开轮并结束才自动投递", async () => {
    const calls = stubShell();
    const { result, rerender } = renderHook(({ running, lastSeq }) => useComposer("a", feed({ running, lastSeq })), {
      initialProps: { running: false, lastSeq: 0 },
    });
    act(() => result.current.setDraft("直发"));
    act(() => result.current.send());
    act(() => result.current.setDraft("排队"));
    act(() => result.current.send());
    expect(sends(calls)).toHaveLength(1);
    expect(result.current.queue.pending.map((item) => item.content)).toEqual(["排队"]);

    rerender({ running: true, lastSeq: 1 });
    await settle();
    expect(sends(calls)).toHaveLength(1);
    rerender({ running: false, lastSeq: 2 });
    await waitFor(() => expect(sends(calls)).toHaveLength(2));
    expect(sentText(sends(calls)[1]!)).toBe("排队");
  });

  it("删除和重排动作立即写回持久 lane", () => {
    stubShell();
    const { result } = renderHook(() => useComposer("a", feed({ running: true })));
    for (const text of ["一", "二", "三"]) {
      act(() => result.current.setDraft(text));
      act(() => result.current.send());
    }
    const [one, two, three] = result.current.queue.pending;
    act(() => result.current.reorderQueued(three!.id, one!.id));
    act(() => result.current.removeQueued(two!.id));
    expect(queueTexts("a")).toEqual(["三", "一"]);
  });

  it("/compact 忙时不入队且保留草稿，空闲时走控制 IPC", async () => {
    const calls = stubShell();
    const busy = renderHook(() => useComposer("a", feed({ running: true })));
    act(() => busy.result.current.setDraft("/compact"));
    act(() => expect(busy.result.current.send()).toBe(false));
    expect(busy.result.current.draft).toBe("/compact");
    expect(busy.result.current.queue.pending).toHaveLength(0);
    busy.unmount();

    const idle = renderHook(() => useComposer("b", feed()));
    act(() => idle.result.current.setDraft("/compact"));
    act(() => expect(idle.result.current.send()).toBe(true));
    await settle();
    expect(calls.filter((call) => call.cmd === "session_call" && call.args?.kind === "session_compact")).toHaveLength(1);
    expect(sends(calls)).toHaveLength(0);
  });

  it("空队列取消完成后 /compact 正常执行", async () => {
    const calls = stubShell();
    const { result, rerender } = renderHook(({ running }) => useComposer("a", feed({ running })), {
      initialProps: { running: true },
    });
    act(() => result.current.stop());
    rerender({ running: false });
    expect(result.current.queue).toMatchObject({ pending: [], inFlight: null, blocked: null });

    act(() => result.current.setDraft("/compact"));
    act(() => expect(result.current.send()).toBe(true));
    await settle();
    expect(calls.filter((call) => call.cmd === "session_call" && call.args?.kind === "session_compact")).toHaveLength(1);
  });

  it("同批开始并结束后按配对水位清除隐藏在途锁", async () => {
    const calls = stubShell();
    const { result, rerender } = renderHook(
      ({ running, lastSeq, lastTurnStartSeq, lastTerminalSeq }) =>
        useComposer("a", feed({ running, lastSeq, lastTurnStartSeq, lastTerminalSeq })),
      { initialProps: { running: true, lastSeq: 0, lastTurnStartSeq: 0, lastTerminalSeq: 0 } },
    );
    act(() => result.current.setDraft("排队消息"));
    act(() => result.current.send());

    rerender({ running: false, lastSeq: 0, lastTurnStartSeq: 0, lastTerminalSeq: 0 });
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    expect(result.current.queue.inFlight?.phase).toBe("awaiting-receipt");

    rerender({ running: false, lastSeq: 3, lastTurnStartSeq: 2, lastTerminalSeq: 3 });
    await waitFor(() => expect(result.current.queue.inFlight).toBeNull());

    act(() => result.current.setDraft("/compact"));
    act(() => expect(result.current.send()).toBe(true));
    await settle();
    expect(calls.filter((call) => call.cmd === "session_call" && call.args?.kind === "session_compact")).toHaveLength(1);
  });

  it("错误帧保持运行态直到唯一 task-ended 后才补投下一条", async () => {
    const calls = stubShell();
    const { result, rerender } = renderHook(
      ({ running, lastSeq, lastTurnStartSeq, lastTerminalSeq }) =>
        useComposer("a", feed({ running, lastSeq, lastTurnStartSeq, lastTerminalSeq })),
      { initialProps: { running: true, lastSeq: 1, lastTurnStartSeq: 1, lastTerminalSeq: 0 } },
    );
    for (const text of ["当前消息", "下一条消息"]) {
      act(() => result.current.setDraft(text));
      act(() => result.current.send());
    }

    rerender({ running: false, lastSeq: 1, lastTurnStartSeq: 1, lastTerminalSeq: 0 });
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    rerender({ running: true, lastSeq: 2, lastTurnStartSeq: 2, lastTerminalSeq: 0 });
    await waitFor(() => expect(result.current.queue.inFlight?.phase).toBe("awaiting-turn-end"));

    // task-error(terminal=false) 只展示错误，不能先于权威 task-ended 放开队列。
    rerender({ running: true, lastSeq: 20, lastTurnStartSeq: 2, lastTerminalSeq: 0 });
    await settle();
    expect(sends(calls)).toHaveLength(1);
    expect(result.current.queue.inFlight).toMatchObject({ item: { content: "当前消息" } });

    rerender({ running: false, lastSeq: 21, lastTurnStartSeq: 2, lastTerminalSeq: 21 });
    await waitFor(() => expect(sends(calls)).toHaveLength(2));
    expect(result.current.queue.inFlight).toMatchObject({
      item: { content: "下一条消息" },
      phase: "awaiting-receipt",
      baselineSeq: 21,
    });
  });

  it("切会话首帧不会用旧会话水位清除新会话在途项", async () => {
    const calls = stubShell();
    const { result, rerender } = renderHook(
      ({ id, running, historyLoaded, lastSeq, lastTurnStartSeq, lastTerminalSeq }) =>
        useComposer(id, feed({ running, historyLoaded, lastSeq, lastTurnStartSeq, lastTerminalSeq })),
      {
        initialProps: {
          id: "b",
          running: true,
          historyLoaded: true,
          lastSeq: 5,
          lastTurnStartSeq: 5,
          lastTerminalSeq: 0,
        },
      },
    );
    act(() => result.current.setDraft("B 的在途消息"));
    act(() => result.current.send());
    rerender({
      id: "b",
      running: false,
      historyLoaded: true,
      lastSeq: 5,
      lastTurnStartSeq: 5,
      lastTerminalSeq: 0,
    });
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    rerender({
      id: "b",
      running: true,
      historyLoaded: true,
      lastSeq: 6,
      lastTurnStartSeq: 6,
      lastTerminalSeq: 0,
    });
    await waitFor(() => expect(result.current.queue.inFlight?.phase).toBe("awaiting-turn-end"));

    rerender({
      id: "a",
      running: false,
      historyLoaded: true,
      lastSeq: 100,
      lastTurnStartSeq: 90,
      lastTerminalSeq: 100,
    });
    await settle();
    rerender({
      id: "a",
      running: false,
      historyLoaded: true,
      lastSeq: 100,
      lastTurnStartSeq: 90,
      lastTerminalSeq: 100,
    });
    rerender({
      id: "b",
      running: false,
      historyLoaded: false,
      lastSeq: 100,
      lastTurnStartSeq: 90,
      lastTerminalSeq: 100,
    });

    expect(result.current.queue.inFlight).toMatchObject({ item: { content: "B 的在途消息" } });
    act(() => result.current.setDraft("/compact"));
    act(() => expect(result.current.send()).toBe(false));
    expect(result.current.draft).toBe("/compact");
  });

  it("直接发送失败恢复原草稿，不污染切换后的会话", async () => {
    let rejectSend: (error: Error) => void = () => {};
    stubShell((cmd) => {
      if (cmd === "session_send") return new Promise((_, reject) => (rejectSend = reject));
      return null;
    });
    const { result, rerender } = renderHook(({ id }) => useComposer(id, feed()), { initialProps: { id: "a" } });
    act(() => result.current.setDraft("迟到的话"));
    act(() => result.current.send());
    rerender({ id: "b" });
    await act(async () => rejectSend(new Error("down")));
    expect(result.current.draft).toBe("");
    expect(stashGet("a")?.draft).toBe("迟到的话");
  });

  it("A→B→A 后旧直发失败不会清除新发送锁", async () => {
    const rejectors: Array<(error: Error) => void> = [];
    const calls = stubShell((cmd) => {
      if (cmd === "session_send") return new Promise((_, reject) => rejectors.push(reject));
      return null;
    });
    const { result, rerender } = renderHook(({ id }) => useComposer(id, feed({ lastSeq: 9 })), {
      initialProps: { id: "a" },
    });

    act(() => result.current.setDraft("旧 A"));
    act(() => result.current.send());
    rerender({ id: "b" });
    rerender({ id: "a" });
    await settle();

    act(() => result.current.setDraft("新 A"));
    act(() => result.current.send());
    expect(rejectors).toHaveLength(2);

    await act(async () => rejectors[0]!(new Error("old failure")));
    expect(result.current.draft).toBe("旧 A");
    act(() => result.current.setDraft("第三条"));
    act(() => result.current.send());
    await settle();

    expect(sends(calls).filter((call) => call.args?.ftype === "user-input")).toHaveLength(2);
    expect(result.current.queue.pending.map((item) => item.content)).toEqual(["第三条"]);
  });

  it("同会话旧直发失败恢复的草稿可跨后续切换保留", async () => {
    const rejectors: Array<(error: Error) => void> = [];
    stubShell((cmd) => {
      if (cmd === "session_send") return new Promise((_, reject) => rejectors.push(reject));
      return null;
    });
    const { result, rerender } = renderHook(({ id }) => useComposer(id, feed({ lastSeq: 9 })), {
      initialProps: { id: "a" },
    });

    act(() => result.current.setDraft("旧 A"));
    act(() => result.current.send());
    rerender({ id: "b" });
    rerender({ id: "a" });
    await settle();
    act(() => result.current.setDraft("新 A"));
    act(() => result.current.send());

    await act(async () => rejectors[0]!(new Error("old failure")));
    expect(result.current.draft).toBe("旧 A");
    rerender({ id: "b" });
    rerender({ id: "a" });
    await settle();

    expect(result.current.draft).toBe("旧 A");
  });

  it("队列投递失败时已切会话：按原 sid/item id 回队，不污染当前 lane", async () => {
    let rejectSend: (error: Error) => void = () => {};
    stubShell((cmd) => {
      if (cmd === "session_send") return new Promise((_, reject) => (rejectSend = reject));
      return null;
    });
    const { result, rerender } = renderHook(
      ({ id, running }) => useComposer(id, feed({ running })),
      { initialProps: { id: "a", running: true } },
    );
    act(() => result.current.setDraft("A 的失败项"));
    act(() => result.current.send());
    const itemId = result.current.queue.pending[0]!.id;
    rerender({ id: "a", running: false });
    await settle();
    rerender({ id: "b", running: false });

    await act(async () => rejectSend(new Error("late reject")));
    const laneA = readSendQueueLane(localSendQueueTarget("a"));
    expect(laneA.blocked?.itemId).toBe(itemId);
    expect(laneA.pending.map((item) => item.content)).toEqual(["A 的失败项"]);
    expect(result.current.queue.pending).toEqual([]);
    expect(result.current.queue.blocked).toBeNull();
  });

  it("上传完成时已切会话：附件只回原会话 stash", async () => {
    let finish: (value: { path: string }) => void = () => {};
    const pending = new Promise<{ path: string }>((resolve) => (finish = resolve));
    stubShell((cmd) => (cmd === "upload_file_path" ? pending : null));
    const { result, rerender } = renderHook(({ id }) => useComposer(id, feed()), { initialProps: { id: "a" } });
    let uploading!: Promise<void>;
    act(() => {
      uploading = result.current.addPaths(["/tmp/a.png"]);
    });
    rerender({ id: "b" });
    await act(async () => {
      finish({ path: ".monkeycode/uploads/a.png" });
      await uploading;
    });
    expect(result.current.atts).toHaveLength(0);
    expect(stashGet("a")?.atts.map((att) => att.path)).toEqual([".monkeycode/uploads/a.png"]);
  });
});
