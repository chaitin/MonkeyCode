import { describe, expect, it } from "vitest";

import { countChangesUnder } from "./Tree";

describe("countChangesUnder:目录行的改动聚合", () => {
  const changes = new Map([
    ["src/a.ts", "M"],
    ["src/deep/b.ts", "A"],
    ["src2/c.ts", "M"], // 同前缀的**兄弟**目录
    ["README.md", "M"],
  ]);

  it("含各级子目录", () => {
    expect(countChangesUnder(changes, "src")).toBe(2);
  });

  it("不把同前缀的兄弟目录算进来(src 不吃 src2)", () => {
    expect(countChangesUnder(changes, "src2")).toBe(1);
  });

  it("末尾带不带分隔符结果一致", () => {
    expect(countChangesUnder(changes, "src/")).toBe(2);
  });

  it("无改动表/空表返回 0", () => {
    expect(countChangesUnder(undefined, "src")).toBe(0);
    expect(countChangesUnder(new Map(), "src")).toBe(0);
  });
});
