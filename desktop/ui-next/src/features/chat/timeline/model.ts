import { itemKey, permAnchors } from "@/lib/protocol/reduce";
import type { ChatItem, ChatState, PermItem } from "@/lib/protocol/types";

export interface TimelineItemRow {
  type: "item";
  key: string;
  rawIndex: number;
  item: ChatItem;
  perm?: PermItem;
  flash: boolean;
  streaming: boolean;
  joinPrev: boolean;
  joinNext: boolean;
  gap: boolean;
}

export interface TimelineGroupRow {
  type: "group";
  key: string;
  rawIndex: number;
  stackKey: number;
  item: ChatItem;
  members: readonly ChatItem[];
  memberRawIndexes: readonly number[];
  perm?: PermItem;
  active: boolean;
  failCount: number;
  expanded: boolean;
  gap: boolean;
  joinNext: boolean;
}

export type TimelineRow = TimelineItemRow | TimelineGroupRow;

export interface TimelineProjectionOptions {
  openGroups: ReadonlySet<number>;
  closedGroups: ReadonlySet<number>;
  flashSeq?: number;
}

const AGG_MIN = 3;

/** 协议条目 → 真正有视觉盒的行。旧实现为维持 raw index 契约给锚定审批、
 * 合并模型行、折叠工具成员各留一个 display:none 节点；窗口化后坐标改用
 * 稳定 key，这些空节点全部可以消失。 */
export function projectTimelineRows(
  state: ChatState,
  { openGroups, closedGroups, flashSeq }: TimelineProjectionOptions,
): TimelineRow[] {
  const anchors = permAnchors(state.items);
  const toolIds = new Set<string>();
  for (const item of state.items) if (item.kind === "tool" && item.tcId) toolIds.add(item.tcId);

  const visibleIndexes: number[] = [];
  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i]!;
    if (item.kind === "perm" && item.toolCallId && toolIds.has(item.toolCallId)) continue;
    const next = state.items[i + 1];
    if (item.kind === "sys" && item.tag === "model" && next?.kind === "sys" && next.tag === "model") continue;
    visibleIndexes.push(i);
  }

  const rows: TimelineRow[] = [];
  let cursor = 0;
  let previous: ChatItem | null = null;
  const permOf = (item: ChatItem) => (item.kind === "tool" ? anchors.get(item.tcId) : undefined);

  while (cursor < visibleIndexes.length) {
    const rawIndex = visibleIndexes[cursor]!;
    const item = state.items[rawIndex]!;
    if (item.kind === "tool") {
      let end = cursor + 1;
      while (end < visibleIndexes.length && state.items[visibleIndexes[end]!]!.kind === "tool") end += 1;
      const memberRawIndexes = visibleIndexes.slice(cursor, end);
      if (memberRawIndexes.length >= AGG_MIN) {
        const stackKey = itemKey(state, rawIndex);
        const members = memberRawIndexes.map((index) => state.items[index]!);
        const active = members.some(
          (member) => member.kind === "tool" && (member.status === "run" || anchors.get(member.tcId)?.state === "open"),
        );
        const expanded = closedGroups.has(stackKey) ? false : openGroups.has(stackKey) || active;
        rows.push({
          type: "group",
          key: String(stackKey),
          rawIndex,
          stackKey,
          item,
          members,
          memberRawIndexes,
          ...(permOf(item) ? { perm: permOf(item) } : {}),
          active,
          failCount: members.filter((member) => member.kind === "tool" && member.status === "fail").length,
          expanded,
          gap: previous !== null && previous.kind !== "tool",
          joinNext: memberRawIndexes.length > 1,
        });
        if (expanded) {
          for (let memberPos = 1; memberPos < memberRawIndexes.length; memberPos++) {
            const memberRawIndex = memberRawIndexes[memberPos]!;
            const member = state.items[memberRawIndex]!;
            rows.push({
              type: "item",
              key: String(itemKey(state, memberRawIndex)),
              rawIndex: memberRawIndex,
              item: member,
              ...(permOf(member) ? { perm: permOf(member) } : {}),
              flash: false,
              streaming: false,
              joinPrev: true,
              joinNext: memberPos < memberRawIndexes.length - 1,
              gap: false,
            });
          }
        }
        previous = members.at(-1) ?? previous;
        cursor = end;
        continue;
      }
    }

    const nextRawIndex = visibleIndexes[cursor + 1];
    const next = nextRawIndex === undefined ? undefined : state.items[nextRawIndex];
    const joinPrev = item.kind === "tool" && previous?.kind === "tool";
    rows.push({
      type: "item",
      key: String(itemKey(state, rawIndex)),
      rawIndex,
      item,
      ...(permOf(item) ? { perm: permOf(item) } : {}),
      flash: item.kind === "user" && item.seq !== undefined && item.seq === flashSeq,
      streaming:
        rawIndex === state.items.length - 1 &&
        (item.kind === "agent" || item.kind === "thought") &&
        state.streamKind === item.kind,
      joinPrev,
      joinNext: item.kind === "tool" && next?.kind === "tool",
      gap: previous !== null && !joinPrev,
    });
    previous = item;
    cursor += 1;
  }

  return rows;
}

/** 未测量行的保守估高。它只影响首次远跳的滚动条比例；进入 overscan 后
 * ResizeObserver 会用真高替换，稳定 key 锚点负责消化误差。 */
export function estimateTimelineRow(row: TimelineRow): number {
  if (row.type === "group") return row.expanded ? 112 : 52;
  const item = row.item;
  switch (item.kind) {
    case "sys":
      return item.tag === "turn-end" ? 18 : 30;
    case "tool":
      return 58;
    case "perm":
    case "ask":
      return 132;
    case "thought":
      return 58;
    case "user":
      return Math.min(320, 54 + Math.ceil(item.text.length / 72) * 20);
    case "agent":
      return Math.min(520, 42 + Math.ceil(item.text.length / 68) * 20);
  }
}
