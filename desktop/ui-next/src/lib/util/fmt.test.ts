import { describe, expect, it } from "vitest";

import { fmtClock, fmtK } from "./fmt";

describe("fmtK 千位缩写", () => {
  it("三档:原样 / k / M,一位小数四舍五入", () => {
    expect(fmtK(0)).toBe("0");
    expect(fmtK(999)).toBe("999");
    expect(fmtK(1234)).toBe("1.2k");
    expect(fmtK(45_678)).toBe("45.7k");
    expect(fmtK(2_345_678)).toBe("2.3M");
  });

  it("整值不带小数尾巴", () => {
    expect(fmtK(2000)).toBe("2k");
    expect(fmtK(1_000_000)).toBe("1M");
  });
});

describe("fmtClock 跨天感知时刻", () => {
  const now = new Date(2026, 7, 10, 20, 0); // 2026-08-10 20:00 本地时间

  it("当天只显 HH:MM", () => {
    expect(fmtClock(new Date(2026, 7, 10, 9, 5).getTime(), now)).toBe("09:05");
  });

  it("同年跨天补 MM-DD——几天前同一时刻不再同貌", () => {
    expect(fmtClock(new Date(2026, 7, 8, 9, 5).getTime(), now)).toBe("08-08 09:05");
  });

  it("跨年补全年份", () => {
    expect(fmtClock(new Date(2025, 11, 31, 23, 59).getTime(), now)).toBe("2025-12-31 23:59");
  });

  it("缺失/非法时间戳返回空串", () => {
    expect(fmtClock(undefined, now)).toBe("");
    expect(fmtClock(Number.NaN, now)).toBe("");
  });
});
