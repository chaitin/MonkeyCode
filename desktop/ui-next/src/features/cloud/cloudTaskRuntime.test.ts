import { describe, expect, it, vi } from "vitest";

import {
  createSendQueueItem,
  emptySendQueueLane,
  enqueue,
  type CloudQueueAttachment,
  type SendQueueLane,
} from "@/features/chat/composer/sendQueue";
import {
  createCloudTaskRuntime,
  type CloudRuntimeClock,
  type CloudRuntimeDeps,
} from "@/features/cloud/cloudTaskRuntime";
import type { CloudControl, ControlStatus } from "@/lib/cloud/control";
import type { CloudStreamConn, CloudUserInput, StreamHandlers } from "@/lib/cloud/stream";
import type { CloudTaskDetail } from "@/lib/ipc/cloudtasks";

class FakeClock implements CloudRuntimeClock {
  nowValue = 1_000;
  private sequence = 0;
  private microtasks: Array<() => void> = [];
  private timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.nowValue;
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.sequence;
    this.timers.set(id, { at: this.nowValue + ms, fn });
    return id;
  };
  clearTimeout = (handle: unknown) => {
    this.timers.delete(handle as number);
  };
  queueMicrotask = (fn: () => void) => {
    this.microtasks.push(fn);
  };
  flushMicrotasks() {
    while (this.microtasks.length) this.microtasks.shift()!();
  }
  advance(ms: number) {
    this.nowValue += ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= this.nowValue)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      due[1].fn();
      this.flushMicrotasks();
    }
  }
  timerCount() {
    return this.timers.size;
  }
}

interface FakeStream {
  mode: "attach" | "new";
  handlers: StreamHandlers;
  input?: CloudUserInput;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function makeHarness(contents = ["one", "two"]) {
  const clock = new FakeClock();
  let lane: SendQueueLane<CloudQueueAttachment> = contents.reduce(
    (value, content, index) => enqueue(value, createSendQueueItem(content, [], { id: `m${index + 1}`, createdAt: index + 1 })),
    emptySendQueueLane<CloudQueueAttachment>(),
  );
  let detail: CloudTaskDetail = {
    id: "t1",
    status: "processing",
    virtualmachine: { status: "online" },
  };
  let generationCurrent = true;
  const laneListeners = new Set<() => void>();
  const streams: FakeStream[] = [];
  const controls: Array<{
    handlers: { onStatus?(status: ControlStatus, connected: boolean): void };
    ctrl: CloudControl;
    close: ReturnType<typeof vi.fn>;
    revive: ReturnType<typeof vi.fn>;
  }> = [];
  const attention = vi.fn();
  const taskInfo = vi.fn(async () => detail);
  const deps: CloudRuntimeDeps = {
    readLane: () => lane,
    updateLane: (_taskId, update) => {
      lane = update(lane);
      for (const listener of laneListeners) listener();
      return lane;
    },
    subscribeLane: (_taskId, listener) => {
      laneListeners.add(listener);
      return () => laneListeners.delete(listener);
    },
    taskInfo,
    connectControl: (_taskId, handlers) => {
      const close = vi.fn();
      const revive = vi.fn();
      const ctrl: CloudControl = {
        call: async <T,>() => ({} as T),
        revive,
        close,
        isClosed: () => close.mock.calls.length > 0,
      };
      controls.push({ handlers, ctrl, close, revive });
      return ctrl;
    },
    connectStream: (_taskId, mode, handlers, input) => {
      const close = vi.fn();
      const send = vi.fn(async () => true);
      const conn: CloudStreamConn = { close, send };
      streams.push({ mode, handlers, input, close, send });
      return conn;
    },
    clock,
    generation: 7,
    isGenerationCurrent: () => generationCurrent,
    pollMs: 100,
    receiptTimeoutMs: 500,
    onAttention: attention,
  };
  const runtime = createCloudTaskRuntime("acct", "t1", deps);
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) {
      clock.flushMicrotasks();
      await Promise.resolve();
    }
    clock.flushMicrotasks();
  };
  return {
    runtime,
    clock,
    streams,
    controls,
    attention,
    taskInfo,
    settle,
    lane: () => lane,
    enqueueMessage: (content: string, id = "late") => {
      lane = enqueue(lane, createSendQueueItem(content, [], { id, createdAt: clock.now() }));
      for (const listener of laneListeners) listener();
    },
    setDetail: (value: CloudTaskDetail) => {
      detail = value;
    },
    setGenerationCurrent: (value: boolean) => {
      generationCurrent = value;
    },
  };
}

