import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { listenAsync } from "@/lib/ipc/ipc";
import {
  skillsImportCancel,
  skillsImportCommit,
  skillsImportCurrent,
  skillsImportPick,
  isSkillCommandError,
  type SkillImportBatchPreview,
  type SkillImportBatchResult,
  type SkillImportDecision,
  type SkillImportSnapshotEvent,
  type SkillImportSourceKind,
} from "@/lib/ipc/skills";

export type SkillImportOperation = "attaching" | "refreshing" | "picking" | "committing" | "cancelling";

export interface SkillImportPhaseOperations {
  canPick: boolean;
  canCommit: boolean;
  canRetry: boolean;
  canCancel: boolean;
  locked: boolean;
}

export function operationsForSkillImport(batch: SkillImportBatchPreview | null): SkillImportPhaseOperations {
  if (!batch) return { canPick: true, canCommit: false, canRetry: false, canCancel: false, locked: false };
  const picking = batch.in_flight_source_picks > 0;
  if (batch.phase === "collecting") {
    return {
      canPick: !picking,
      canCommit: !picking && batch.items.length > 0,
      canRetry: false,
      canCancel: !picking,
      locked: picking,
    };
  }
  if (batch.phase === "completed") {
    return {
      canPick: false,
      canCommit: false,
      canRetry: batch.items.some((item) => item.state === "failed"),
      canCancel: true,
      locked: false,
    };
  }
  return { canPick: false, canCommit: false, canRetry: false, canCancel: false, locked: true };
}

export interface SkillImportController {
  batch: SkillImportBatchPreview | null;
  snapshotRevision: number;
  operation: SkillImportOperation | null;
  error: unknown;
  operations: SkillImportPhaseOperations;
  refresh: () => Promise<void>;
  pick: (kind: SkillImportSourceKind) => Promise<SkillImportBatchPreview | null>;
  commit: (decisions: SkillImportDecision[], executableContentReviewed: boolean) => Promise<SkillImportBatchResult>;
  cancel: () => Promise<void>;
}

/**
 * 导入批次重附着协议：先 await 监听注册，再读 current。event/current/命令返回
 * 最终都只经 snapshot_revision 单调门提交；删除事件本身是权威墓碑，不再等查询。
 */
export function useSkillImportController(): SkillImportController {
  const [batch, setBatch] = useState<SkillImportBatchPreview | null>(null);
  const [snapshotRevision, setSnapshotRevision] = useState(-1);
  const [operation, setOperation] = useState<SkillImportOperation | null>("attaching");
  const [error, setError] = useState<unknown>(null);
  const aliveRef = useRef(false);
  const revisionRef = useRef(-1);
  const batchRef = useRef<SkillImportBatchPreview | null>(null);

  const accept = useCallback((revision: number, nextBatch: SkillImportBatchPreview | null): boolean => {
    if (!aliveRef.current || revision <= revisionRef.current) return false;
    revisionRef.current = revision;
    batchRef.current = nextBatch;
    setSnapshotRevision(revision);
    setBatch(nextBatch);
    return true;
  }, []);

  const current = useCallback(async () => {
    const snapshot = await skillsImportCurrent();
    accept(snapshot.snapshot_revision, snapshot.batch);
  }, [accept]);

  useEffect(() => {
    aliveRef.current = true;
    let off: (() => void) | null = null;
    void (async () => {
      try {
        off = await listenAsync<SkillImportSnapshotEvent>("skills-import-updated", (event) => {
          if (!aliveRef.current || event.snapshot_revision <= revisionRef.current) return;
          if (event.deleted) {
            accept(event.snapshot_revision, null);
            return;
          }
          void current().catch((reason) => {
            if (aliveRef.current) setError(reason);
          });
        });
        if (!aliveRef.current) {
          off();
          off = null;
          return;
        }
        await current();
      } catch (reason) {
        if (aliveRef.current) setError(reason);
      } finally {
        if (aliveRef.current) setOperation(null);
      }
    })();
    return () => {
      aliveRef.current = false;
      off?.();
    };
  }, [accept, current]);

  const run = useCallback(async <T,>(nextOperation: SkillImportOperation, task: () => Promise<T>): Promise<T> => {
    setOperation(nextOperation);
    setError(null);
    try {
      return await task();
    } catch (reason) {
      if (aliveRef.current) setError(reason);
      throw reason;
    } finally {
      if (aliveRef.current) setOperation(null);
    }
  }, []);

  const refresh = useCallback(() => run("refreshing", current), [current, run]);
  const pick = useCallback(
    (kind: SkillImportSourceKind) =>
      run("picking", async () => {
        try {
          const preview = await skillsImportPick(kind, batchRef.current?.batch_id ?? null);
          if (preview) accept(preview.snapshot_revision, preview);
          return preview;
        } catch (reason) {
          // 另一入口/重载已占用实例唯一批次时，按协议重新附着当前批次并自动打开工作台。
          if (isSkillCommandError(reason) && reason.code === "busy") {
            await current();
            return batchRef.current;
          }
          throw reason;
        }
      }),
    [accept, current, run],
  );
  const commit = useCallback(
    (decisions: SkillImportDecision[], executableContentReviewed: boolean) =>
      run("committing", async () => {
        const batchId = batchRef.current?.batch_id;
        if (!batchId) throw new Error("没有可提交的技能导入批次");
        try {
          const result = await skillsImportCommit(batchId, decisions, executableContentReviewed);
          await current();
          return result;
        } catch (reason) {
          // 预检可能重算并写回冲突；失败也必须重附着权威快照供用户重新决策。
          await current().catch(() => {});
          throw reason;
        }
      }),
    [current, run],
  );
  const cancel = useCallback(
    () =>
      run("cancelling", async () => {
        const batchId = batchRef.current?.batch_id;
        if (!batchId) return;
        await skillsImportCancel(batchId);
        await current();
      }),
    [current, run],
  );

  return useMemo(
    () => ({
      batch,
      snapshotRevision,
      operation,
      error,
      operations: operationsForSkillImport(batch),
      refresh,
      pick,
      commit,
      cancel,
    }),
    [batch, snapshotRevision, operation, error, refresh, pick, commit, cancel],
  );
}
