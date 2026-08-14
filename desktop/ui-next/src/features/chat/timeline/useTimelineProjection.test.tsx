import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createChatState, reduceBatch } from "@/lib/protocol/reduce";
import type { AcpUpdate, Frame } from "@/lib/protocol/types";
import { useTimelineProjection } from "./useTimelineProjection";

const acp = (update: AcpUpdate, seq: number): Frame => ({
  type: "task-running",
  kind: "acp_event",
  data: { update },
  seq,
});
const options = { openGroups: new Set<number>(), closedGroups: new Set<number>() };

describe("useTimelineProjection", () => {
  it("流式尾部更新复用布局骨架和未变行，仅替换尾行", () => {
    const first = reduceBatch(createChatState(), [
      { type: "user-input", data: { content: "5L2g" }, seq: 1 },
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "甲" } }, 2),
    ]);
    const { result, rerender } = renderHook(
      ({ state }) => useTimelineProjection(state, options),
      { initialProps: { state: first } },
    );
    const projection = result.current;
    const rows = projection.rows;
    const firstRow = rows[0];
    const oldTail = rows[1];
    const second = reduceBatch(first, [acp({ sessionUpdate: "agent_message_chunk", content: { text: "乙" } }, 3)]);
    rerender({ state: second });
    expect(result.current.layoutRows).toBe(projection.layoutRows);
    expect(result.current.rows).not.toBe(rows);
    expect(result.current.rows[0]).toBe(firstRow);
    expect(result.current.rows[1]).not.toBe(oldTail);
    expect(result.current.rows[1]?.item.kind === "agent" && result.current.rows[1].item.text).toBe("甲乙");
  });

  it("结构追加回到完整投影", () => {
    const first = reduceBatch(createChatState(), [acp({ sessionUpdate: "agent_message_chunk", content: { text: "甲" } }, 1)]);
    const { result, rerender } = renderHook(
      ({ state }) => useTimelineProjection(state, options),
      { initialProps: { state: first } },
    );
    const rows = result.current.rows;
    const second = reduceBatch(first, [{ type: "task-ended", seq: 2 }]);
    rerender({ state: second });
    expect(result.current.rows).not.toBe(rows);
    expect(result.current.rows.length).toBeGreaterThan(rows.length);
  });

  it("工具进度只换内容、行结构未变时继续复用布局索引", () => {
    const first = reduceBatch(createChatState(), [
      acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Bash", status: "in_progress" }, 1),
    ]);
    const { result, rerender } = renderHook(({ state }) => useTimelineProjection(state, options), {
      initialProps: { state: first },
    });
    const before = result.current;
    const second = reduceBatch(first, [
      acp({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "in_progress",
        progress: { kind: "output", line: "running" },
      }, 2),
    ]);
    rerender({ state: second });
    expect(result.current.rows).not.toBe(before.rows);
    expect(result.current.layoutRows).toBe(before.layoutRows);
  });
});
