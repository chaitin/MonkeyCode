// 原生预览遮挡信号:引用计数语义是多浮层并存(菜单叠在模态上)的正确性
// 根基,通知只在 0↔1 边沿——订阅方(useSyncExternalStore)按布尔快照渲染。
import { describe, expect, it, vi } from "vitest";

import { acquireNativeObscure, nativeObscured, subscribeNativeObscure } from "./nativeObscure";

describe("nativeObscure 遮挡计数", () => {
  it("多方并存按引用计数:先释放一方仍遮挡,全释放才归零;重复释放幂等", () => {
    expect(nativeObscured()).toBe(false);
    const releaseA = acquireNativeObscure();
    const releaseB = acquireNativeObscure();
    expect(nativeObscured()).toBe(true);
    releaseA();
    expect(nativeObscured()).toBe(true);
    releaseA(); // 幂等:重复释放不得把别人的计数扣掉
    expect(nativeObscured()).toBe(true);
    releaseB();
    expect(nativeObscured()).toBe(false);
  });

  it("通知只在 0↔1 边沿触发", () => {
    const cb = vi.fn();
    const unsubscribe = subscribeNativeObscure(cb);
    const releaseA = acquireNativeObscure();
    const releaseB = acquireNativeObscure(); // 1→2 不通知
    expect(cb).toHaveBeenCalledTimes(1);
    releaseB(); // 2→1 不通知
    expect(cb).toHaveBeenCalledTimes(1);
    releaseA(); // 1→0 通知
    expect(cb).toHaveBeenCalledTimes(2);
    unsubscribe();
    const releaseC = acquireNativeObscure();
    releaseC();
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
