import { describe, expect, it } from "vitest";

import { ENGINE_MAX_RETRY, engineBannerView, engineCardView, engineTransition, railDotView } from "./engineBanner";
import type { EngineStatus } from "./types";

const crashed = (retry_in_ms: number | null, attempt = 1): EngineStatus => ({
  phase: "crashed",
  detail: "ohmyagent 进程异常退出",
  log_tail: "panic: nil map\ngoroutine 1 [running]:",
  attempt,
  retry_in_ms,
});

describe("engineBannerView", () => {
  it("引擎正常时不显示横幅", () => {
    expect(engineBannerView(null)).toBeNull();
    expect(engineBannerView({ phase: "ready", version: "abc123" })).toBeNull();
    // stopped 只在冷启动前与重启中途出现,拿它报警只会闪一下红
    expect(engineBannerView({ phase: "stopped" })).toBeNull();
  });

  it("冷启动不打扰,自动重启才外显进度", () => {
    expect(engineBannerView({ phase: "starting", attempt: 0 })).toBeNull();
    const v = engineBannerView({ phase: "starting", attempt: 2 });
    expect(v?.text).toContain(`2/${ENGINE_MAX_RETRY}`);
    expect(v?.busy).toBe(true);
    expect(v?.canRestart).toBe(false);
  });

  it("退避中告诉用户等多久,并且仍可手动立刻重启", () => {
    const v = engineBannerView(crashed(4000, 3));
    expect(v?.text).toContain("4 秒后自动重启");
    expect(v?.text).toContain(`3/${ENGINE_MAX_RETRY}`);
    expect(v?.canRestart).toBe(true);
    expect(v?.busy).toBe(false);
  });

  it("熔断后必须把球交回用户,不能只说崩了", () => {
    const v = engineBannerView(crashed(null, ENGINE_MAX_RETRY));
    expect(v?.text).toContain("自动重启均失败");
    expect(v?.canRestart).toBe(true);
    expect(v?.busy).toBe(false);
  });

  it("日志尾部只取最后一行进横幅(完整内容留给 title)", () => {
    expect(engineBannerView(crashed(1000))?.detail).toBe("goroutine 1 [running]:");
  });

  it("启动失败把具体错误露出来——这页此前只能重装应用", () => {
    const v = engineBannerView({ phase: "failed", error: "找不到 ohmyagent 可执行文件" });
    expect(v?.detail).toBe("找不到 ohmyagent 可执行文件");
    expect(v?.canRestart).toBe(true);
  });
});

describe("engineCardView", () => {
  it("ready/stopped 不占面板底部", () => {
    expect(engineCardView(null, true)).toBeNull();
    expect(engineCardView({ phase: "ready", version: "abc" }, true)).toBeNull();
    expect(engineCardView({ phase: "stopped" }, true)).toBeNull();
  });

  it("冷启动过了宽限期才显示——快速启动不闪卡,慢启动不再零反馈", () => {
    expect(engineCardView({ phase: "starting", attempt: 0 }, false)).toBeNull();
    const v = engineCardView({ phase: "starting", attempt: 0 }, true);
    expect(v?.text).toBe("引擎启动中…");
    expect(v?.busy).toBe(true);
    expect(v?.canRestart).toBe(false);
  });

  it("自动重启不受宽限期约束,直接外显进度", () => {
    const v = engineCardView({ phase: "starting", attempt: 3 }, false);
    expect(v?.text).toContain(`3/${ENGINE_MAX_RETRY}`);
    expect(v?.busy).toBe(true);
  });

  it("崩溃卡文案区分退避中与熔断,诊断进 detail(title 悬浮)", () => {
    const backoff = engineCardView(crashed(4000, 2), false);
    expect(backoff?.text).toContain(`2/${ENGINE_MAX_RETRY}`);
    expect(backoff?.canRestart).toBe(true);
    const fused = engineCardView(crashed(null, ENGINE_MAX_RETRY), false);
    expect(fused?.text).toContain("自动重启失败");
    expect(fused?.detail).toContain("ohmyagent 进程异常退出");
    expect(fused?.detail).toContain("goroutine 1 [running]:");
  });

  it("启动失败露具体错误", () => {
    const v = engineCardView({ phase: "failed", error: "找不到 ohmyagent 可执行文件" }, false);
    expect(v?.text).toBe("引擎启动失败");
    expect(v?.detail).toBe("找不到 ohmyagent 可执行文件");
    expect(v?.canRestart).toBe(true);
  });
});

