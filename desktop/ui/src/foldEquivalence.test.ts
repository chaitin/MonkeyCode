// 折叠等价性:整套回放物化方案的地基。
//
// 壳侧把 events.jsonl 的流式碎片折叠成 replay.jsonl 才敢只回放窗口,前提是
// **折叠不改变 UI 的归约结果**。这条断言就是那个前提:同一份素材,原始帧与
// 折叠帧喂给 reduceBatch,得到的 ChatState 必须逐字段相同。
//
// 素材在 desktop/fixtures/replay/,folded.jsonl 由 Rust 侧真实折叠产出
// (`cargo test regenerate_fold_fixture -- --ignored`),另有一条 Rust 用例
// 钉住"折叠输出 == committed folded.jsonl"。于是两侧任一方改了规则而没同步,
// 这里或那里必有一条红。
import { describe, expect, it } from "vitest";

// ?raw 静态导入而不是 node:fs:UI 包不引 @types/node,tsc --noEmit 是构建前置
import foldedRaw from "../../fixtures/replay/folded.jsonl?raw";
import rawRaw from "../../fixtures/replay/raw.jsonl?raw";

import { frameData } from "./codec";
import { initialChat, reduceBatch } from "./reduce";
import type { Frame } from "./types";

function fixture(text: string): { frames: Frame[]; bytes: number } {
  return {
    frames: text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Frame),
    bytes: new TextEncoder().encode(text).length,
  };
}

describe("回放折叠是等价变换", () => {
  const raw = fixture(rawRaw);
  const folded = fixture(foldedRaw);

  it("原始帧与折叠帧归约出完全相同的会话状态", () => {
    expect(reduceBatch(initialChat, folded.frames)).toEqual(reduceBatch(initialChat, raw.frames));
  });

  it("素材确实覆盖了容易出错的形态", () => {
    const kinds = new Set(
      raw.frames.map((f) => {
        // 素材里旧格式(base64)与新格式(内联对象)混着,两种都要看得见
        const d = frameData<{ update?: { sessionUpdate?: string } }>(f);
        return d?.update?.sessionUpdate ?? f.type;
      }),
    );
    // 旧 base64 载荷、跨帧打断的流式段、覆盖语义帧、审批、提问卡、图片
    expect(raw.frames.some((f) => typeof f.data === "string")).toBe(true);
    expect(kinds).toContain("usage_update");
    expect(kinds).toContain("plan");
    expect(kinds).toContain("tool_call_update");
    expect(kinds).toContain("permission-req");
    expect(kinds).toContain("reply-question");
  });

  it("折叠确实把帧数与体积压下来了(这才是它存在的理由)", () => {
    expect(folded.frames.length).toBeLessThan(raw.frames.length / 2);
    expect(folded.bytes).toBeLessThan(raw.bytes / 2);
  });
});
