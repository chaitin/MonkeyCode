import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  cloudSendQueueTarget,
  dropCloudSendQueue,
  getCloudQueueIndexSnapshot,
  invalidateCloudAccountQueues,
  stableCloudAccountScope,
  subscribeCloudQueueIndex,
  type CloudAccountIdentity,
  type SendQueueBlock,
} from "@/features/chat/composer/sendQueue";
import {
  createCloudTaskRuntime,
  defaultCloudRuntimeDeps,
  type CloudRuntimeDeps,
  type CloudTaskRuntime,
  type CloudTaskRuntimeLease,
  type CloudTaskRuntimeSnapshot,
} from "@/features/cloud/cloudTaskRuntime";
import { mcStatus } from "@/lib/ipc/account";
import { useMcTransport } from "@/lib/mcTransport";

export type CloudAttentionReason = "task-ended" | "error";

export interface CloudQueueCoordinatorDeps {
  getIndex(accountScope: string): readonly string[];
  subscribeIndex(accountScope: string, listener: () => void): () => void;
  dropLane(accountScope: string, taskId: string): void;
  invalidateAccount(accountScope: string, reason: SendQueueBlock): void;
  createRuntime(accountScope: string, taskId: string): CloudTaskRuntime;
}

interface RuntimeEntry {
  runtime: CloudTaskRuntime;
  queueLease: CloudTaskRuntimeLease | null;
  viewLeases: number;
}

/** 非 React 核心，便于用假 runtime/index 验证唯一性与资源释放。 */
export class CloudQueueCoordinatorCore {
  readonly accountScope: string;
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly unsubscribeIndex: () => void;
  private disposed = false;

  constructor(accountScope: string, private readonly deps: CloudQueueCoordinatorDeps) {
    this.accountScope = accountScope;
    this.unsubscribeIndex = deps.subscribeIndex(accountScope, () => this.syncIndex());
    this.syncIndex();
  }

  private getOrCreate(taskId: string): RuntimeEntry {
    const existing = this.entries.get(taskId);
    if (existing) return existing;
    if (this.disposed) throw new Error("CloudQueueCoordinator is disposed");
    const entry: RuntimeEntry = {
      runtime: this.deps.createRuntime(this.accountScope, taskId),
      queueLease: null,
      viewLeases: 0,
    };
    this.entries.set(taskId, entry);
    return entry;
  }

  private cleanup(taskId: string, entry: RuntimeEntry) {
    if (entry.queueLease || entry.viewLeases > 0) return;
    // React StrictMode 会做 effect setup→cleanup→setup 探测。同步 dispose 会让
    // 第二次 setup 从 coordinator 借到新 runtime，而 hook 仍订阅第一次 render
    // 取得的旧实例。押后一微任务，真实卸载仍会释放，StrictMode 重借则可复用。
    queueMicrotask(() => {
      if (this.entries.get(taskId) !== entry || entry.queueLease || entry.viewLeases > 0) return;
      entry.runtime.dispose();
      this.entries.delete(taskId);
    });
  }

  private syncIndex() {
    if (this.disposed) return;
    const indexed = new Set(this.deps.getIndex(this.accountScope));
    for (const taskId of indexed) {
      const entry = this.getOrCreate(taskId);
      entry.queueLease ??= entry.runtime.acquire("queue");
    }
    for (const [taskId, entry] of this.entries) {
      if (indexed.has(taskId) || !entry.queueLease) continue;
      entry.queueLease.release();
      entry.queueLease = null;
      this.cleanup(taskId, entry);
    }
  }

  runtime(taskId: string): CloudTaskRuntime {
    return this.getOrCreate(taskId).runtime;
  }

  acquireView(taskId: string): { runtime: CloudTaskRuntime; release(): void } {
    const entry = this.getOrCreate(taskId);
    entry.viewLeases += 1;
    const lease = entry.runtime.acquire("view");
    let released = false;
    return {
      runtime: entry.runtime,
      release: () => {
        if (released) return;
        released = true;
        lease.release();
        entry.viewLeases = Math.max(0, entry.viewLeases - 1);
        this.cleanup(taskId, entry);
      },
    };
  }

  confirmResume(taskId: string) {
    this.getOrCreate(taskId).runtime.confirmResume();
  }

  dropTask(taskId: string) {
    const entry = this.entries.get(taskId);
    if (entry) {
      entry.queueLease?.release();
      entry.runtime.dispose();
      this.entries.delete(taskId);
    }
    this.deps.dropLane(this.accountScope, taskId);
  }

