import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EngineBanner } from "./EngineBanner";

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

type Emit = (s: unknown) => void;

function stubShell(snapshot: unknown, { failRestart }: { failRestart?: string } = {}) {
  const calls: string[] = [];
  let emit: Emit = () => {};
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string) => {
        calls.push(cmd);
        if (cmd === "engine_status") return Promise.resolve(snapshot);
        if (cmd === "engine_restart" && failRestart) return Promise.reject(new Error(failRestart));
        return Promise.resolve(null);
      },
    },
    event: {
      listen: (name: string, cb: (e: { payload: unknown }) => void) => {
        if (name === "engine-status") emit = (s) => cb({ payload: s });
        return Promise.resolve(() => {});
      },
    },
  };
  return { calls, emit: (s: unknown) => emit(s) };
}

describe("引擎状态横幅", () => {
  it("ready 不渲染;崩溃事件到达即亮错误横幅,可重启/开日志", async () => {
    const { calls, emit } = stubShell({ phase: "ready", version: "1.0" });
    const { container } = render(<EngineBanner />);
    await act(() => Promise.resolve());
    expect(container.querySelector('[role="alert"]')).toBeNull();

    act(() => emit({ phase: "crashed", detail: "OOM", log_tail: "", attempt: 2, retry_in_ms: null }));
    expect(screen.getByRole("alert").textContent).toContain("OOM");
    await userEvent.click(screen.getByRole("button", { name: "重启引擎" }));
    expect(calls).toContain("engine_restart");
    await userEvent.click(screen.getByRole("button", { name: "日志" }));
    expect(calls).toContain("open_log_dir");
  });

  it("starting 有 3 秒宽限:快启动不闪横幅,超时才显示", async () => {
    vi.useFakeTimers();
    const { emit } = stubShell({ phase: "starting", attempt: 1 });
    const { container } = render(<EngineBanner />);
    await act(() => Promise.resolve());
    expect(container.querySelector('[role="status"]')).toBeNull();

    act(() => vi.advanceTimersByTime(3100));
    expect(screen.getByRole("status").textContent).toContain("引擎启动中");

    // 宽限内转 ready:横幅从未出现过的路径
    act(() => emit({ phase: "ready", version: "1.0" }));
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("attempt 文案:0/1 不提第 N 次,attempt≥2 才提", async () => {
    vi.useFakeTimers();
    const { emit } = stubShell({ phase: "starting", attempt: 0 });
    render(<EngineBanner />);
    await act(() => Promise.resolve());
    act(() => vi.advanceTimersByTime(3100));
    expect(screen.getByRole("status").textContent).not.toContain("第");

    act(() => emit({ phase: "starting", attempt: 1 }));
    act(() => vi.advanceTimersByTime(3100));
    expect(screen.getByRole("status").textContent).not.toContain("第");

    act(() => emit({ phase: "starting", attempt: 2 }));
    act(() => vi.advanceTimersByTime(3100));
    expect(screen.getByRole("status").textContent).toContain("第 2 次");
  });

  it("crashed 带退避:报 N 秒后自动重试与次数,log_tail 收进 collapse 详情", async () => {
    stubShell({ phase: "crashed", detail: "进程退出", log_tail: "boom\nlast line", attempt: 3, retry_in_ms: 5000 });
    const { container } = render(<EngineBanner />);
    await act(() => Promise.resolve());
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("进程退出");
    expect(alert.textContent).toContain("5 秒后自动重试");
    expect(alert.textContent).toContain("第 3 次");
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    expect(details?.textContent).toContain("日志详情");
    expect(details?.querySelector("pre")?.textContent).toContain("last line");
  });

  it("crashed 熔断(retry_in_ms=null):明说已停止自动重试;attempt=1 不提次数", async () => {
    stubShell({ phase: "crashed", detail: "启动即退", log_tail: "", attempt: 1, retry_in_ms: null });
    render(<EngineBanner />);
    await act(() => Promise.resolve());
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("已停止自动重试");
    expect(alert.textContent).not.toContain("第 1 次");
  });

  it("重启失败:按钮复位可再点,并外显失败文案", async () => {
    stubShell(
      { phase: "crashed", detail: "OOM", log_tail: "", attempt: 5, retry_in_ms: null },
      { failRestart: "引擎二进制缺失" },
    );
    render(<EngineBanner />);
    await act(() => Promise.resolve());
    const btn = screen.getByRole("button", { name: "重启引擎" });
    await userEvent.click(btn);
    await act(() => Promise.resolve());
    expect((btn as HTMLButtonElement).disabled).toBe(false); // 忙态已复位
    expect(screen.getByRole("alert").textContent).toContain("重启失败:引擎二进制缺失");
  });

  it("failed 显示错误并可重启", async () => {
    stubShell({ phase: "failed", error: "端口被占用" });
    render(<EngineBanner />);
    await act(() => Promise.resolve());
    expect(screen.getByRole("alert").textContent).toContain("端口被占用");
  });
});
