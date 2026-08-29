import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { listenAsync } from "@/lib/ipc/ipc";
import { skillsList, type SkillInfo, type SkillsCatalogSnapshot } from "@/lib/ipc/skills";

export interface SkillsCatalogChangedEvent {
  revision: number;
  store_id: string;
}

export interface SkillsCatalogValue {
  skills: SkillInfo[];
  revision: number;
  storeId: string | null;
  loading: boolean;
  ready: boolean;
  error: unknown;
  /** 校准服务端快照；targetRevision 用于等待 mutation 已提交的版本可见。 */
  refreshSkillsCatalog: (targetRevision?: number) => Promise<SkillsCatalogSnapshot>;
  calibrateSkillsCatalog: () => void;
}

export class SkillsCatalogSubscriptionError extends Error {
  readonly code = "skills-catalog-listen-failed";
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(`监听技能目录变更失败: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "SkillsCatalogSubscriptionError";
    this.cause = cause;
  }
}

export class SkillsCatalogProviderUnmountedError extends Error {
  readonly code = "skills-catalog-provider-unmounted";

  constructor() {
    super("技能目录 Provider 已卸载");
    this.name = "SkillsCatalogProviderUnmountedError";
  }
}

interface RevisionWaiter {
  targetRevision: number;
  resolve: (snapshot: SkillsCatalogSnapshot) => void;
  reject: (reason: unknown) => void;
}

const SkillsCatalogContext = createContext<SkillsCatalogValue | null>(null);

export function useOptionalSkillsCatalog(): SkillsCatalogValue | null {
  return useContext(SkillsCatalogContext);
}

export function useSkillsCatalog(): SkillsCatalogValue {
  const value = useOptionalSkillsCatalog();
  if (!value) throw new Error("useSkillsCatalog 必须在 SkillsCatalogProvider 内使用");
  return value;
}

function sameCatalog(left: SkillsCatalogSnapshot, right: SkillsCatalogSnapshot): boolean {
  return left.store_id === right.store_id && JSON.stringify(left.skills) === JSON.stringify(right.skills);
}

export function SkillsCatalogProvider({
  children,
  beforeAcceptCatalog,
}: {
  children: ReactNode;
  /** catalog 提升前先让 App 的会话层拉取并消费有效 skills_revision。 */
  beforeAcceptCatalog?: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<SkillsCatalogSnapshot>({ revision: -1, store_id: "", skills: [] });
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const aliveRef = useRef(false);
  const lifecycleRef = useRef(0);
  const snapshotRef = useRef(snapshot);
  const generationRef = useRef(0);
  const beforeAcceptRef = useRef(beforeAcceptCatalog);
  const waitersRef = useRef(new Set<RevisionWaiter>());

  useEffect(() => {
    beforeAcceptRef.current = beforeAcceptCatalog;
  }, [beforeAcceptCatalog]);

  const resolveAcceptedWaiters = useCallback((accepted: SkillsCatalogSnapshot) => {
    for (const waiter of [...waitersRef.current]) {
      if (accepted.revision < waiter.targetRevision) continue;
      waitersRef.current.delete(waiter);
      waiter.resolve(accepted);
    }
  }, []);

  const rejectWaiter = useCallback((waiter: RevisionWaiter, reason: unknown) => {
    if (!waitersRef.current.delete(waiter)) return;
    waiter.reject(reason);
  }, []);

  const waitForServerRevision = useCallback((targetRevision: number) => {
    const current = snapshotRef.current;
    if (current.revision >= targetRevision) {
      return {
        waiter: null,
        promise: Promise.resolve(current),
      };
    }
    let waiter!: RevisionWaiter;
    const promise = new Promise<SkillsCatalogSnapshot>((resolve, reject) => {
      waiter = { targetRevision, resolve, reject };
      waitersRef.current.add(waiter);
    });
    return { waiter, promise };
  }, []);

  const startReconcile = useCallback(() => {
    const generation = ++generationRef.current;
    const lifecycle = lifecycleRef.current;
    const active = () => aliveRef.current && lifecycleRef.current === lifecycle;

    if (!active()) {
      return {
        generation,
        promise: Promise.reject<SkillsCatalogSnapshot>(new SkillsCatalogProviderUnmountedError()),
      };
    }
    setLoading(true);

    const promise = (async (): Promise<SkillsCatalogSnapshot> => {
      try {
        const incoming = await skillsList();
        if (!active()) throw new SkillsCatalogProviderUnmountedError();

        const current = snapshotRef.current;
        if (incoming.revision > current.revision || incoming.store_id !== current.store_id) {
          await beforeAcceptRef.current?.();
          if (!active()) throw new SkillsCatalogProviderUnmountedError();
          const latest = snapshotRef.current;
          if (incoming.store_id !== latest.store_id || incoming.revision > latest.revision) {
            snapshotRef.current = incoming;
            setSnapshot(incoming);
            // target waiter 只能由真正接受的服务端 snapshot 唤醒。
            resolveAcceptedWaiters(incoming);
          } else if (incoming.revision === latest.revision && !sameCatalog(incoming, latest)) {
            throw new Error(`技能目录 revision ${incoming.revision} 内容不一致`);
          }
        } else if (incoming.revision === current.revision && !sameCatalog(incoming, current)) {
          throw new Error(`技能目录 revision ${incoming.revision} 内容不一致`);
        }

        // generation 不参与 catalog 新旧判据，只决定请求级 UI 状态归属。
        if (active() && generation === generationRef.current) {
          setReady(true);
          setError(null);
        }
        return snapshotRef.current.revision >= incoming.revision ? snapshotRef.current : incoming;
      } catch (reason) {
        if (active() && generation === generationRef.current) setError(reason);
        throw reason;
      } finally {
        if (active() && generation === generationRef.current) setLoading(false);
      }
    })();

    return { generation, promise };
  }, [resolveAcceptedWaiters]);

  const refreshSkillsCatalog = useCallback((targetRevision?: number): Promise<SkillsCatalogSnapshot> => {
    if (targetRevision === undefined) return startReconcile().promise;

    const waiting = waitForServerRevision(targetRevision);
    if (!waiting.waiter) return waiting.promise;

    const request = startReconcile();
    void request.promise.catch((reason) => {
      // target 调用必须由它启动的请求 settle；generation 只控制 UI 状态。
      // 若另一请求已接受到 target，waiter 已被删除，此处 reject 自然 no-op。
      if (waiting.waiter) rejectWaiter(waiting.waiter, reason);
    });
    return waiting.promise;
  }, [rejectWaiter, startReconcile, waitForServerRevision]);

  const calibrateSkillsCatalog = useCallback(() => {
    void refreshSkillsCatalog().catch(() => {});
  }, [refreshSkillsCatalog]);

  useEffect(() => {
    const lifecycle = ++lifecycleRef.current;
    const lifecycleWaiters = waitersRef.current;
    aliveRef.current = true;
    let disposed = false;
    let listenerSettled = false;
    let offCatalog: (() => void) | null = null;
    const active = () => !disposed && aliveRef.current && lifecycleRef.current === lifecycle;
    const onFocus = () => {
      // 注册期间的 focus 由注册完成后的首次校准覆盖，不得提前穿透监听屏障。
      if (listenerSettled) calibrateSkillsCatalog();
    };

    if (typeof window !== "undefined") window.addEventListener("focus", onFocus);

    void (async () => {
      if (typeof window === "undefined") {
        listenerSettled = true;
        if (active()) calibrateSkillsCatalog();
        return;
      }
      try {
        offCatalog = await listenAsync<SkillsCatalogChangedEvent>(
          "skills-catalog-changed",
          () => calibrateSkillsCatalog(),
        );
      } catch (reason) {
        if (!active()) return;
        listenerSettled = true;
        // 若期间已有 focus 请求，不能让更旧的监听失败覆盖其 success/error。
        if (generationRef.current === 0) setError(new SkillsCatalogSubscriptionError(reason));
        // 监听不可用时仍做一次 fallback query；之后窗口 focus 继续校准。
        calibrateSkillsCatalog();
        return;
      }
      if (!active()) {
        offCatalog();
        offCatalog = null;
        return;
      }
      listenerSettled = true;
      // 首次 reconcile 必须发生在监听注册完成、拿到 unlisten 之后；注册期间
      // 到达的 focus 合并进同一次校准，不提前穿透监听屏障。
      calibrateSkillsCatalog();
    })();

    return () => {
      disposed = true;
      if (lifecycleRef.current === lifecycle) {
        aliveRef.current = false;
        lifecycleRef.current += 1;
      }
      offCatalog?.();
      offCatalog = null;
      if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
      const reason = new SkillsCatalogProviderUnmountedError();
      for (const waiter of [...lifecycleWaiters]) rejectWaiter(waiter, reason);
    };
  }, [calibrateSkillsCatalog, rejectWaiter]);

  const value = useMemo<SkillsCatalogValue>(
    () => ({
      skills: snapshot.skills,
      revision: Math.max(0, snapshot.revision),
      storeId: snapshot.store_id || null,
      loading,
      ready,
      error,
      refreshSkillsCatalog,
      calibrateSkillsCatalog,
    }),
    [snapshot, loading, ready, error, refreshSkillsCatalog, calibrateSkillsCatalog],
  );

  return <SkillsCatalogContext.Provider value={value}>{children}</SkillsCatalogContext.Provider>;
}