  invalidate(reason: SendQueueBlock) {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeIndex();
    // 先让 runtime token/连接失效，再持久化账号级 block；旧回调没有窗口可写。
    for (const entry of this.entries.values()) entry.runtime.invalidate(reason);
    this.deps.invalidateAccount(this.accountScope, reason);
    for (const entry of this.entries.values()) entry.runtime.dispose();
    this.entries.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeIndex();
    for (const entry of this.entries.values()) entry.runtime.dispose();
    this.entries.clear();
  }

  /** 测试/诊断：不暴露可变 map。 */
  runtimeCount() {
    return this.entries.size;
  }
}

interface CoordinatorRegistryEntry {
  coordinator: CloudQueueCoordinatorCore;
  refs: number;
}

// Provider 也必须经得住 React StrictMode 的 effect setup→cleanup→setup。
// 账号+transport generation 是所有权键；同一页面绝不临时造第二个 core。
const coordinatorRegistry = new Map<string, CoordinatorRegistryEntry>();

export interface CloudQueueCoordinatorApi {
  accountScope: string | null;
  available: boolean;
  runtime(taskId: string): CloudTaskRuntime;
  acquireView(taskId: string): { runtime: CloudTaskRuntime; release(): void };
  confirmResume(taskId: string): void;
  dropTask(taskId: string): void;
  attention(taskId: string, reason: CloudAttentionReason): void;
}

const unavailable = (): never => {
  throw new Error("Cloud queue is unavailable because the account identity is not stable");
};

const FALLBACK_API: CloudQueueCoordinatorApi = {
  accountScope: null,
  available: false,
  runtime: unavailable,
  acquireView: unavailable,
  confirmResume: unavailable,
  dropTask: unavailable,
  attention: unavailable,
};

const CloudQueueContext = createContext<CloudQueueCoordinatorApi>(FALLBACK_API);

export interface CloudQueueCoordinatorProviderProps {
  children: ReactNode | ((api: CloudQueueCoordinatorApi) => ReactNode);
  onAttention?: (taskId: string, reason: CloudAttentionReason) => void;
  /** 测试可直接注入账号查询；生产缺省走 mc_status。 */
  loadIdentity?: () => Promise<CloudAccountIdentity | null>;
  createDeps?: (
    accountScope: string,
    generation: number,
    isCurrent: (generation: number) => boolean,
    onAttention?: (taskId: string, reason: CloudAttentionReason) => void,
  ) => CloudRuntimeDeps;
}

