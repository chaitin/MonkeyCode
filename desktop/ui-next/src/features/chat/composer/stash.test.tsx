import { beforeEach, describe, expect, it, vi } from "vitest";

import { b64decode } from "@/lib/protocol/codec";
import {
  claimSteering,
  createSendQueueItem,
  enqueue,
  markSteeringUncertain,
  localSendQueueKey,
  localSendQueueTarget,
  pausePending,
  readSendQueueLane,
  resetSendQueueMemoryForTests,
  updateSendQueueLane,
} from "./sendQueue";
import {
  bindActiveComposer,
  deliverQueued,
  dropStash,
  resetStashForTests,
  stashGet,
  stashSet,
} from "./stash";

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
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sends = (calls: Call[]) => calls.filter((call) => call.cmd === "session_send");
const textOf = (call: Call) => b64decode(String((call.args?.payload as { content?: string }).content));
const enqueueFor = (id: string, content: string, path?: string) =>
  updateSendQueueLane(localSendQueueTarget(id), (lane) =>
    enqueue(
      lane,
      createSendQueueItem(content, path ? [{ path, name: path.split("/").pop() ?? path, isImage: path.endsWith(".png") }] : []),
    ),
  );

beforeEach(() => {
  localStorage.clear();
  resetSendQueueMemoryForTests();
  resetStashForTests();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("stash 仅保存草稿附件", () => {
  it("全空即清；dropStash 同时删除持久 lane", () => {
    stashSet("a", { draft: "x", atts: [] });
    expect(stashGet("a")?.draft).toBe("x");
    stashSet("a", { draft: "", atts: [] });
    expect(stashGet("a")).toBeUndefined();

    enqueueFor("a", "待发");
    expect(localStorage.getItem(localSendQueueKey("a"))).not.toBeNull();
    dropStash("a");
    expect(stashGet("a")).toBeUndefined();
    expect(localStorage.getItem(localSendQueueKey("a"))).toBeNull();
    expect(readSendQueueLane(localSendQueueTarget("a")).pending).toEqual([]);
  });
});

describe("deliverQueued 后台逐轮补投", () => {
  it("一组轮末状态只投一个；running 确认后下一轮末才投第二个", async () => {
    const calls = stubShell();
    enqueueFor("a", "第一条");
    enqueueFor("a", "第二条");

    deliverQueued("a", "idle");
    deliverQueued("a", "idle");
    await flush();
    expect(sends(calls)).toHaveLength(1);
    expect(textOf(sends(calls)[0]!)).toBe("第一条");

    deliverQueued("a", "running");
    deliverQueued("a", "idle");
    await flush();
    expect(sends(calls)).toHaveLength(2);
    expect(textOf(sends(calls)[1]!)).toBe("第二条");
  });

  it("投递时才拼附件行", async () => {
    const calls = stubShell();
    enqueueFor("a", "看图", ".monkeycode/uploads/a.png");
    deliverQueued("a", "idle");
    await flush();
    expect(textOf(sends(calls)[0]!)).toBe("看图\n[图片] .monkeycode/uploads/a.png");
  });

  it("失败同 ID 回队首并阻塞，后续项不能越过", async () => {
    const calls = stubShell((cmd) => {
      if (cmd === "session_send") throw new Error("busy");
      return null;
    });
    enqueueFor("a", "失败项");
    enqueueFor("a", "后续项");
    const firstId = readSendQueueLane(localSendQueueTarget("a")).pending[0]!.id;

    deliverQueued("a", "idle");
    await flush();
    const lane = readSendQueueLane(localSendQueueTarget("a"));
    expect(sends(calls)).toHaveLength(1);
    expect(lane.blocked?.itemId).toBe(firstId);
    expect(lane.pending.map((item) => item.content)).toEqual(["失败项", "后续项"]);
  });

  it("分屏多个活跃会话都由各自 useComposer 接管，卸载其中一个不影响另一个", async () => {
    const calls = stubShell();
    enqueueFor("a", "A 现场消息");
    enqueueFor("b", "B 现场消息");
    const unbindA = bindActiveComposer("a");
    const unbindB = bindActiveComposer("b");

    deliverQueued("a", "idle");
    deliverQueued("b", "idle");
    await flush();
    expect(sends(calls)).toHaveLength(0);

    unbindB();
    deliverQueued("a", "idle");
    await flush();
    expect(sends(calls)).toHaveLength(0);

    unbindA();
    deliverQueued("a", "idle");
    await flush();
    expect(sends(calls)).toHaveLength(1);
    expect(textOf(sends(calls)[0]!)).toBe("A 现场消息");
  });

  it("uncertain steering 存在时后台 deliverQueued 不让后续 pending 越过", async () => {
    const calls = stubShell();
    enqueueFor("a", "可能已插入");
    const target = localSendQueueTarget("a");
    const steerId = readSendQueueLane(target).pending[0]!.id;
    updateSendQueueLane(target, (lane) => markSteeringUncertain(claimSteering(lane, steerId, 100)));
    enqueueFor("a", "后续普通消息");

    deliverQueued("a", "idle");
    await flush();
    expect(sends(calls)).toHaveLength(0);
    expect(readSendQueueLane(target)).toMatchObject({
      inFlight: null,
      pending: [{ content: "后续普通消息" }],
      steering: [{ item: { id: steerId }, phase: "uncertain" }],
    });
  });

  it("后台状态归约不能解除用户主动暂停", async () => {
    const calls = stubShell();
    enqueueFor("a", "保持暂停");
    updateSendQueueLane(localSendQueueTarget("a"), (lane) => pausePending(lane, 100));

    deliverQueued("a", "running");
    deliverQueued("a", "idle");
    await flush();

    expect(sends(calls)).toHaveLength(0);
    expect(readSendQueueLane(localSendQueueTarget("a")).blocked?.code).toBe("user-paused");
  });

  it("删除后的迟到失败回调按 sid/item token 失效，不会复活 lane", async () => {
    let rejectSend: (error: Error) => void = () => {};
    stubShell((cmd) => {
      if (cmd === "session_send") return new Promise((_, reject) => (rejectSend = reject));
      return null;
    });
    enqueueFor("a", "不要复活");
    deliverQueued("a", "idle");
    dropStash("a");
    rejectSend(new Error("late"));
    await flush();
    expect(readSendQueueLane(localSendQueueTarget("a")).pending).toEqual([]);
    expect(readSendQueueLane(localSendQueueTarget("a")).inFlight).toBeNull();
  });

  it("成功回调仅对本次领取项触发一次", async () => {
    stubShell();
    enqueueFor("a", "已送");
    const delivered = vi.fn();
    deliverQueued("a", "idle", delivered);
    await flush();
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(delivered).toHaveBeenCalledWith("a", "已送");
  });
});
