import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  CloudQueueCoordinatorProvider,
  CloudQueueCoordinatorCore,
  type CloudQueueCoordinatorApi,
  type CloudQueueCoordinatorDeps,
} from "@/features/cloud/CloudQueueCoordinator";
import {
  cloudSendQueueTarget,
  createSendQueueItem,
  emptySendQueueLane,
  enqueue,
  readSendQueueLane,
  resetSendQueueMemoryForTests,
  writeSendQueueLane,
  type CloudAccountIdentity,
  type SendQueueBlock,
} from "@/features/chat/composer/sendQueue";
import type {
  CloudTaskRuntimeSnapshot,
} from "@/features/cloud/cloudTaskRuntime";
import { defaultCloudRuntimeDeps } from "@/features/cloud/cloudTaskRuntime";
import type { CloudControl } from "@/lib/cloud/control";
import { McTransportProvider } from "@/lib/mcTransport";

function fakeRuntime(taskId: string) {
  const snapshot: CloudTaskRuntimeSnapshot = {
    taskId,
    accountScope: "acct",
    detail: null,
    reconciling: true,
    streamStatus: null,
    connected: false,
    controlStatus: null,
    controlConnected: false,
    error: "",
    event: null,
  };
  const acquireCalls: Array<"view" | "queue"> = [];
  const releases: ReturnType<typeof vi.fn>[] = [];
  return {
    taskId,
    accountScope: "acct",
    acquireCalls,
    releases,
    acquire(reason: "view" | "queue") {
      acquireCalls.push(reason);
      const release = vi.fn();
      releases.push(release);
      return { release };
    },
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    sendFrame: vi.fn(async () => undefined),
    cancelRun: vi.fn(async () => undefined),
    borrowControl: vi.fn(() => ({ ctrl: {} as CloudControl, release: vi.fn() })),
    confirmModel: vi.fn(() => undefined),
    confirmResume: vi.fn(() => undefined),
    invalidate: vi.fn((_reason?: SendQueueBlock) => undefined),
    dispose: vi.fn(() => undefined),
  };
}