describe("railDotView", () => {
  it("引擎异常时点必须变红——此前引擎崩了与'没开会话'同为灰,不可区分", () => {
    expect(railDotView(crashed(1000), false, "").color).toBe("var(--err)");
    expect(railDotView({ phase: "failed", error: "x" }, true, "").color).toBe("var(--err)");
  });

  it("启动中黄点脉动", () => {
    const v = railDotView({ phase: "starting", attempt: 0 }, false, "");
    expect(v.color).toBe("var(--notice)");
    expect(v.pulse).toBe(true);
  });

  it("引擎 ready 后沿用会话连接语义(绿/灰 + 会话状态 title)", () => {
    const on = railDotView({ phase: "ready", version: "abc" }, true, "已连接");
    expect(on.color).toBe("var(--ok)");
    expect(on.title).toBe("已连接");
    const off = railDotView({ phase: "ready", version: "abc" }, false, "未连接");
    expect(off.color).toBe("var(--t6)");
    expect(off.glow).toBeNull();
  });

  it("快照未到(null)不误报,按会话连接展示", () => {
    expect(railDotView(null, true, "").color).toBe("var(--ok)");
    expect(railDotView(null, false, "").color).toBe("var(--t6)");
  });
});

describe("engineTransition(引擎重启后的免刷新重连触发)", () => {
  it("冷启动直接就绪不重连(没掉过就没有失效句柄要救)", () => {
    const t = engineTransition(false, "ready");
    expect(t.reconnect).toBe(false);
    expect(t.wasDown).toBe(false);
  });

  it("掉过再就绪才重连,且只重连一次", () => {
    // 保存/手动重启/崩溃自愈都先经 starting
    const down = engineTransition(false, "starting");
    expect(down.wasDown).toBe(true);
    expect(down.reconnect).toBe(false);
    const back = engineTransition(down.wasDown, "ready");
    expect(back.reconnect).toBe(true);
    expect(back.wasDown).toBe(false); // 记忆清零
    // 紧接着又来一次 ready(多客户端/补拉快照)不该重复重连
    expect(engineTransition(back.wasDown, "ready").reconnect).toBe(false);
  });

  it("崩溃/失败都算掉线,退避期间加载页面也能记住", () => {
    expect(engineTransition(false, "crashed").wasDown).toBe(true);
    expect(engineTransition(false, "failed").wasDown).toBe(true);
    // 页面在退避窗口里加载:补拉的快照是 crashed,引擎回来时照样重连
    expect(engineTransition(engineTransition(false, "crashed").wasDown, "ready").reconnect).toBe(true);
  });

  it("stopped 不记也不清:冷启动前的它不该触发重连,也不该抹掉已记的掉线", () => {
    expect(engineTransition(false, "stopped").wasDown).toBe(false);
    expect(engineTransition(true, "stopped").wasDown).toBe(true);
    expect(engineTransition(false, "stopped").reconnect).toBe(false);
  });

  it("重启按钮忙态在终态解除(失败也要解,否则永远卡在重启中)", () => {
    expect(engineTransition(true, "ready").clearRestarting).toBe(true);
    expect(engineTransition(true, "failed").clearRestarting).toBe(true);
    expect(engineTransition(true, "starting").clearRestarting).toBe(false);
    expect(engineTransition(true, "crashed").clearRestarting).toBe(false);
  });
});
