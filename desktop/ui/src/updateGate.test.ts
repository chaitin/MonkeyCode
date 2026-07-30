import { describe, expect, it } from "vitest";

import { createUpdateGate, UPDATE_MIN_INTERVAL_MS } from "./updateGate";

/** 可拨的假表:真实时钟不可控,而这里要断言的全是"隔了多久" */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("更新检查闸门", () => {
  it("首次一定放行,间隔内的重复触发一律挡掉", () => {
    const clock = fakeClock();
    const gate = createUpdateGate(clock.now);

    expect(gate.tryTake()).toBe(true);
    expect(gate.tryTake()).toBe(false);

    clock.advance(UPDATE_MIN_INTERVAL_MS - 1);
    expect(gate.tryTake()).toBe(false);
  });

  it("满 30 分钟后再次放行,并以本次为新起点", () => {
    const clock = fakeClock();
    const gate = createUpdateGate(clock.now);

    expect(gate.tryTake()).toBe(true);
    clock.advance(UPDATE_MIN_INTERVAL_MS);
    expect(gate.tryTake()).toBe(true);
    // 记账要跟着最近一次走,否则第二次之后会连着放行
    expect(gate.tryTake()).toBe(false);
  });

  it("被挡掉的触发不刷新计时,不会因为频繁切前台而饿死", () => {
    const clock = fakeClock();
    const gate = createUpdateGate(clock.now);

    gate.tryTake();
    for (let i = 0; i < 29; i++) {
      clock.advance(60_000);
      expect(gate.tryTake()).toBe(false); // 每分钟切一次前台
    }
    clock.advance(60_000); // 满 30 分钟
    expect(gate.tryTake()).toBe(true);
  });

  it("手动检查记一笔账,紧接着的前台触发让路", () => {
    const clock = fakeClock();
    const gate = createUpdateGate(clock.now);

    gate.record();
    expect(gate.tryTake()).toBe(false);

    clock.advance(UPDATE_MIN_INTERVAL_MS);
    expect(gate.tryTake()).toBe(true);
  });

  it("系统时间被往回调时放行而不是闸死", () => {
    const clock = fakeClock();
    const gate = createUpdateGate(clock.now);

    expect(gate.tryTake()).toBe(true);
    clock.advance(-3 * UPDATE_MIN_INTERVAL_MS); // 用户改了时钟 / NTP 纠偏
    // 按差值算会得到负数而被当成"刚查过",一路挡到时间追上来为止
    expect(gate.tryTake()).toBe(true);
  });

  it("间隔可注入,不必在测试里等真实的 30 分钟", () => {
    const clock = fakeClock();
    const gate = createUpdateGate(clock.now, 5_000);

    expect(gate.tryTake()).toBe(true);
    clock.advance(4_999);
    expect(gate.tryTake()).toBe(false);
    clock.advance(1);
    expect(gate.tryTake()).toBe(true);
  });
});
