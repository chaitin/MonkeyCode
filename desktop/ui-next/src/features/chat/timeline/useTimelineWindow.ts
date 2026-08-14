import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

import { markProgrammaticScroll, OUTLINE_JUMP_INSET } from "@/lib/util/scrollAnchor";
import { HeightIndex } from "./heightIndex";
import { estimateTimelineRow, type TimelineRow } from "./model";

const MAX_RENDERED_ROWS = 160;
const INITIAL_ROWS = 100;
const MIN_OVERSCAN_PX = 1000;

interface WindowRange {
  startKey: string | null;
  endKey: string | null;
  startFallback: number;
  endFallback: number;
  tail: boolean;
}

const sameRange = (a: WindowRange, b: WindowRange) =>
  a.startKey === b.startKey &&
  a.endKey === b.endKey &&
  a.startFallback === b.startFallback &&
  a.endFallback === b.endFallback &&
  a.tail === b.tail;

export interface TimelineWindow {
  start: number;
  end: number;
  topHeight: number;
  bottomHeight: number;
  resolveKey(key: string): string | null;
  ensureKey(key: string): boolean;
  ensureRawIndex(rawIndex: number): boolean;
  ensureUserSeq(seq: number): boolean;
  activeUser(): Extract<TimelineRow["item"], { kind: "user" }> | null;
}