describe("CloudTaskRuntime", () => {
  it("控制调用立即确认模型，忽略更早请求的旧详情且接受后续权威刷新", async () => {
    const h = makeHarness([]);
    h.setDetail({ id: "t1", status: "processing", model: { id: "m1", model: "gpt-x", remark: "旧模型" } });
    h.runtime.acquire("view");
    await h.settle();

    let resolveStaleInfo!: (detail: CloudTaskDetail) => void;
    h.taskInfo.mockImplementationOnce(() => new Promise((resolve) => {
      resolveStaleInfo = resolve;
    }));
    h.streams[0]!.handlers.onFrames?.([{ type: "task-ended", seq: 1, data: {} }]);
    h.runtime.confirmModel({ id: "m2", model: "claude-y", remark: "新模型" });
    resolveStaleInfo({ id: "t1", status: "processing", model: { id: "m1", model: "gpt-x", remark: "旧模型" } });
    await h.settle();
    expect(h.runtime.getSnapshot().detail?.model?.id).toBe("m2");

    h.setDetail({ id: "t1", status: "processing", model: { id: "m3", model: "gpt-z", remark: "外部模型" } });
    h.enqueueMessage("下一轮");
    await h.settle();
    h.streams.at(-1)!.handlers.onFrames?.([
      { type: "task-running", seq: 2, data: {} },
      { type: "task-ended", seq: 3, data: {} },
    ]);
    await h.settle();
    expect(h.runtime.getSnapshot().detail?.model?.id).toBe("m3");
  });

  it("视图切离期间保留同一 runtime 的多批帧供重开补齐", async () => {
    const h = makeHarness();
    const queueLease = h.runtime.acquire("queue");
    const viewLease = h.runtime.acquire("view");
    await h.settle();
    const attach = h.streams.at(-1)!;
    attach.handlers.onFrames?.([{ type: "task-running", seq: 1, data: {} }]);
    const firstSequence = h.runtime.getSnapshot().event?.sequence ?? 0;

    viewLease.release();
    attach.handlers.onFrames?.([{ type: "assistant-text", seq: 2, data: { text: "background" } }]);
    attach.handlers.onFrames?.([{ type: "task-ended", seq: 3, data: {} }]);

    expect(h.runtime.eventsSince?.(firstSequence).map((event) => event.kind)).toEqual(["frames", "frames"]);
    expect(h.runtime.eventsSince?.(firstSequence)[0]).toMatchObject({
      kind: "frames",
      frames: [{ type: "assistant-text", seq: 2 }],
    });
    queueLease.release();
  });

  it("用户取消先暂停剩余队列，task-ended 后不自动补投", async () => {
    const h = makeHarness();
    h.runtime.acquire("queue");
    await h.settle();
    const attach = h.streams[0]!;
    attach.send.mockImplementationOnce(async () => {
      expect(h.lane().blocked?.code).toBe("user-paused");
      return true;
    });

    await h.runtime.cancelRun();
    expect(attach.send).toHaveBeenCalledWith("user-cancel", {});
    expect(h.lane().blocked?.code).toBe("user-paused");

    attach.handlers.onFrames?.([{ type: "task-ended", seq: 1, data: {} }]);
    await h.settle();
    expect(h.streams.map((stream) => stream.mode)).toEqual(["attach"]);
    expect(h.lane().pending.map((item) => item.id)).toEqual(["m1", "m2"]);
  });

  it("空队列取消在 task-ended 后仍保持暂停，后续新增消息不会补投", async () => {
    const h = makeHarness([]);
    h.runtime.acquire("view");
    await h.settle();
    const attach = h.streams[0]!;

    await h.runtime.cancelRun();
    expect(h.lane().blocked?.code).toBe("user-paused");
    attach.handlers.onFrames?.([{ type: "task-ended", seq: 1, data: {} }]);
    await h.settle();
    h.enqueueMessage("取消后新增");
    await h.settle();

    expect(h.streams.map((stream) => stream.mode)).toEqual(["attach"]);
    expect(h.lane().pending.map((item) => item.id)).toEqual(["late"]);
    expect(h.lane().blocked?.code).toBe("user-paused");
  });

  it("空队列取消在 attach idle 后仍保持暂停，后续新增消息不会补投", async () => {
    const h = makeHarness([]);
    h.runtime.acquire("view");
    await h.settle();
    const attach = h.streams[0]!;

    await h.runtime.cancelRun();
    expect(h.lane().blocked?.code).toBe("user-paused");
    attach.handlers.onIdle?.();
    await h.settle();
    h.enqueueMessage("取消后新增");
    await h.settle();

    expect(h.lane().blocked?.code).toBe("user-paused");
    expect(h.streams.map((stream) => stream.mode)).toEqual(["attach"]);
  });

  it("取消帧发送失败时仍保持暂停，避免意外续发", async () => {
    const h = makeHarness();
    h.runtime.acquire("queue");
    await h.settle();
    h.streams[0]!.send.mockResolvedValueOnce(false);

    await expect(h.runtime.cancelRun()).rejects.toThrow("rejected");
    expect(h.lane().blocked?.code).toBe("user-paused");
  });

  it("无视图时 attach 对表后逐轮 mode=new，且只按 receipt→task-ended 推进", async () => {
    const h = makeHarness();
    h.runtime.acquire("queue");
    await h.settle();
    expect(h.streams.map((stream) => stream.mode)).toEqual(["attach"]);

    h.streams[0]!.handlers.onIdle?.();
    await h.settle();
    expect(h.streams.map((stream) => stream.mode)).toEqual(["attach", "new"]);
    expect(h.streams[1]!.input).toEqual({ content: "one" });
    expect(h.lane().inFlight?.item.id).toBe("m1");

    // 只有 task-ended 没有业务回显，不得把消息当成已完成。
    h.streams[1]!.handlers.onFrames([{ type: "task-ended", seq: 1 }]);
    await h.settle();
    expect(h.lane().inFlight?.item.id).toBe("m1");
    expect(h.lane().blocked?.code).toBe("receipt-unknown");

    h.runtime.confirmResume();
    await h.settle();
    const attach = h.streams.at(-1)!;
    expect(attach.mode).toBe("attach");
    attach.handlers.onIdle?.();
    await h.settle();
    const retry = h.streams.at(-1)!;
    expect(retry.mode).toBe("new");
    expect(retry.input?.content).toBe("one");
    retry.handlers.onFrames([{ type: "task-running", seq: 2 }, { type: "task-ended", seq: 3 }]);
    await h.settle();

    expect(h.streams.at(-1)?.mode).toBe("new");
    expect(h.streams.at(-1)?.input?.content).toBe("two");
    expect(h.lane().inFlight?.item.id).toBe("m2");
    expect(h.attention).toHaveBeenCalledWith("t1", "task-ended");
  });

  it("pending 只轮询，hibernated 用唯一 control 唤醒，online 后 attach", async () => {
    const h = makeHarness(["one"]);
    h.setDetail({ id: "t1", status: "pending" });
    h.runtime.acquire("queue");
    await h.settle();
    expect(h.streams).toHaveLength(0);
    expect(h.controls).toHaveLength(0);
    expect(h.clock.timerCount()).toBe(1);

    h.setDetail({ id: "t1", status: "processing", virtualmachine: { status: "hibernated" } });
    h.clock.advance(100);
    await h.settle();
    expect(h.controls).toHaveLength(1);
    expect(h.controls[0]!.revive).toHaveBeenCalledTimes(1);
    expect(h.streams).toHaveLength(0);

    h.setDetail({ id: "t1", status: "processing", virtualmachine: { status: "online" } });
    h.clock.advance(100);
    await h.settle();
    expect(h.controls).toHaveLength(1);
    expect(h.streams.map((stream) => stream.mode)).toEqual(["attach"]);
  });

  it("attach 收到业务帧时等待当前轮结束，不抢发队首", async () => {
    const h = makeHarness(["one"]);
    h.runtime.acquire("queue");
    await h.settle();
    h.streams[0]!.handlers.onFrames([{ type: "task-running", seq: 1 }]);
    await h.settle();
    expect(h.streams).toHaveLength(1);
    expect(h.lane().inFlight).toBeNull();
    h.streams[0]!.handlers.onFrames([{ type: "task-ended", seq: 2 }]);
    await h.settle();
    expect(h.streams.at(-1)?.mode).toBe("new");
  });

  it("attach 按 dialGaveUp→onIdle 收束时结构化阻塞，不误开 mode=new", async () => {
    const h = makeHarness(["one"]);
    h.runtime.acquire("queue");
    await h.settle();
    const attach = h.streams[0]!;

    // 对齐 connectCloudStream.onPipeClose 的真实同步调用顺序。
    attach.handlers.onStatus({ kind: "dialGaveUp", reason: "dial failed" }, false);
    attach.handlers.onIdle?.();
    await h.settle();

    expect(h.lane().blocked).toMatchObject({
      code: "control-offline",
      message: expect.stringContaining("dial failed"),
    });
    expect(h.lane().inFlight).toBeNull();
    expect(h.streams.map((value) => value.mode)).toEqual(["attach"]);

    h.runtime.confirmResume();
    await h.settle();
    expect(h.streams.map((value) => value.mode)).toEqual(["attach", "attach"]);
    h.streams[1]!.handlers.onIdle?.();
    await h.settle();
    expect(h.streams.at(-1)?.mode).toBe("new");
  });

  it("mode=new receipt 后按 dropGaveUp→onIdle 收束时进入 uncertain 且不自动重发", async () => {
    const h = makeHarness(["one", "two"]);
    h.runtime.acquire("queue");
    await h.settle();
    h.streams[0]!.handlers.onIdle?.();
    await h.settle();
    const sending = h.streams[1]!;
    sending.handlers.onFrames([{ type: "task-running", seq: 1 }]);
    await h.settle();
    expect(h.lane().inFlight).toMatchObject({ item: { id: "m1" }, phase: "awaiting-turn-end" });

    // mode=new 收到 receipt 后重连已降级 attach；连续短命断流的真实顺序。
    sending.handlers.onStatus({ kind: "dropGaveUp" }, false);
    sending.handlers.onIdle?.();
    await h.settle();

    expect(h.lane().inFlight).toMatchObject({ item: { id: "m1" }, phase: "uncertain" });
    expect(h.lane().blocked).toMatchObject({
      code: "receipt-unknown",
      message: expect.stringContaining("disconnected"),
    });
    expect(h.lane().pending.map((item) => item.id)).toEqual(["m2"]);
    expect(h.streams).toHaveLength(2);
    h.clock.advance(10_000);
    await h.settle();
    expect(h.streams).toHaveLength(2);

    // 只有明确确认才把不确定项恢复到队首；仍先 attach 对表，不直发。
    h.runtime.confirmResume();
    await h.settle();
    expect(h.lane().pending.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(h.streams.map((value) => value.mode)).toEqual(["attach", "new", "attach"]);
    h.streams[2]!.handlers.onIdle?.();
    await h.settle();
    expect(h.streams.at(-1)?.mode).toBe("new");
    expect(h.streams.at(-1)?.input?.content).toBe("one");
  });

  it("mode=new receipt 后普通 onIdle 缺 task-ended 时进入 uncertain，不永久悬挂或自动重发", async () => {
    const h = makeHarness(["one", "two"]);
    h.runtime.acquire("queue");
    await h.settle();
    h.streams[0]!.handlers.onIdle?.();
    await h.settle();
    const sending = h.streams[1]!;
    sending.handlers.onFrames([{ type: "task-running", seq: 1 }]);
    await h.settle();
    expect(h.lane().inFlight).toMatchObject({ item: { id: "m1" }, phase: "awaiting-turn-end" });

    // connectCloudStream 在 mode=new 已收业务帧、随后 clean/zero close 且没有
    // task-ended 时会直接 onIdle，不会先给 give-up status。
    sending.handlers.onIdle?.();
    await h.settle();

    expect(h.lane().inFlight).toMatchObject({ item: { id: "m1" }, phase: "uncertain" });
    expect(h.lane().blocked).toMatchObject({
      code: "receipt-unknown",
      message: expect.stringContaining("task-ended"),
    });
    expect(h.lane().pending.map((item) => item.id)).toEqual(["m2"]);
    expect(h.streams).toHaveLength(2);
    h.clock.advance(10_000);
    await h.settle();
    expect(h.streams).toHaveLength(2);

    h.runtime.confirmResume();
    await h.settle();
    expect(h.lane().pending.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(h.streams.map((value) => value.mode)).toEqual(["attach", "new", "attach"]);
    h.streams[2]!.handlers.onIdle?.();
    await h.settle();
    expect(h.streams.at(-1)?.mode).toBe("new");
    expect(h.streams.at(-1)?.input?.content).toBe("one");
  });

  it("send reject 原项回队首并 blocked；确认后才可重试", async () => {
    const h = makeHarness(["one", "two"]);
    h.runtime.acquire("queue");
    await h.settle();
    h.streams[0]!.handlers.onIdle?.();
    await h.settle();
    h.streams[1]!.handlers.onSendFailed?.({ content: "one" });
    await h.settle();
    expect(h.lane().pending.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(h.lane().blocked?.code).toBe("send-rejected");
    expect(h.streams).toHaveLength(2);

    h.runtime.confirmResume();
    await h.settle();
    h.streams.at(-1)!.handlers.onIdle?.();
    await h.settle();
    expect(h.streams.at(-1)?.input?.content).toBe("one");
  });

  it("零回显超时进入 uncertain；control offline 也阻塞后续", async () => {
    const h = makeHarness(["one"]);
    h.runtime.acquire("queue");
    await h.settle();
    h.streams[0]!.handlers.onIdle?.();
    await h.settle();
    h.clock.advance(500);
    await h.settle();
    expect(h.lane().inFlight?.phase).toBe("uncertain");
    expect(h.lane().blocked?.code).toBe("receipt-unknown");
    expect(h.streams[1]!.close).toHaveBeenCalledTimes(1);

    h.runtime.confirmResume();
    await h.settle();
    h.controls.at(-1)!.handlers.onStatus?.({ kind: "offline", reason: "network" }, false);
    await h.settle();
    expect(h.lane().blocked?.code).toBe("control-offline");
  });

  it("generation 失效隔离迟到回调，并在释放最后引用时关闭资源", async () => {
    const h = makeHarness(["one"]);
    const lease = h.runtime.acquire("queue");
    await h.settle();
    const oldAttach = h.streams[0]!;
    h.setGenerationCurrent(false);
    h.runtime.invalidate({ code: "transport-changed", message: "changed", at: h.clock.now() });
    oldAttach.handlers.onIdle?.();
    oldAttach.handlers.onFrames([{ type: "task-ended", seq: 1 }]);
    await h.settle();
    expect(h.streams).toHaveLength(1);
    expect(h.lane().blocked?.code).toBe("transport-changed");
    expect(oldAttach.close).toHaveBeenCalledTimes(1);
    expect(h.controls[0]!.close).toHaveBeenCalledTimes(1);

    lease.release();
    h.runtime.dispose();
    expect(oldAttach.close).toHaveBeenCalledTimes(1);
  });

  it("sendFrame/borrowControl 共用 runtime 唯一连接，最后引用释放后收尽资源", async () => {
    const h = makeHarness([]);
    const view = h.runtime.acquire("view");
    await h.settle();
    expect(h.controls).toHaveLength(1);
    expect(h.streams.map((stream) => stream.mode)).toEqual(["attach"]);

    const first = h.runtime.borrowControl();
    const second = h.runtime.borrowControl();
    expect(first.ctrl).toBe(second.ctrl);
    await h.runtime.sendFrame("permission-response", { ok: true });
    expect(h.streams[0]!.send).toHaveBeenCalledWith("permission-response", { ok: true });

    view.release();
    first.release();
    expect(h.controls[0]!.close).not.toHaveBeenCalled();
    second.release();
    await h.settle();
    expect(h.controls[0]!.close).toHaveBeenCalledTimes(1);
    expect(h.streams[0]!.close).toHaveBeenCalledTimes(1);
  });

  it("任务终态保留队列并结构化阻塞", async () => {
    const h = makeHarness(["one"]);
    h.setDetail({ id: "t1", status: "finished" });
    h.runtime.acquire("queue");
    await h.settle();
    expect(h.lane().pending.map((item) => item.id)).toEqual(["m1"]);
    expect(h.lane().blocked?.code).toBe("task-ended");
    expect(h.streams).toHaveLength(0);
  });
});
