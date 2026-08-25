import { describe, expect, it } from "vitest";

import { createChatState, prependHistory, reduceBatch } from "@/lib/protocol/reduce";
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

  it("运行轮数不统计 steering 补充指令", () => {
    const state = reduceBatch(createChatState(), [
      { type: "user-input", data: { content: "5Li76KaB", source: "steer" }, seq: 1 },
      { type: "user-input", data: { content: "5q2j5bi4" }, seq: 2 },
      { type: "user-input", data: { content: "6KGl5YWF", source: "steer" }, seq: 3 },
    ]);
    expect(composerPresentationOf(state).roundNo).toBe(1);
  });

  it("前插历史 think 行不递增实时确认版本", () => {
    const current = reduceBatch(createChatState(), [acp({ sessionUpdate: "think_update", think: "medium" }, 10)]);
    const before = composerPresentationOf(current);
    const withHistory = prependHistory(current, [acp({ sessionUpdate: "think_update", think: "high" }, 1)]);

    expect(composerPresentationOf(withHistory)).toBe(before);
    expect(composerPresentationOf(withHistory).thinkRevision).toBe(1);
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
