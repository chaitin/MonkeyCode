import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ackSteering,
  block,
  claimHead,
  claimSteering,
  clearPending,
  cloudSendQueueIndexKey,
  cloudSendQueueKey,
  cloudSendQueueTarget,
  completeTurn,
  confirmResume,
  confirmSteering,
  createSendQueueItem,
  discardSteering,
  discardUncertain,
  dropSendQueueTarget,
  emptySendQueueLane,
  enqueue,
  failSteering,
  getCloudQueueIndexSnapshot,
  getSendQueuePersistenceState,
  invalidateCloudAccountQueues,
  isSendQueueLane,
  localSendQueueKey,
  localSendQueueTarget,
  markReceipt,
  markSteeringUncertain,
  markUncertain,
  nackHead,
  pausePending,
  readSendQueueLane,
  recoverLaneAfterRestart,
  releaseEmptyUserPause,
  remove,
  reorderBefore,
  resetSendQueueMemoryForTests,
  resumeAutomatic,
  retrySteering,
  stableCloudAccountScope,
  subscribeCloudQueueIndex,
  subscribeSendQueueLane,
  updateSendQueueLane,
  writeSendQueueLane,
  type CloudQueueAttachment,
  type LocalQueueAttachment,
  type SendQueueBlock,
  type SendQueueItem,
  type SendQueueLane,
} from "./sendQueue";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  failGet = false;
  failSet = false;
  failRemove = false;

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    if (this.failGet) throw new Error("get failed");
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    if (this.failRemove) throw new Error("remove failed");
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error("set failed");
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

