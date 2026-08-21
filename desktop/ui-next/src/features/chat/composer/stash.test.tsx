import { beforeEach, describe, expect, it, vi } from "vitest";

import { b64encode } from "@/lib/protocol/codec";
import {
  bindActiveComposer,
  deliverQueued,
  dropStash,
  queueFlightId,
  resetStashForTests,
  stashGet,
  stashSet,
} from "./stash";
import type { QueueItem } from "./useComposer";

function stubSend(impl: (cmd: string, args?: Record<string, unknown>) => unknown) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        try { return Promise.resolve(impl(cmd, args)); }
        catch (error) { return Promise.reject(error); }
      },
    },
  };
  return calls;
}

const item = (id: string, text: string, atts: QueueItem["atts"] = []): QueueItem => ({ id, text, atts });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetStashForTests();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("stash 留档", () => {
  it("全空即清条目;dropStash 同时清档和在途", () => {
    stashSet("a", { draft: "x", queue: [], atts: [] });
    expect(stashGet("a")?.draft).toBe("x");
    stashSet("a", { draft: "", queue: [], atts: [] });
    expect(stashGet("a")).toBeUndefined();
    stashSet("b", { draft: "", queue: [item("q", "消息")], atts: [] });
    stubSend(() => new Promise(() => {}));
    deliverQueued("b", "idle");
    expect(queueFlightId("b")).toBe("q");
    dropStash("b");
    expect(stashGet("b")).toBeUndefined();
    expect(queueFlightId("b")).toBeNull();
  });
});

describe("deliverQueued 后台串行补投", () => {
  it("轮未结束不投，活动会话不投", () => {
    const calls = stubSend(() => null);
    stashSet("a", { draft: "", queue: [item("q1", "排着的")], atts: [] });
    deliverQueued("a", "running");
    deliverQueued("a", "created");
    const binding = bindActiveComposer("a", { confirmed: vi.fn(), failed: vi.fn() });
    deliverQueued("a", "idle");
    binding.unbind();
    expect(calls).toHaveLength(0);
    expect(stashGet("a")?.queue.map((queued) => queued.text)).toEqual(["排着的"]);
  });

  it("挂起 Promise 期间重复 idle 只发送一次，队首保持可见", () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    const calls = stubSend((cmd) => cmd === "session_send" ? pending : null);
    stashSet("a", { draft: "", queue: [item("a", "A"), item("b", "B")], atts: [] });
    deliverQueued("a", "idle");
    deliverQueued("a", "idle");
    deliverQueued("a", "idle");
    expect(calls.filter((call) => call.cmd === "session_send")).toHaveLength(1);
    expect(queueFlightId("a")).toBe("a");
    expect(stashGet("a")?.queue.map((queued) => queued.id)).toEqual(["a", "b"]);
    resolve();
  });

  it("running 先于 IPC Promise 完成时仍只通知一次", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    stubSend((cmd) => cmd === "session_send" ? pending : null);
    const delivered = vi.fn();
    stashSet("a", { draft: "", queue: [item("a", "A")], atts: [] });
    deliverQueued("a", "idle", delivered);

    deliverQueued("a", "running");
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(delivered).toHaveBeenCalledWith("a", "A");
    resolve();
    await flush();
    expect(delivered).toHaveBeenCalledTimes(1);
  });

  it("IPC accepted 后仍保留锁定队首，running 帧确认才移除", async () => {
    const calls = stubSend(() => null);
    const att = { path: "p.png", name: "p.png", isImage: true };
    stashSet("a", { draft: "草稿", queue: [item("a", "A", [att]), item("b", "B")], atts: [att] });
    const delivered = vi.fn();
    deliverQueued("a", "idle", delivered);
    await flush();
    expect(calls[0]).toEqual({
      cmd: "session_send",
      args: { id: "a", ftype: "user-input", payload: { content: b64encode("A\n[图片] p.png") } },
    });
    expect(stashGet("a")?.queue.map((queued) => queued.id)).toEqual(["a", "b"]);
    expect(queueFlightId("a")).toBe("a");
    deliverQueued("a", "running");
    expect(stashGet("a")?.queue.map((queued) => queued.id)).toEqual(["b"]);
    expect(queueFlightId("a")).toBeNull();
  });

  it("reject 释放所有权但项目天然留在队首；活动会话收到失败", async () => {
    stubSend(() => { throw new Error("busy"); });
    const failed = vi.fn();
    stashSet("a", { draft: "", queue: [item("a", "A"), item("b", "B")], atts: [] });
    deliverQueued("a", "idle");
    bindActiveComposer("a", { confirmed: vi.fn(), failed });
    await flush();
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), expect.any(Error));
    expect(queueFlightId("a")).toBeNull();
    expect(stashGet("a")?.queue.map((queued) => queued.id)).toEqual(["a", "b"]);
  });
});
