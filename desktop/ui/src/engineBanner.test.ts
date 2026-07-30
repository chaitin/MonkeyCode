import { describe, expect, it } from "vitest";

import { ENGINE_MAX_RETRY, engineBannerView } from "./engineBanner";
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
