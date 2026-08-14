import { useMemo } from "react";

import { timelineDeltaOf } from "@/lib/protocol/reduce";
import type { ChatState } from "@/lib/protocol/types";
import { estimateTimelineRow, projectTimelineRows, type TimelineProjectionOptions, type TimelineRow } from "./model";

export interface TimelineProjection {
  /** 当前渲染数据；流式尾行更新时只换尾行，其他 row 引用保持稳定。 */
  rows: readonly TimelineRow[];
  /** key/顺序未变时复用的布局骨架，HeightIndex 只依赖它，不随 token 重建。 */
  layoutRows: readonly TimelineRow[];
}

interface ProjectionCache extends TimelineProjection {
  rawToRow: Map<number, number>;
  openGroups: ReadonlySet<number>;
  closedGroups: ReadonlySet<number>;
  flashSeq?: number;
}

// ChatState 是不可变快照；以它为键保存派生结果不会污染协议结构，也能随
// 快照一同 GC。相比 render 期改 useRef/原数组，这种不可变缓存不会让 React
// 并发渲染中的 current/work-in-progress 两棵树互相看到半成品。
const projectionCache = new WeakMap<ChatState, ProjectionCache>();

const rawMapOf = (rows: readonly TimelineRow[]) => new Map(rows.map((row, index) => [row.rawIndex, index]));

function sameOptions(cache: ProjectionCache | undefined, options: TimelineProjectionOptions): cache is ProjectionCache {
  return !!cache &&
    cache.openGroups === options.openGroups &&
    cache.closedGroups === options.closedGroups &&
    cache.flashSeq === options.flashSeq;
}

function fullProjection(state: ChatState, options: TimelineProjectionOptions): ProjectionCache {
  const rows = projectTimelineRows(state, options);
  return {
    rows,
    layoutRows: rows,
    rawToRow: rawMapOf(rows),
    openGroups: options.openGroups,
    closedGroups: options.closedGroups,
    ...(options.flashSeq !== undefined ? { flashSeq: options.flashSeq } : {}),
  };
}

function reuseLayoutIfCompatible(next: ProjectionCache, previous: ProjectionCache | undefined): ProjectionCache {
  if (!previous || next.rows.length !== previous.layoutRows.length) return next;
  for (let index = 0; index < next.rows.length; index++) {
    const row = next.rows[index]!;
    const old = previous.layoutRows[index]!;
    if (row.key !== old.key || row.type !== old.type || estimateTimelineRow(row) !== estimateTimelineRow(old)) return next;
  }
  return { ...next, layoutRows: previous.layoutRows, rawToRow: previous.rawToRow };
}

function projectionOf(state: ChatState, options: TimelineProjectionOptions): ProjectionCache {
  const hit = projectionCache.get(state);
  if (sameOptions(hit, options)) return hit;

  const delta = timelineDeltaOf(state);
  const previous = delta ? projectionCache.get(delta.from) : undefined;
  if (sameOptions(previous, options) && delta) {
    const streamKindChanged = delta.from.streamKind !== state.streamKind;
    const onlyTailChanged =
      delta.kind === "update" &&
      delta.changed.length === 1 &&
      delta.changed[0] === state.items.length - 1;
    const oldTail = delta.from.items.at(-1);
    const newTail = state.items.at(-1);
    const textTail =
      oldTail &&
      newTail &&
      oldTail.kind === newTail.kind &&
      (newTail.kind === "agent" || newTail.kind === "thought");

    if ((onlyTailChanged && textTail) || (delta.kind === "meta" && streamKindChanged)) {
      const rawIndex = state.items.length - 1;
      const rowIndex = previous.rawToRow.get(rawIndex);
      const row = rowIndex === undefined ? undefined : previous.rows[rowIndex];
      if (row?.type === "item" && newTail) {
        // 只复制轻量 row 引用表，不重跑权限锚定/工具分组；布局骨架保持同一
        // 引用，Fenwick 树和 O(1) 查找表也就不会随每批 token 重建。
        const rows = previous.rows.slice();
        rows[rowIndex!] = {
          ...row,
          item: newTail,
          streaming:
            (newTail.kind === "agent" || newTail.kind === "thought") && state.streamKind === newTail.kind,
        };
        const next: ProjectionCache = { ...previous, rows };
        projectionCache.set(state, next);
        return next;
      }
    }
    if (delta.kind === "meta" && !streamKindChanged) {
      projectionCache.set(state, previous);
      return previous;
    }
  }

  const next = reuseLayoutIfCompatible(fullProjection(state, options), sameOptions(previous, options) ? previous : undefined);
  projectionCache.set(state, next);
  return next;
}

/** 高频流式快路：只派生新的尾 row 数组，未变行和布局索引均复用；结构事件
 * 才执行完整纯投影。 */
export function useTimelineProjection(state: ChatState, options: TimelineProjectionOptions): TimelineProjection {
  const { openGroups, closedGroups, flashSeq } = options;
  return useMemo(
    () => projectWithOptions(state, openGroups, closedGroups, flashSeq),
    [state, openGroups, closedGroups, flashSeq],
  );
}

function projectWithOptions(
  state: ChatState,
  openGroups: ReadonlySet<number>,
  closedGroups: ReadonlySet<number>,
  flashSeq: number | undefined,
): TimelineProjection {
  return projectionOf(state, {
    openGroups,
    closedGroups,
    ...(flashSeq !== undefined ? { flashSeq } : {}),
  });
}
