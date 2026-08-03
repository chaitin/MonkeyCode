// rounds 批次时序归一:backward 多轮批次轮间倒序 → 恢复全局时间正序;
// 轮内顺序(含同 ms 的帧)靠稳定排序保住;单轮批次恒等。
import { describe, expect, it } from "vitest";

import type { Frame } from "@/lib/protocol/types";
import { chronoRounds } from "./rounds";

const f = (type: string, timestamp: number, tag?: string): Frame =>
  ({ type, timestamp, ...(tag ? { data: tag } : {}) }) as unknown as Frame;

describe("chronoRounds", () => {
  it("backward 多轮批次(最新轮在前、轮内正序)→ 全局时间正序", () => {
    const batch = [
      // 轮 2(新):ts 2000-2002
      f("user-input", 2000),
      f("task-running", 2001),
      f("task-ended", 2002),
      // 轮 1(旧):ts 1000-1002
      f("user-input", 1000),
      f("task-running", 1001),
      f("task-ended", 1002),
    ];
    expect(chronoRounds(batch).map((x) => x.timestamp)).toEqual([1000, 1001, 1002, 2000, 2001, 2002]);
  });

  it("轮内同 ms 的帧保持原相对顺序(稳定排序)", () => {
    const batch = [f("user-input", 2000), f("a", 2001, "第一"), f("b", 2001, "第二"), f("user-input", 1000)];
    const out = chronoRounds(batch);
    expect(out.map((x) => x.timestamp)).toEqual([1000, 2000, 2001, 2001]);
    expect((out[2] as { data?: string }).data).toBe("第一");
    expect((out[3] as { data?: string }).data).toBe("第二");
  });

  it("单轮批次恒等;服务端注入的首轮 user-input(ts=任务创建)归到最前", () => {
    const single = [f("user-input", 1000), f("task-ended", 1001)];
    expect(chronoRounds(single)).toEqual(single);
    // 触达最老一轮的兼容注入:老 user-input 被服务端放在批次头部,
    // 批次里跟着的是更新的轮 → 归一后注入帧仍在最前,新轮排后
    const injected = [f("user-input", 500), f("user-input", 2000), f("task-ended", 2001), f("task-running", 600)];
    expect(chronoRounds(injected).map((x) => x.timestamp)).toEqual([500, 600, 2000, 2001]);
  });

  it("缺 timestamp 的帧按 0 处理,不抛", () => {
    const batch = [f("a", 1000), { type: "b" } as unknown as Frame];
    expect(chronoRounds(batch).map((x) => x.timestamp)).toEqual([undefined, 1000]);
  });
});
