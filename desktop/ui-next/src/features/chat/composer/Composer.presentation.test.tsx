import { describe, expect, it } from "vitest";

import { createChatState, reduceBatch } from "@/lib/protocol/reduce";
import type { AcpUpdate, Frame } from "@/lib/protocol/types";
import { composerPresentationOf } from "./Composer";

const acp = (update: AcpUpdate, seq: number): Frame => ({
  type: "task-running",
  kind: "acp_event",
  data: { update },
  seq,
});

describe("composerPresentationOf 增量投影", () => {
  it("正文流式增长复用同一个 presentation，输入框子树可被 memo 跳过", () => {
    const first = reduceBatch(createChatState(), [
      { type: "user-input", data: { content: "5L2g" }, seq: 1 },
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "甲" } }, 2),
    ]);
    const before = composerPresentationOf(first);
    const second = reduceBatch(first, [
      acp({ sessionUpdate: "agent_message_chunk", content: { text: "乙" } }, 3),
    ]);
    expect(composerPresentationOf(second)).toBe(before);
    expect(before.roundNo).toBe(1);
  });

  it("相关状态变化才产生新投影，并增量维护运行工具计数", () => {
    const first = reduceBatch(createChatState(), [
      acp({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Bash" }, 1),
    ]);
    const running = composerPresentationOf(first);
    expect(running.toolRunning).toBe(true);

    const second = reduceBatch(first, [
      acp({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" }, 2),
    ]);
    const completed = composerPresentationOf(second);
    expect(completed).not.toBe(running);
    expect(completed.toolRunning).toBe(false);
  });
});