export function useTimelineWindow(
  rows: readonly TimelineRow[],
  rootRef: RefObject<HTMLDivElement | null>,
): TimelineWindow {
  const measuredRef = useRef(new Map<string, number>());
  const index = useMemo(
    // measuredRef 是只由 layout effect 写入的非视觉缓存；rows 变化时在 render
    // 中只读快照来初始化新索引，不把 ref 值作为 React 渲染输入。
    // eslint-disable-next-line react-hooks/refs
    () => new HeightIndex(rows, (row) => measuredRef.current.get(row.key) ?? estimateTimelineRow(row)),
    [rows],
  );
  const scrollbarDraggingRef = useRef(false);
  const [, setHeightRevision] = useState(0);
  const [range, setRange] = useState<WindowRange>(() => ({
    startKey: null,
    endKey: null,
    startFallback: 0,
    endFallback: 0,
    tail: true,
  }));

  const lookups = useMemo(() => {
    const key = new Map<string, number>();
    const raw = new Map<number, number>();
    const userSeq = new Map<number, number>();
    const aliases = new Map<string, number>();
    const previousUser = new Int32Array(rows.length);
    let lastUser = -1;
    let firstUser = -1;
    rows.forEach((row, rowIndex) => {
      key.set(row.key, rowIndex);
      raw.set(row.rawIndex, rowIndex);
      if (row.type === "group") {
        for (const memberRawIndex of row.memberRawIndexes) {
          aliases.set(String(row.stackKey + memberRawIndex - row.rawIndex), rowIndex);
        }
      }
      if (row.item.kind === "user") {
        if (firstUser < 0) firstUser = rowIndex;
        lastUser = rowIndex;
        if (row.item.seq !== undefined) userSeq.set(row.item.seq, rowIndex);
      }
      previousUser[rowIndex] = lastUser;
    });
    return { key, raw, userSeq, aliases, previousUser, firstUser };
  }, [rows]);
  let start: number;
  let end: number;
  if (rows.length <= MAX_RENDERED_ROWS) {
    start = 0;
    end = rows.length;
  } else if (range.startKey === null) {
    start = Math.max(0, rows.length - INITIAL_ROWS);
    end = rows.length;
  } else if (range.tail) {
    const size = Math.min(MAX_RENDERED_ROWS, Math.max(1, range.endFallback - range.startFallback));
    end = rows.length;
    start = Math.max(0, end - size);
  } else {
    start = lookups.key.get(range.startKey) ?? Math.min(range.startFallback, rows.length - 1);
    const endIndex = range.endKey === null ? -1 : lookups.key.get(range.endKey) ?? -1;
    end = endIndex >= start ? endIndex + 1 : Math.min(rows.length, Math.max(start + 1, range.endFallback));
    if (end - start > MAX_RENDERED_ROWS) end = start + MAX_RENDERED_ROWS;
  }

  const setIndexRange = useCallback((wantedStart: number, wantedEnd: number) => {
    if (!rows.length) return;
    const nextStart = Math.max(0, Math.min(wantedStart, rows.length - 1));
    let nextEnd = Math.max(nextStart + 1, Math.min(wantedEnd, rows.length));
    if (nextEnd - nextStart > MAX_RENDERED_ROWS) nextEnd = nextStart + MAX_RENDERED_ROWS;
    const next: WindowRange = {
      startKey: rows[nextStart]!.key,
      endKey: rows[nextEnd - 1]!.key,
      startFallback: nextStart,
      endFallback: nextEnd,
      tail: nextEnd === rows.length,
    };
    setRange((previous) => (sameRange(previous, next) ? previous : next));
  }, [rows]);

  const calculate = useCallback(() => {
    const root = rootRef.current;
    if (!root || index.length <= MAX_RENDERED_ROWS) return;
    const scroller = root.closest<HTMLElement>("[data-chat-log]");
    if (!scroller) return;
    const viewport = scroller.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    const viewportHeight = scroller.clientHeight || viewport.height;
    // jsdom/尚未布局的首帧没有可信几何；保留尾窗，真机首个 layout/scroll
    // 会立刻进入本分支。
    if (viewportHeight <= 0 || (viewport.height === 0 && rootBox.height === 0)) return;
    const visibleTop = Math.max(0, viewport.top - rootBox.top);
    const visibleBottom = visibleTop + viewportHeight;
    const overscan = Math.max(MIN_OVERSCAN_PX, viewportHeight * 2);
    const firstVisible = index.indexAt(visibleTop);
    let nextStart = index.indexAt(Math.max(0, visibleTop - overscan));
    let nextEnd = index.indexAt(Math.min(index.total(), visibleBottom + overscan)) + 1;
    if (nextEnd - nextStart > MAX_RENDERED_ROWS) {
      const before = Math.floor(MAX_RENDERED_ROWS / 3);
      nextStart = Math.max(0, firstVisible - before);
      nextEnd = Math.min(index.length, nextStart + MAX_RENDERED_ROWS);
      nextStart = Math.max(0, nextEnd - MAX_RENDERED_ROWS);
    }
    setIndexRange(nextStart, nextEnd);
    // rootRef 由 LogList 的 useRef 创建，组件生命周期内身份恒定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, setIndexRange]);

  // 只订阅所属日志容器，不再给 window 装全局捕获扫描器。滚动和尺寸变化
  // 都 rAF 合并，一帧最多做两次 Fenwick lowerBound。
  useEffect(() => {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>("[data-chat-log]");
    if (!root || !scroller) return;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        calculate();
      });
    };
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    ro?.observe(scroller);
    schedule();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [calculate, rootRef]);

  // 拖滚动条时拇指位置由浏览器主导。测量照常写高度树，但暂不做锚点
  // scrollTop 补偿，避免与 WebKit 每次 mousemove 的原生定位互相拉扯。
  useEffect(() => {
    const scroller = rootRef.current?.closest<HTMLElement>("[data-chat-log]");
    if (!scroller) return;
    const onMouseDown = (event: MouseEvent) => {
      if (event.clientX > scroller.getBoundingClientRect().right - 18) scrollbarDraggingRef.current = true;
    };
    const onMouseUp = () => {
      if (!scrollbarDraggingRef.current) return;
      scrollbarDraggingRef.current = false;
      calculate();
    };
    scroller.addEventListener("mousedown", onMouseDown, { capture: true, passive: true });
    window.addEventListener("mouseup", onMouseUp, { capture: true, passive: true });
    return () => {
      scrollbarDraggingRef.current = false;
      scroller.removeEventListener("mousedown", onMouseDown, { capture: true });
      window.removeEventListener("mouseup", onMouseUp, { capture: true });
    };
  }, [calculate, rootRef]);

  useLayoutEffect(calculate, [calculate, rows]);

  // 当前窗口只有至多 160 个节点；批量测量并写入高度树。内容异步长高时，
  // 若变化发生在视口锚点上方，按真实 delta 同帧补 scrollTop，避免阅读跳动。
  useLayoutEffect(() => {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>("[data-chat-log]");
    if (!root || !scroller || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const rootBox = root.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      const anchorIndex = index.indexAt(Math.max(0, viewport.top - rootBox.top));
      let aboveDelta = 0;
      let changed = false;
      for (const entry of entries) {
        const node = entry.target as HTMLElement;
        const key = node.dataset.rowKey;
        if (!key) continue;
        const rowIndex = index.indexOf(key);
        if (rowIndex < 0) continue;
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (height <= 0) continue;
        const delta = index.update(rowIndex, height);
        if (!delta) continue;
        measuredRef.current.set(key, height);
        if (rowIndex < anchorIndex) aboveDelta += delta;
        changed = true;
      }
      if (!changed) return;
      const pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
      if (!pinned && !scrollbarDraggingRef.current && Math.abs(aboveDelta) > 0.5) {
        scroller.scrollTop += aboveDelta;
        markProgrammaticScroll(scroller);
      }
      setHeightRevision((value) => value + 1);
      calculate();
    });
    for (const node of root.querySelectorAll<HTMLElement>("[data-virtual-row]")) ro.observe(node);
    return () => ro.disconnect();
  }, [start, end, rows, calculate, index, rootRef]);

  const ensureIndex = useCallback(
    (wanted: number): boolean => {
      if (wanted < 0 || wanted >= rows.length) return false;
      const half = Math.floor(MAX_RENDERED_ROWS / 2);
      let nextStart = Math.max(0, wanted - half);
      const nextEnd = Math.min(rows.length, nextStart + MAX_RENDERED_ROWS);
      nextStart = Math.max(0, nextEnd - MAX_RENDERED_ROWS);
      setIndexRange(nextStart, nextEnd);
      return true;
    },
    [rows.length, setIndexRange],
  );

  const indexForKey = useCallback(
    (key: string): number => {
      const exact = lookups.key.get(key) ?? lookups.aliases.get(key);
      if (exact !== undefined) return exact;
      // 被连续 model 合并等投影规则吃掉的旧锚，退到文档序上最近的可见行。
      const numeric = Number(key);
      if (!Number.isFinite(numeric) || rows.length === 0) return -1;
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (Number(rows[middle]!.key) < numeric) low = middle + 1;
        else high = middle;
      }
      return Math.min(low, rows.length - 1);
    },
    [lookups, rows],
  );
  const resolveKey = useCallback(
    (key: string) => {
      const rowIndex = indexForKey(key);
      return rowIndex >= 0 ? rows[rowIndex]!.key : null;
    },
    [indexForKey, rows],
  );
  const ensureKey = useCallback((key: string) => ensureIndex(indexForKey(key)), [ensureIndex, indexForKey]);
  const ensureRawIndex = useCallback(
    (rawIndex: number) => ensureIndex(lookups.raw.get(rawIndex) ?? -1),
    [ensureIndex, lookups],
  );
  const ensureUserSeq = useCallback(
    (seq: number) => ensureIndex(lookups.userSeq.get(seq) ?? -1),
    [ensureIndex, lookups],
  );
  const activeUser = useCallback(() => {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>("[data-chat-log]");
    if (!root || !scroller || !rows.length) return null;
    const relativeTop = Math.max(
      0,
      scroller.getBoundingClientRect().top - root.getBoundingClientRect().top + OUTLINE_JUMP_INSET,
    );
    const rowIndex = index.indexAt(relativeTop);
    const previous = lookups.previousUser[rowIndex] ?? -1;
    const userIndex = previous >= 0 ? previous : lookups.firstUser;
    const item = userIndex >= 0 ? rows[userIndex]?.item : undefined;
    return item?.kind === "user" ? item : null;
    // rootRef 由 LogList 的 useRef 创建，组件生命周期内身份恒定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, lookups, rows]);

  return {
    start,
    end,
    topHeight: index.offsetAt(start),
    bottomHeight: Math.max(0, index.total() - index.offsetAt(end)),
    resolveKey,
    ensureKey,
    ensureRawIndex,
    ensureUserSeq,
    activeUser,
  };
}

export const TIMELINE_MAX_RENDERED_ROWS = MAX_RENDERED_ROWS;