function harness(initialIndex: string[] = []) {
  let index = initialIndex;
  const listeners = new Set<() => void>();
  const runtimes = new Map<string, ReturnType<typeof fakeRuntime>>();
  const createRuntime = vi.fn((_scope: string, taskId: string) => {
    const runtime = fakeRuntime(taskId);
    runtimes.set(taskId, runtime);
    return runtime;
  });
  const dropLane = vi.fn();
  const invalidateAccount = vi.fn();
  const deps: CloudQueueCoordinatorDeps = {
    getIndex: () => index,
    subscribeIndex: (_scope, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dropLane,
    invalidateAccount,
    createRuntime,
  };
  const core = new CloudQueueCoordinatorCore("acct", deps);
  return {
    core,
    runtimes,
    createRuntime,
    dropLane,
    invalidateAccount,
    setIndex(value: string[]) {
      index = value;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

describe("CloudQueueCoordinatorCore", () => {
  it("accountScope+taskId 只创建一个 runtime，queue/view 分别引用", () => {
    const h = harness(["t1"]);
    const runtime = h.runtimes.get("t1")!;
    expect(h.createRuntime).toHaveBeenCalledTimes(1);
    expect(runtime.acquireCalls).toEqual(["queue"]);

    const first = h.core.acquireView("t1");
    const second = h.core.acquireView("t1");
    expect(first.runtime).toBe(runtime);
    expect(second.runtime).toBe(runtime);
    expect(h.core.runtime("t1")).toBe(runtime);
    expect(h.createRuntime).toHaveBeenCalledTimes(1);
    expect(runtime.acquireCalls).toEqual(["queue", "view", "view"]);

    first.release();
    first.release();
    expect(runtime.releases[1]).toHaveBeenCalledTimes(1);
    expect(runtime.dispose).not.toHaveBeenCalled();
  });

  it("模块索引动态创建后台 runtime；队列清空且无视图时释放", async () => {
    const h = harness();
    expect(h.core.runtimeCount()).toBe(0);
    h.setIndex(["t1", "t2"]);
    expect(h.core.runtimeCount()).toBe(2);
    expect(h.runtimes.get("t1")?.acquireCalls).toEqual(["queue"]);

    h.setIndex(["t2"]);
    expect(h.runtimes.get("t1")?.releases[0]).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(h.runtimes.get("t1")?.dispose).toHaveBeenCalledTimes(1);
    expect(h.core.runtimeCount()).toBe(1);
  });

  it("视图切换不会终止仍有 queue 引用的后台任务", async () => {
    const h = harness(["t1"]);
    const runtime = h.runtimes.get("t1")!;
    const view = h.core.acquireView("t1");
    view.release();
    expect(runtime.dispose).not.toHaveBeenCalled();

    h.setIndex([]);
    await Promise.resolve();
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });

  it("StrictMode effect 重放在同一微任务复用原 runtime", async () => {
    const h = harness();
    const first = h.core.acquireView("t1");
    const runtime = first.runtime as ReturnType<typeof fakeRuntime>;
    first.release();
    const replay = h.core.acquireView("t1");
    await Promise.resolve();
    expect(replay.runtime).toBe(runtime);
    expect(h.createRuntime).toHaveBeenCalledTimes(1);
    expect(runtime.dispose).not.toHaveBeenCalled();
  });

  it("删除成功 API 先停 runtime 再删除账号隔离 lane", () => {
    const h = harness(["t1"]);
    const runtime = h.runtimes.get("t1")!;
    h.core.dropTask("t1");
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
    expect(h.dropLane).toHaveBeenCalledWith("acct", "t1");
    expect(h.core.runtimeCount()).toBe(0);
  });

  it("账号/transport 失效使全部 token 先失效、持久化 blocked 并退订索引", () => {
    const h = harness(["t1", "t2"]);
    const reason = { code: "transport-changed" as const, message: "changed", at: 10 };
    h.core.invalidate(reason);
    expect(h.listenerCount()).toBe(0);
    expect(h.runtimes.get("t1")?.invalidate).toHaveBeenCalledWith(reason);
    expect(h.runtimes.get("t2")?.invalidate).toHaveBeenCalledWith(reason);
    expect(h.invalidateAccount).toHaveBeenCalledWith("acct", reason);
    expect(h.runtimes.get("t1")?.dispose).toHaveBeenCalledTimes(1);
    expect(h.core.runtimeCount()).toBe(0);
  });
});

describe("CloudQueueCoordinatorProvider", () => {
  it("身份未决时的删除不会跨 generation 落到新账号同 ID lane", async () => {
    localStorage.clear();
    resetSendQueueMemoryForTests();
    const taskId = "same-task";
    const scopeB = "https://cloud-b.example|user-b";
    const targetB = cloudSendQueueTarget(scopeB, taskId);
    writeSendQueueLane(targetB, enqueue(emptySendQueueLane(), createSendQueueItem("B queue", [])));

    const identityResolvers: Array<(identity: CloudAccountIdentity) => void> = [];
    const loadIdentity = vi.fn(() => new Promise<CloudAccountIdentity>((resolve) => {
      identityResolvers.push(resolve);
    }));
    let currentGeneration = 1;
    const isCurrent = (value: number) => value === currentGeneration;
    let api: CloudQueueCoordinatorApi | null = null;
    const tree = (generation: number) => (
      <McTransportProvider generation={generation} isCurrent={isCurrent}>
        <CloudQueueCoordinatorProvider
          loadIdentity={loadIdentity}
          createDeps={(scope, value, current) => ({
            ...defaultCloudRuntimeDeps(scope, value, current),
            taskInfo: async () => ({ id: taskId, status: "pending" as const }),
            pollMs: 60_000,
          })}
        >
          {(value) => {
            api = value;
            return <span data-testid="availability">{value.available ? value.accountScope : "unavailable"}</span>;
          }}
        </CloudQueueCoordinatorProvider>
      </McTransportProvider>
    );

    const view = render(tree(1));
    await waitFor(() => expect(identityResolvers).toHaveLength(1));
    api!.dropTask(taskId); // generation 1，且账号身份仍未知

    currentGeneration = 2;
    view.rerender(tree(2));
    expect(api!.available).toBe(false);
    await waitFor(() => expect(identityResolvers).toHaveLength(2));
    await act(async () => {
      identityResolvers[1]!({ logged_in: true, base_url: "https://cloud-b.example", user: { id: "user-b" } });
    });
    await waitFor(() => expect(screen.getByTestId("availability").textContent).toBe(scopeB));
    expect(readSendQueueLane(targetB).pending.map((item) => item.content)).toEqual(["B queue"]);
    view.unmount();
  });

  it("generation/scope 切换期间绝不暴露旧 coordinator", async () => {
    localStorage.clear();
    resetSendQueueMemoryForTests();
    let currentGeneration = 1;
    const isCurrent = (value: number) => value === currentGeneration;
    const identities = {
      1: { logged_in: true, base_url: "https://cloud-a.example", user: { id: "user-a" } },
      2: { logged_in: true, base_url: "https://cloud-b.example", user: { id: "user-b" } },
    } as const;
    let api: CloudQueueCoordinatorApi | null = null;
    const tree = (generation: 1 | 2) => (
      <McTransportProvider generation={generation} isCurrent={isCurrent}>
        <CloudQueueCoordinatorProvider loadIdentity={async () => identities[generation]}>
          {(value) => {
            api = value;
            return <span data-testid="matched-scope">{value.available ? value.accountScope : "unavailable"}</span>;
          }}
        </CloudQueueCoordinatorProvider>
      </McTransportProvider>
    );

    const view = render(tree(1));
    await waitFor(() => expect(screen.getByTestId("matched-scope").textContent).toBe("https://cloud-a.example|user-a"));
    expect(api!.runtime("same-task").accountScope).toBe("https://cloud-a.example|user-a");

    currentGeneration = 2;
    view.rerender(tree(2));
    // 新 generation 的 identity effect 尚未完成时，旧 coordinator 必须立即隐藏。
    expect(api!.available).toBe(false);
    expect(screen.getByTestId("matched-scope").textContent).toBe("unavailable");
    await waitFor(() => expect(screen.getByTestId("matched-scope").textContent).toBe("https://cloud-b.example|user-b"));
    expect(api!.runtime("same-task").accountScope).toBe("https://cloud-b.example|user-b");
    view.unmount();
  });

  it("StrictMode 下同一 accountScope+taskId 仍只创建一个 runtime", async () => {
    localStorage.clear();
    resetSendQueueMemoryForTests();
    const accountScope = "https://cloud.example|u1";
    const target = cloudSendQueueTarget(accountScope, "t1");
    writeSendQueueLane(
      target,
      enqueue(emptySendQueueLane(), createSendQueueItem("queued", [], { id: "m1", createdAt: 1 })),
    );
    const createDeps = vi.fn((scope: string, generation: number, isCurrent: (value: number) => boolean) => ({
      ...defaultCloudRuntimeDeps(scope, generation, isCurrent),
      taskInfo: async () => ({ id: "t1", status: "pending" as const }),
      pollMs: 60_000,
    }));
    const view = render(
      <StrictMode>
        <McTransportProvider generation={3} isCurrent={(value) => value === 3}>
          <CloudQueueCoordinatorProvider
            loadIdentity={async () => ({
              logged_in: true,
              base_url: "https://cloud.example",
              user: { id: "u1" },
            })}
            createDeps={createDeps}
          >
            {(api) => <span>{api.available ? "available" : "unavailable"}</span>}
          </CloudQueueCoordinatorProvider>
        </McTransportProvider>
      </StrictMode>,
    );

    await screen.findByText("available");
    await waitFor(() => expect(createDeps).toHaveBeenCalledTimes(1));
    view.unmount();
    await Promise.resolve();
  });
});