export function CloudQueueCoordinatorProvider({
  children,
  onAttention,
  loadIdentity = mcStatus,
  createDeps = defaultCloudRuntimeDeps,
}: CloudQueueCoordinatorProviderProps) {
  const { generation, isCurrent } = useMcTransport();
  const [identityState, setIdentityState] = useState<{
    generation: number;
    scope: string | null;
  }>({ generation, scope: null });

  useEffect(() => {
    let alive = true;
    void loadIdentity()
      .then((identity) => {
        if (!alive || !isCurrent(generation)) return;
        const scope = stableCloudAccountScope(identity);
        setIdentityState((previous) =>
          previous.generation === generation && previous.scope === scope ? previous : { generation, scope },
        );
      })
      .catch(() => {
        if (alive && isCurrent(generation)) {
          setIdentityState((previous) =>
            previous.generation === generation && previous.scope === null
              ? previous
              : { generation, scope: null },
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [generation, isCurrent, loadIdentity]);

  const accountScope = identityState.generation === generation ? identityState.scope : null;
  const [coordinatorState, setCoordinatorState] = useState<{
    generation: number;
    accountScope: string;
    coordinator: CloudQueueCoordinatorCore;
  } | null>(null);
  // 只允许已知账号作用域的删除跨过 coordinator 建立的微任务窗口。身份未决时
  // 绝不缓存 taskId：同 ID 可能随后属于另一个账号，宁可保留旧 namespace。
  const pendingDrops = useMemo(() => new Map<string, Set<string>>(), []);
  const coordinator =
    coordinatorState?.generation === generation && coordinatorState.accountScope === accountScope
      ? coordinatorState.coordinator
      : null;
  useEffect(() => {
    let alive = true;
    if (!accountScope) {
      queueMicrotask(() => {
        if (alive) setCoordinatorState(null);
      });
      return () => {
        alive = false;
      };
    }
    const registryKey = `${generation}\u0000${accountScope}`;
    let registered = coordinatorRegistry.get(registryKey);
    if (!registered) {
      const coordinatorDeps: CloudQueueCoordinatorDeps = {
        getIndex: getCloudQueueIndexSnapshot,
        subscribeIndex: subscribeCloudQueueIndex,
        dropLane: dropCloudSendQueue,
        invalidateAccount: (scope, reason) => {
          invalidateCloudAccountQueues(scope, reason);
        },
        createRuntime: (scope, taskId) =>
          createCloudTaskRuntime(scope, taskId, createDeps(scope, generation, isCurrent, onAttention)),
      };
      registered = { coordinator: new CloudQueueCoordinatorCore(accountScope, coordinatorDeps), refs: 0 };
      coordinatorRegistry.set(registryKey, registered);
    }
    registered.refs += 1;
    queueMicrotask(() => {
      if (alive) setCoordinatorState({ generation, accountScope, coordinator: registered!.coordinator });
    });
    return () => {
      alive = false;
      registered!.refs = Math.max(0, registered!.refs - 1);
      queueMicrotask(() => {
        const current = coordinatorRegistry.get(registryKey);
        if (current !== registered || current.refs > 0) return;
        current.coordinator.invalidate({
          code: "transport-changed",
          message: "Cloud account or transport changed; confirm before resuming",
          at: Date.now(),
        });
        coordinatorRegistry.delete(registryKey);
      });
    };
  }, [accountScope, createDeps, generation, isCurrent, onAttention]);

  useEffect(() => {
    if (!coordinator || !accountScope) return;
    const key = `${generation}\u0000${accountScope}`;
    const taskIds = pendingDrops.get(key);
    if (!taskIds) return;
    pendingDrops.delete(key);
    for (const taskId of taskIds) coordinator.dropTask(taskId);
  }, [accountScope, coordinator, generation, pendingDrops]);

  const api = useMemo<CloudQueueCoordinatorApi>(() => {
    if (!coordinator) {
      return {
        ...FALLBACK_API,
        // 仅 scope 已知、只是 coordinator 尚未挂好时可押后；身份未决直接保守保留。
        dropTask: (taskId) => {
          if (!accountScope) return;
          const key = `${generation}\u0000${accountScope}`;
          const taskIds = pendingDrops.get(key) ?? new Set<string>();
          taskIds.add(taskId);
          pendingDrops.set(key, taskIds);
        },
      };
    }
    return {
      accountScope,
      available: true,
      runtime: (taskId) => coordinator.runtime(taskId),
      acquireView: (taskId) => coordinator.acquireView(taskId),
      confirmResume: (taskId) => coordinator.confirmResume(taskId),
      dropTask: (taskId) => coordinator.dropTask(taskId),
      attention: (taskId, reason) => onAttention?.(taskId, reason),
    };
  }, [accountScope, coordinator, generation, onAttention, pendingDrops]);

  return (
    <CloudQueueContext.Provider value={api}>
      {typeof children === "function" ? children(api) : children}
    </CloudQueueContext.Provider>
  );
}

export const useCloudQueue = () => useContext(CloudQueueContext);

export interface CloudQueueTaskHandle {
  runtime: CloudTaskRuntime;
  snapshot: CloudTaskRuntimeSnapshot;
  sendFrame(type: string, payload?: unknown): Promise<void>;
  cancelRun(): Promise<void>;
  borrowControl(): ReturnType<CloudTaskRuntime["borrowControl"]>;
  confirmResume(): void;
}

/** 任务 6 的迁移入口；本任务只提供订阅/acquire 基础，不改 useCloudTask。 */
export function useCloudQueueTask(taskId: string): CloudQueueTaskHandle | null {
  const coordinator = useCloudQueue();
  const runtime = useMemo(
    () => (coordinator.available ? coordinator.runtime(taskId) : null),
    [coordinator, taskId],
  );
  const unavailableSnapshot = useMemo<CloudTaskRuntimeSnapshot>(() => ({
    taskId,
    accountScope: "",
    detail: null,
    reconciling: true,
    streamStatus: null,
    connected: false,
    controlStatus: null,
    controlConnected: false,
    error: "",
    event: null,
  }), [taskId]);
  const subscribe = runtime?.subscribe ?? (() => () => undefined);
  const getSnapshot = runtime?.getSnapshot ?? (() => unavailableSnapshot);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!runtime) return;
    const lease = coordinator.acquireView(taskId);
    return lease.release;
  }, [coordinator, runtime, taskId]);
  return useMemo(
    () => runtime ? ({
      runtime,
      snapshot,
      sendFrame: runtime.sendFrame.bind(runtime),
      cancelRun: runtime.cancelRun.bind(runtime),
      borrowControl: runtime.borrowControl.bind(runtime),
      confirmResume: runtime.confirmResume.bind(runtime),
    }) : null,
    [runtime, snapshot],
  );
}

// 保留目标键导出可被外部集成测试断言，不让 Provider 私造第二套命名规则。
export { cloudSendQueueTarget };
