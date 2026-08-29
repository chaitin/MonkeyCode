import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SkillImportBatchPreview, SkillImportSnapshotEvent } from "@/lib/ipc/skills";
import { operationsForSkillImport, useSkillImportController } from "./useSkillImportController";

const batch = (revision: number, phase: SkillImportBatchPreview["phase"] = "collecting"): SkillImportBatchPreview => ({
  batch_id: "batch-1",
  phase,
  snapshot_revision: revision,
  in_flight_source_picks: 0,
  catalog_revision: null,
  sources: [],
  items: [],
  totals: { source_count: 0, item_count: 0, importable_count: 0, conflict_count: 0, risk_count: 0, invalid_count: 0 },
});

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("技能导入重附着 controller", () => {
  it("严格先完成监听再 current；逆序 current 只接受更高 revision，墓碑清批次", async () => {
    const order: string[] = [];
    let handler: ((event: { payload: SkillImportSnapshotEvent }) => void) | undefined;
    let currentCalls = 0;
    const deferred: Array<(value: unknown) => void> = [];
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      event: { listen: async (_name: string, cb: typeof handler) => {
        order.push("listen");
        handler = cb;
        return vi.fn();
      } },
      core: { invoke: (cmd: string) => {
        if (cmd !== "skills_import_current") return Promise.resolve(null);
        order.push("current");
        currentCalls += 1;
        if (currentCalls === 1) return Promise.resolve({ snapshot_revision: 1, batch: batch(1) });
        return new Promise((resolve) => deferred.push(resolve));
      } },
    };

    const { result } = renderHook(() => useSkillImportController());
    await waitFor(() => expect(result.current.snapshotRevision).toBe(1));
    expect(order.slice(0, 2)).toEqual(["listen", "current"]);

    act(() => handler?.({ payload: { batch_id: "batch-1", snapshot_revision: 2, deleted: false } }));
    act(() => handler?.({ payload: { batch_id: "batch-1", snapshot_revision: 3, deleted: false } }));
    expect(deferred).toHaveLength(2);
    await act(async () => deferred[1]?.({ snapshot_revision: 3, batch: batch(3, "submitting") }));
    await waitFor(() => expect(result.current.snapshotRevision).toBe(3));
    await act(async () => deferred[0]?.({ snapshot_revision: 2, batch: batch(2) }));
    expect(result.current.snapshotRevision).toBe(3);
    expect(result.current.batch?.phase).toBe("submitting");

    act(() => handler?.({ payload: { batch_id: "batch-1", snapshot_revision: 4, deleted: true } }));
    expect(result.current.snapshotRevision).toBe(4);
    expect(result.current.batch).toBeNull();
  });

  it.each([
    ["collecting", false, true, true],
    ["validating", true, false, false],
    ["submitting", true, false, false],
    ["completed", false, false, true],
    ["retry-validating", true, false, false],
    ["retrying", true, false, false],
  ] as const)("重载后从 current 重附着 %s 阶段并只开放该阶段操作", async (phase, locked, canCommit, canCancel) => {
    const attached = {
      ...batch(7, phase),
      items: phase === "collecting"
        ? [{
            item_id: "ready", source_id: "source", order: 0, source_display_name: "folder",
            relative_root: "ready", name: "ready", portable_name_key: "ready", description: "ready",
            files: [], total_size: 1, risks: [], validity: { status: "valid" as const },
            conflict: { kind: "none" as const }, duplicate_group: null, state: "pending" as const, last_error: null,
          }]
        : [],
    };
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      event: { listen: async () => vi.fn() },
      core: { invoke: (cmd: string) => cmd === "skills_import_current"
        ? Promise.resolve({ snapshot_revision: 7, batch: attached })
        : Promise.resolve(null) },
    };

    const { result } = renderHook(() => useSkillImportController());
    await waitFor(() => expect(result.current.operation).toBeNull());
    expect(result.current.batch?.phase).toBe(phase);
    expect(result.current.snapshotRevision).toBe(7);
    expect(result.current.operations).toMatchObject({ locked, canCommit, canCancel });
  });

  it("cancel 发出删除墓碑时立即清批次，随后迟到的旧 current 不能复活", async () => {
    let handler: ((event: { payload: SkillImportSnapshotEvent }) => void) | undefined;
    const calls: string[] = [];
    let currentCalls = 0;
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      event: { listen: async (_name: string, cb: typeof handler) => { handler = cb; return vi.fn(); } },
      core: { invoke: (cmd: string) => {
        calls.push(cmd);
        if (cmd === "skills_import_current") {
          currentCalls += 1;
          return Promise.resolve(currentCalls === 1
            ? { snapshot_revision: 3, batch: batch(3) }
            : { snapshot_revision: 4, batch: batch(4) });
        }
        if (cmd === "skills_import_cancel") {
          handler?.({ payload: { batch_id: "batch-1", snapshot_revision: 5, deleted: true } });
          return Promise.resolve(undefined);
        }
        return Promise.resolve(null);
      } },
    };

    const { result } = renderHook(() => useSkillImportController());
    await waitFor(() => expect(result.current.snapshotRevision).toBe(3));
    await act(async () => result.current.cancel());

    expect(calls.slice(-2)).toEqual(["skills_import_cancel", "skills_import_current"]);
    expect(result.current.snapshotRevision).toBe(5);
    expect(result.current.batch).toBeNull();
    expect(result.current.operation).toBeNull();
  });

  it("unmount 取消监听并丢弃在途 current", async () => {
    const off = vi.fn();
    let resolveCurrent: ((value: unknown) => void) | undefined;
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      event: { listen: async () => off },
      core: { invoke: () => new Promise((resolve) => { resolveCurrent = resolve; }) },
    };
    const { result, unmount } = renderHook(() => useSkillImportController());
    await waitFor(() => expect(resolveCurrent).toBeTypeOf("function"));
    unmount();
    expect(off).toHaveBeenCalledOnce();
    await act(async () => resolveCurrent?.({ snapshot_revision: 8, batch: batch(8) }));
    expect(result.current.snapshotRevision).toBe(-1);
  });

  it("pick 遇到实例 Busy 时自动 current 并重附着已有批次", async () => {
    let currentCalls = 0;
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      event: { listen: async () => vi.fn() },
      core: { invoke: (cmd: string) => {
        if (cmd === "skills_import_current") {
          currentCalls += 1;
          return Promise.resolve(currentCalls === 1
            ? { snapshot_revision: 0, batch: null }
            : { snapshot_revision: 2, batch: batch(2) });
        }
        if (cmd === "skills_import_pick") return Promise.reject({ code: "busy" });
        return Promise.resolve(null);
      } },
    };

    const { result } = renderHook(() => useSkillImportController());
    await waitFor(() => expect(result.current.operation).toBeNull());
    let attached: SkillImportBatchPreview | null = null;
    await act(async () => { attached = await result.current.pick("folders"); });
    expect(attached).toMatchObject({ batch_id: "batch-1", snapshot_revision: 2 });
    expect(result.current.batch?.batch_id).toBe("batch-1");
    expect(result.current.error).toBeNull();
  });

  it("phase/in-flight 明确给出可用操作", () => {
    expect(operationsForSkillImport(null)).toMatchObject({ canPick: true, canCommit: false, locked: false });
    expect(operationsForSkillImport({ ...batch(1), in_flight_source_picks: 1 })).toMatchObject({ canPick: false, canCommit: false, canCancel: false, locked: true });
    expect(operationsForSkillImport(batch(2, "validating"))).toMatchObject({ canCancel: false, locked: true });
    expect(operationsForSkillImport(batch(3, "completed"))).toMatchObject({ canCancel: true, locked: false });
  });
});
