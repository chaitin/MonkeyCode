import { describe, expect, it } from "vitest";

import { buildSessionUsageMap, sumUsage, type TokenUsage } from "./usageStats";

const sess = (session_id: string, parent: string | null, input: number, output: number, calls: number, model: string) => ({
  session_id,
  parent,
  title: session_id,
  input_tokens: input,
  output_tokens: output,
  calls,
  days: [],
  models: [{ model, input_tokens: input, output_tokens: output, calls }],
});

describe("buildSessionUsageMap", () => {
  it("子代理归并进父任务:父任务总量含子会话", () => {
    const map = buildSessionUsageMap([
      sess("parent", null, 100, 50, 2, "gpt-5"),
      sess("child", "parent", 300, 200, 5, "gpt-5"),
    ]);
    const parent = map.get("parent")!;
    expect(parent.input).toBe(400); // 100 + 300
    expect(parent.output).toBe(250);
    expect(parent.calls).toBe(7);
    expect(parent.models[0]?.input_tokens).toBe(400);
    // 子会话自身也有条目
    expect(map.get("child")!.input).toBe(300);
  });
});

describe("sumUsage", () => {
  it("多会话合并成合计;无用量返回 null", () => {
    const map = new Map<string, TokenUsage>([
      ["a", { input: 100, output: 50, calls: 2, models: [] }],
      ["b", { input: 300, output: 200, calls: 5, models: [] }],
    ]);
    const total = sumUsage(["a", "b"], map)!;
    expect(total.input).toBe(400);
    expect(total.output).toBe(250);
    expect(total.calls).toBe(7);
    expect(sumUsage(["nope"], map)).toBeNull();
  });
});