afterAll(() => {
  if (originalLocalStorage) Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

beforeEach(() => {
  storage.clear();
  storage.failGet = false;
  storage.failSet = false;
  storage.failRemove = false;
  resetSendQueueMemoryForTests();
});

const localAttachment = (name: string): LocalQueueAttachment => ({
  path: `/tmp/${name}`,
  name,
  isImage: name.endsWith(".png"),
});

const cloudAttachment = (filename: string): CloudQueueAttachment => ({
  url: `https://files.example/${filename}`,
  filename,
  isImage: filename.endsWith(".png"),
});

const item = <A = string>(id: string, attachments: A[] = []): SendQueueItem<A> =>
  createSendQueueItem(`message-${id}`, attachments, { id, createdAt: id.length });

const laneOf = <A>(...items: SendQueueItem<A>[]): SendQueueLane<A> =>
  items.reduce((lane, entry) => enqueue(lane, entry), emptySendQueueLane<A>());

const idsOf = <A>(lane: SendQueueLane<A>): string[] => lane.pending.map((entry) => entry.id);

const rejected: SendQueueBlock = {
  code: "send-rejected",
  message: "rejected",
  at: 10,
};

describe("send queue pure transitions", () => {
  it("appends three stable items in FIFO order", () => {
    const entries = [item("a"), item("b"), item("c")];
    const lane = entries.reduce<SendQueueLane<string>>(
      (current, entry) => enqueue(current, entry),
      emptySendQueueLane<string>(),
    );

    expect(idsOf(lane)).toEqual(["a", "b", "c"]);
    expect(lane.pending).toEqual(entries);
    expect(enqueue(lane, item("b"))).toBe(lane);
  });

  it.each([
    ["first", "a", ["b", "c"]],
    ["middle", "b", ["a", "c"]],
    ["last", "c", ["a", "b"]],
  ])("removes the %s pending item without disturbing the rest", (_position, removedId, expected) => {
    expect(idsOf(remove(laneOf(item("a"), item("b"), item("c")), removedId))).toEqual(expected);
  });

  it("reorders pending items forward, backward, and to the end", () => {
    const original = laneOf(item("a"), item("b"), item("c"), item("d"));

    expect(idsOf(reorderBefore(original, "d", "b"))).toEqual(["a", "d", "b", "c"]);
    expect(idsOf(reorderBefore(original, "a", "d"))).toEqual(["b", "c", "a", "d"]);
    expect(idsOf(reorderBefore(original, "b", null))).toEqual(["a", "c", "d", "b"]);
    expect(reorderBefore(original, "missing", "a")).toBe(original);
    expect(reorderBefore(original, "a", "missing")).toBe(original);
  });

  it("claims only the head, acknowledges it, and waits for its turn to complete", () => {
    const pending = laneOf(item("a"), item("b"));
    const claimed = claimHead(pending, { startedAt: 100, baselineSeq: 7, phase: "awaiting-receipt" });

    expect(claimed.inFlight).toEqual({
      item: item("a"),
      phase: "awaiting-receipt",
      baselineSeq: 7,
      startedAt: 100,
    });
    expect(idsOf(claimed)).toEqual(["b"]);
    expect(claimHead(claimed)).toBe(claimed);
    expect(completeTurn(claimed, "a")).toBe(claimed);

    const acknowledged = markReceipt(claimed, "a");
    expect(acknowledged.inFlight?.phase).toBe("awaiting-turn-end");
    expect(markReceipt(acknowledged, "b")).toBe(acknowledged);
    expect(completeTurn(acknowledged, "a")).toEqual({ ...acknowledged, inFlight: null });
  });

  it("steering claim/ACK/confirm 以 durable outbox 分段提交并支持多条确认", () => {
    const original = laneOf(item("a"), item("b"), item("c"));
    const first = claimSteering(original, "b", 100);
    expect(idsOf(first)).toEqual(["a", "c"]);
    expect(first.steering).toEqual([{
      item: item("b"), phase: "dispatching", startedAt: 100, originalIndex: 1,
    }]);
    expect(claimSteering(first, "a", 101)).toBe(first);
    expect(claimHead(first, { startedAt: 101 })).toBe(first);

    const firstAck = ackSteering(first, "b");
    const second = ackSteering(claimSteering(firstAck, "a", 102), "a");
    expect(second.steering?.map((entry) => [entry.item.id, entry.phase])).toEqual([
      ["b", "acked"], ["a", "acked"],
    ]);
    const confirmedA = confirmSteering(second, "a");
    expect(confirmedA.steering?.map((entry) => entry.item.id)).toEqual(["b"]);
    expect(confirmSteering(confirmedA, "a")).toBe(confirmedA);
    expect(confirmSteering(confirmedA, "b").steering).toEqual([]);
  });

  it("steering 失败按 originalIndex 恢复；清空意图优先且 uncertain 只能显式处理", () => {
    const dispatching = claimSteering(laneOf(item("a"), item("b"), item("c")), "b", 100);
    expect(idsOf(failSteering(dispatching, "b"))).toEqual(["a", "b", "c"]);

    const cleared = clearPending(dispatching);
    expect(cleared.pending).toEqual([]);
    expect(cleared.steering?.[0]).toMatchObject({ phase: "dispatching", discardRequested: true });
    expect(failSteering(cleared, "b")).toMatchObject({ pending: [], steering: [] });

    const uncertain = recoverLaneAfterRestart(ackSteering(dispatching, "b"));
    expect(uncertain.steering?.[0]).toMatchObject({ item: { id: "b" }, phase: "uncertain" });
    expect(idsOf(retrySteering(uncertain, "b"))).toEqual(["a", "b", "c"]);
    expect(discardSteering(uncertain, "b").steering).toEqual([]);
  });

  it("idle 把 dispatching/acked steering 标为 uncertain，且未丢弃 outbox 阻止普通 claim", () => {
    const dispatching = claimSteering(laneOf(item("steer"), item("later")), "steer", 100);
    const uncertainFromDispatch = markSteeringUncertain(dispatching);
    expect(uncertainFromDispatch.steering?.[0]?.phase).toBe("uncertain");
    expect(claimHead(uncertainFromDispatch, { startedAt: 101 })).toBe(uncertainFromDispatch);

    const acked = ackSteering(dispatching, "steer");
    const uncertainFromAck = markSteeringUncertain(acked);
    expect(uncertainFromAck.steering?.[0]?.phase).toBe("uncertain");
    expect(markSteeringUncertain(uncertainFromAck)).toBe(uncertainFromAck);

    const discardRequested = clearPending(dispatching);
    const withNewPending = enqueue(discardRequested, item("explicit-new"));
    expect(claimHead(withNewPending, { startedAt: 102 }).inFlight?.item.id).toBe("explicit-new");
  });

  it("普通 inFlight 会拒绝 steering claim", () => {
    const ordinary = claimHead(laneOf(item("a"), item("b")), { startedAt: 100 });
    expect(claimSteering(ordinary, "b", 101)).toBe(ordinary);
  });

  it("returns a rejected in-flight item to the head and blocks later items", () => {
    const claimed = claimHead(laneOf(item("a"), item("b")), { startedAt: 100 });
    const failed = nackHead(claimed, "a", rejected);

    expect(idsOf(failed)).toEqual(["a", "b"]);
    expect(failed.inFlight).toBeNull();
    expect(failed.blocked).toEqual({ ...rejected, itemId: "a" });
    expect(claimHead(failed)).toBe(failed);
    expect(idsOf(claimHead(confirmResume(failed), { startedAt: 101 }))).toEqual(["b"]);
  });

  it("does not let later messages bypass a failed head before retry or removal", () => {
    const failed = nackHead(claimHead(laneOf(item("a"), item("b"), item("c")), { startedAt: 100 }), "a", rejected);

    expect(reorderBefore(failed, "a", null)).toBe(failed);
    expect(reorderBefore(failed, "c", "a")).toBe(failed);
    expect(idsOf(reorderBefore(failed, "c", "b"))).toEqual(["a", "c", "b"]);

    const removedFailure = remove(failed, "a");
    expect(removedFailure.blocked).toBeNull();
    expect(claimHead(removedFailure, { startedAt: 101 }).inFlight?.item.id).toBe("b");
  });

  it("pauses uncertain delivery until explicit retry or discard", () => {
    const claimed = claimHead(laneOf(item("a"), item("b")), { startedAt: 100 });
    const uncertain = markUncertain(claimed, "timed out", 101);

    expect(uncertain.inFlight?.phase).toBe("uncertain");
    expect(uncertain.blocked).toEqual({ code: "receipt-unknown", message: "timed out", at: 101 });
    expect(claimHead(uncertain)).toBe(uncertain);
    expect(idsOf(confirmResume(uncertain))).toEqual(["a", "b"]);
    expect(discardUncertain(uncertain, "a")).toEqual({ ...uncertain, inFlight: null, blocked: null });
  });

  it("用户暂停会阻止自动补投，显式恢复后继续 FIFO", () => {
    const claimed = markReceipt(claimHead(laneOf(item("sent"), item("next")), { startedAt: 100 }), "sent");
    const paused = pausePending(claimed, 101);

    expect(paused.blocked).toEqual({ code: "user-paused", message: "Paused by user", at: 101 });
    const completed = completeTurn(paused, "sent");
    expect(claimHead(completed)).toBe(completed);
    expect(resumeAutomatic(completed)).toBe(completed);
    expect(claimHead(confirmResume(completed), { startedAt: 102 }).inFlight?.item.id).toBe("next");
  });

  it("轮末只释放空队列的取消屏障", () => {
    const pausedEmpty = pausePending(emptySendQueueLane<string>(), 101);
    expect(releaseEmptyUserPause(pausedEmpty).blocked).toBeNull();

    const queuedDuringCancel = enqueue(pausedEmpty, item("late"));
    expect(releaseEmptyUserPause(queuedDuringCancel)).toBe(queuedDuringCancel);

    const claimedDuringCancel = claimHead(laneOf(item("sending")), { startedAt: 102 });
    const pausedClaimed = pausePending(claimedDuringCancel, 103);
    expect(releaseEmptyUserPause(pausedClaimed)).toBe(pausedClaimed);

    const discardedSteering = pausePending(clearPending(claimSteering(laneOf(item("cleared")), "cleared", 104)), 105);
    expect(releaseEmptyUserPause(discardedSteering).blocked).toBeNull();
  });

  it("用户暂停覆盖可恢复故障并保留失败项约束，但不覆盖 uncertain", () => {
    const rejected = block(laneOf(item("failed"), item("later")), {
      code: "send-rejected",
      message: "failed",
      at: 100,
      itemId: "failed",
    });
    const pausedRejected = pausePending(rejected, 101);
    expect(pausedRejected.blocked).toEqual({
      code: "user-paused",
      message: "Paused by user",
      at: 101,
      itemId: "failed",
    });
    expect(remove(pausedRejected, "failed")).toMatchObject({
      pending: [{ id: "later" }],
      blocked: { code: "user-paused", message: "Paused by user", at: 101 },
    });

    const uncertain = markUncertain(claimHead(laneOf(item("maybe")), { startedAt: 102 }));
    expect(pausePending(uncertain, 103)).toBe(uncertain);

    const sending = claimHead(laneOf(item("sending"), item("next")), { startedAt: 104 });
    const pausedSending = pausePending(sending, 105);
    expect(nackHead(pausedSending, "sending").blocked).toEqual({
      code: "user-paused",
      message: "Paused by user",
      at: 105,
      itemId: "sending",
    });
  });

  it("清空暂停队列保留 in-flight，删除最后一项不留下暂停空壳", () => {
    const claimed = claimHead(laneOf(item("sent"), item("next")), { startedAt: 100 });
    const paused = pausePending(claimed, 101);

    expect(clearPending(paused)).toEqual({ ...paused, pending: [], blocked: null });
    expect(remove(paused, "next")).toEqual({ ...paused, pending: [], blocked: null });
  });

  it("recovers unsafe in-flight phases as blocked uncertain state", () => {
    const claimed = claimHead(laneOf(item("a")), { startedAt: 100 });
    const acknowledged = markReceipt(claimed, "a");

    expect(recoverLaneAfterRestart(claimed).inFlight?.phase).toBe("uncertain");
    expect(recoverLaneAfterRestart(claimed).blocked?.code).toBe("receipt-unknown");
    expect(recoverLaneAfterRestart(acknowledged, { awaitingTurnRunning: true })).toBe(acknowledged);
    expect(recoverLaneAfterRestart(acknowledged).inFlight?.phase).toBe("uncertain");
  });

  it("marks transport invalidation as uncertain without changing message data", () => {
    const claimed = claimHead(laneOf(item("a", ["attachment"])), { startedAt: 100 });
    const invalidated = block(claimed, { code: "transport-changed", message: "changed", at: 101 });

    expect(invalidated.inFlight?.phase).toBe("uncertain");
    expect(invalidated.inFlight?.item).toBe(claimed.inFlight?.item);
  });
});

describe("send queue correctness properties", () => {
  it("preserves unique IDs, item identity, and in-flight exclusivity for every reorder pair", () => {
    const entries = [item("a", ["A"]), item("b", ["B"]), item("c", ["C"]), item("d", ["D"])];
    const claimed = claimHead(laneOf(...entries), { startedAt: 100 });
    const pendingIds = ["b", "c", "d"];
    const destinations: Array<string | null> = [...pendingIds, null];

    for (const movedId of pendingIds) {
      for (const beforeId of destinations) {
        const reordered = reorderBefore(claimed, movedId, beforeId);
        const allIds = [...idsOf(reordered), reordered.inFlight?.item.id];
        expect(new Set(allIds).size).toBe(allIds.length);
        expect(new Set(idsOf(reordered))).toEqual(new Set(pendingIds));
        expect(reordered.inFlight).toBe(claimed.inFlight);
        for (const pending of reordered.pending) {
          expect(pending).toBe(entries.find((entry) => entry.id === pending.id));
        }
      }
    }
  });

  it("never places a duplicate ID in pending and in-flight across transition sequences", () => {
    let lane = laneOf(item("a"), item("b"), item("c"));
    for (let round = 0; round < 3; round += 1) {
      lane = claimHead(lane, { startedAt: round });
      const inFlightId = lane.inFlight?.item.id;
      expect(inFlightId).toBeDefined();
      expect(idsOf(lane)).not.toContain(inFlightId);
      expect(enqueue(lane, item(inFlightId ?? "unreachable"))).toBe(lane);
      lane = markReceipt(lane, inFlightId ?? "unreachable");
      lane = completeTurn(lane, inFlightId ?? "unreachable");
      expect(isSendQueueLane(lane)).toBe(true);
    }
    expect(lane.pending).toEqual([]);
  });

  it("rejects malformed lanes with duplicate or mutually exclusive IDs", () => {
    const duplicatePending = { ...laneOf(item("a")), pending: [item("a"), item("a")] };
    const claimed = claimHead(laneOf(item("a")), { startedAt: 1 });
    const duplicatedAcrossStates = { ...claimed, pending: [item("a")] };

    expect(isSendQueueLane(duplicatePending)).toBe(false);
    expect(isSendQueueLane(duplicatedAcrossStates)).toBe(false);
  });
});

describe("send queue storage", () => {
  it("uses encoded, isolated local/cloud target and account keys", () => {
    expect(localSendQueueKey("session/一")).toBe("mc.sendQueue.v1.local.session%2F%E4%B8%80");
    expect(cloudSendQueueKey("https://api.example|user/a", "task.一")).toBe(
      "mc.sendQueue.v1.cloud.https%3A%2F%2Fapi.example%7Cuser%2Fa.task.%E4%B8%80",
    );
    expect(cloudSendQueueIndexKey("account one")).toBe("mc.sendQueue.v1.cloud.index.account%20one");
    expect(stableCloudAccountScope({
      logged_in: true,
      base_url: "HTTPS://API.Example.com/root/",
      user: { id: " user-1 " },
    })).toBe("https://api.example.com/root|user-1");
    expect(stableCloudAccountScope({ logged_in: true, host: "api.example", user: null })).toBeNull();
  });

  it("round-trips local and cloud lanes with attachment ownership and order intact", () => {
    const localTarget = localSendQueueTarget("local-1");
    const cloudTarget = cloudSendQueueTarget("account-1", "task-1");
    const localLane = laneOf(item("l1", [localAttachment("one.png")]), item("l2", [localAttachment("two.txt")]));
    const cloudLane = reorderBefore(
      laneOf(item("c1", [cloudAttachment("one.png")]), item("c2", [cloudAttachment("two.txt")])),
      "c2",
      "c1",
    );

    expect(writeSendQueueLane(localTarget, localLane).ok).toBe(true);
    expect(writeSendQueueLane(cloudTarget, cloudLane).ok).toBe(true);
    resetSendQueueMemoryForTests();

    expect(readSendQueueLane<LocalQueueAttachment>(localTarget)).toEqual(localLane);
    expect(readSendQueueLane<CloudQueueAttachment>(cloudTarget)).toEqual(cloudLane);
  });

  it("reads old v1 lanes without steering and normalizes the extension without a version bump", () => {
    const target = localSendQueueTarget("old-v1");
    const oldLane = { version: 1, pending: [item("legacy")], inFlight: null, blocked: null };
    storage.setItem(localSendQueueKey("old-v1"), JSON.stringify(oldLane));

    expect(isSendQueueLane(oldLane)).toBe(true);
    expect(readSendQueueLane(target)).toEqual({ ...oldLane, steering: [] });
  });

  it("persists steering claim and keeps ACKed data until matching confirmation", () => {
    const target = localSendQueueTarget("steering-durable");
    writeSendQueueLane(target, laneOf(item("a"), item("b")));
    const claimed = updateSendQueueLane(target, (lane) => claimSteering(lane, "a", 100));
    expect(claimed.ok).toBe(true);
    expect(JSON.parse(storage.getItem(localSendQueueKey("steering-durable")) ?? "null")).toMatchObject({
      pending: [{ id: "b" }],
      steering: [{ item: { id: "a" }, phase: "dispatching" }],
    });

    writeSendQueueLane(target, ackSteering(claimed.lane, "a"));
    const persistedAck = JSON.parse(storage.getItem(localSendQueueKey("steering-durable")) ?? "null");
    expect(persistedAck.pending).toEqual([{ ...item("b") }]);
    expect(persistedAck.steering[0]).toMatchObject({ item: { id: "a" }, phase: "acked" });
    expect(confirmSteering(readSendQueueLane(target), "other").steering).toHaveLength(1);
    expect(confirmSteering(readSendQueueLane(target), "a").steering).toEqual([]);
  });

  it("recovers ACKed steering as visible uncertain and drops clear-requested entries", () => {
    const uncertainTarget = localSendQueueTarget("steering-restart");
    const acked = ackSteering(claimSteering(laneOf(item("a")), "a", 100), "a");
    writeSendQueueLane(uncertainTarget, acked);
    resetSendQueueMemoryForTests();
    expect(readSendQueueLane(uncertainTarget).steering?.[0]?.phase).toBe("uncertain");

    const discardedTarget = localSendQueueTarget("steering-cleared");
    writeSendQueueLane(discardedTarget, clearPending(claimSteering(laneOf(item("gone")), "gone", 101)));
    resetSendQueueMemoryForTests();
    expect(readSendQueueLane(discardedTarget).steering).toEqual([]);
  });

  it("counts steering-only cloud lanes in the non-empty index", () => {
    const target = cloudSendQueueTarget("account", "steering-only");
    const outbox = claimSteering(laneOf(item("a")), "a", 100);
    writeSendQueueLane(target, outbox);
    expect(getCloudQueueIndexSnapshot("account")).toContain("steering-only");
    writeSendQueueLane(target, confirmSteering(outbox, "a"));
    expect(getCloudQueueIndexSnapshot("account")).not.toContain("steering-only");
  });

  it("isolates local sessions, cloud tasks, and cloud account namespaces", () => {
    const localA = localSendQueueTarget("a");
    const localB = localSendQueueTarget("b");
    const cloudA1 = cloudSendQueueTarget("account-a", "task");
    const cloudA2 = cloudSendQueueTarget("account-a", "other-task");
    const cloudB = cloudSendQueueTarget("account-b", "task");

    writeSendQueueLane(localA, laneOf(item("local-a")));
    writeSendQueueLane(localB, laneOf(item("local-b")));
    writeSendQueueLane(cloudA1, laneOf(item("cloud-a1")));
    writeSendQueueLane(cloudA2, laneOf(item("cloud-a2")));
    writeSendQueueLane(cloudB, laneOf(item("cloud-b")));

    expect(idsOf(readSendQueueLane(localA))).toEqual(["local-a"]);
    expect(idsOf(readSendQueueLane(localB))).toEqual(["local-b"]);
    expect(idsOf(readSendQueueLane(cloudA1))).toEqual(["cloud-a1"]);
    expect(idsOf(readSendQueueLane(cloudA2))).toEqual(["cloud-a2"]);
    expect(idsOf(readSendQueueLane(cloudB))).toEqual(["cloud-b"]);
    expect(getCloudQueueIndexSnapshot("account-a")).toEqual(["task", "other-task"]);
    expect(getCloudQueueIndexSnapshot("account-b")).toEqual(["task"]);
  });

  it("maintains the non-empty cloud task index and its subscriptions", () => {
    const target = cloudSendQueueTarget("account", "task");
    const listener = vi.fn();
    const unsubscribe = subscribeCloudQueueIndex("account", listener);

    writeSendQueueLane(target, laneOf(item("a")));
    expect(getCloudQueueIndexSnapshot("account")).toEqual(["task"]);
    expect(JSON.parse(storage.getItem(cloudSendQueueIndexKey("account")) ?? "null")).toEqual(["task"]);
    expect(listener).toHaveBeenCalledTimes(1);

    writeSendQueueLane(target, emptySendQueueLane());
    expect(getCloudQueueIndexSnapshot("account")).toEqual([]);
    expect(storage.getItem(cloudSendQueueIndexKey("account"))).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("deletes only the requested target and exposes the empty lane to synchronous subscribers", () => {
    const removed = cloudSendQueueTarget("account", "removed");
    const retained = cloudSendQueueTarget("account", "retained");
    writeSendQueueLane(removed, laneOf(item("remove-me")));
    writeSendQueueLane(retained, laneOf(item("keep-me")));
    const snapshots: string[][] = [];
    const unsubscribe = subscribeSendQueueLane(removed, () => snapshots.push(idsOf(readSendQueueLane(removed))));

    expect(dropSendQueueTarget(removed)).toEqual({ dropped: true, ok: true, error: null });

    expect(snapshots.at(-1)).toEqual([]);
    expect(idsOf(readSendQueueLane(removed))).toEqual([]);
    expect(idsOf(readSendQueueLane(retained))).toEqual(["keep-me"]);
    expect(getCloudQueueIndexSnapshot("account")).toEqual(["retained"]);
    expect(storage.getItem(cloudSendQueueKey("account", "removed"))).toBeNull();
    unsubscribe();
  });

  it("invalidates only indexed queues in the specified account", () => {
    const accountA = cloudSendQueueTarget("account-a", "task");
    const accountB = cloudSendQueueTarget("account-b", "task");
    writeSendQueueLane(accountA, laneOf(item("a")));
    writeSendQueueLane(accountB, laneOf(item("b")));

    invalidateCloudAccountQueues("account-a", {
      code: "transport-changed",
      message: "transport changed",
      at: 10,
    });

    expect(readSendQueueLane(accountA).blocked?.code).toBe("transport-changed");
    expect(readSendQueueLane(accountB).blocked).toBeNull();
  });

  it("recovers persisted dispatch state as uncertain after a restart", () => {
    const target = localSendQueueTarget("restart");
    const claimed = claimHead(laneOf(item("a", [localAttachment("a.txt")])), { startedAt: 100 });
    writeSendQueueLane(target, claimed);
    resetSendQueueMemoryForTests();

    const restored = readSendQueueLane<LocalQueueAttachment>(target);
    expect(restored.inFlight?.phase).toBe("uncertain");
    expect(restored.blocked?.code).toBe("receipt-unknown");
  });

  it("keeps a trusted running turn waiting across restart", () => {
    const target = localSendQueueTarget("running");
    const acknowledged = markReceipt(
      claimHead(laneOf(item("a", [localAttachment("a.txt")])), { startedAt: 100 }),
      "a",
    );
    writeSendQueueLane(target, acknowledged);
    resetSendQueueMemoryForTests();

    expect(readSendQueueLane<LocalQueueAttachment>(target, { awaitingTurnRunning: true })).toEqual(acknowledged);
  });

  it.each([
    ["invalid JSON", "{broken"],
    ["wrong shape", JSON.stringify({ version: 1, pending: "nope", inFlight: null, blocked: null })],
    [
      "invalid local attachment",
      JSON.stringify(laneOf(item("a", [{ url: "cloud", filename: "a", isImage: false }]))),
    ],
  ])("returns an empty usable lane for %s", (_case, raw) => {
    const target = localSendQueueTarget("corrupt");
    storage.setItem(localSendQueueKey("corrupt"), raw);

    expect(readSendQueueLane(target)).toEqual(emptySendQueueLane());
    expect(getSendQueuePersistenceState(target).ok).toBe(false);
  });

  it("does not overwrite an unknown persisted version", () => {
    const target = localSendQueueTarget("future");
    const raw = JSON.stringify({ version: 2, pending: [{ future: true }] });
    storage.setItem(localSendQueueKey("future"), raw);

    expect(readSendQueueLane(target)).toEqual(emptySendQueueLane());
    expect(writeSendQueueLane(target, laneOf(item("new"))).ok).toBe(false);
    expect(storage.getItem(localSendQueueKey("future"))).toBe(raw);
  });

  it("keeps the latest lane in memory and reports localStorage write failures", () => {
    const target = localSendQueueTarget("write-failure");
    const lane = laneOf(item("a"));
    storage.failSet = true;

    expect(writeSendQueueLane(target, lane)).toEqual({ lane, ok: false, error: "set failed" });
    expect(readSendQueueLane(target)).toBe(lane);
    expect(getSendQueuePersistenceState(target)).toEqual({ ok: false, error: "set failed" });
  });

  it("tolerates corrupt and duplicate cloud indexes", () => {
    storage.setItem(cloudSendQueueIndexKey("corrupt"), "not-json");
    storage.setItem(cloudSendQueueIndexKey("duplicate"), JSON.stringify(["one", "one", "two"]));

    expect(getCloudQueueIndexSnapshot("corrupt")).toEqual([]);
    expect(getCloudQueueIndexSnapshot("duplicate")).toEqual(["one", "two"]);
  });
});
