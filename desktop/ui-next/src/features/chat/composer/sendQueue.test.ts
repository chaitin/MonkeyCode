import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  block,
  claimHead,
  cloudSendQueueIndexKey,
  cloudSendQueueKey,
  cloudSendQueueTarget,
  completeTurn,
  confirmResume,
  createSendQueueItem,
  discardUncertain,
  dropSendQueueTarget,
  emptySendQueueLane,
  enqueue,
  getCloudQueueIndexSnapshot,
  getSendQueuePersistenceState,
  invalidateCloudAccountQueues,
  isSendQueueLane,
  localSendQueueKey,
  localSendQueueTarget,
  markReceipt,
  markUncertain,
  nackHead,
  readSendQueueLane,
  recoverLaneAfterRestart,
  remove,
  reorderBefore,
  resetSendQueueMemoryForTests,
  stableCloudAccountScope,
  subscribeCloudQueueIndex,
  subscribeSendQueueLane,
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
