import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { resetUpdateForTest, useUpdateState } from "@/features/update/useUpdate";
import { AboutSection } from "./AboutSection";

afterEach(() => {
  // 更新态是模块级 store(侧栏底部条与本页同源),跨用例会串
  act(() => resetUpdateForTest());
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

function stubShell({ failInstall, exportLog }: { failInstall?: string; exportLog?: () => unknown } = {}) {
  const calls: string[] = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string) => {
        calls.push(cmd);
        if (cmd === "host_info") return Promise.resolve({ version: "1.0", engine_version: "0.9" });
        if (cmd === "update_check") return Promise.resolve({ available: true, current: "1.0", latest: "1.1" });
        if (cmd === "update_install" && failInstall) return Promise.reject(new Error(failInstall));
        if (cmd === "update_install") return new Promise(() => {}); // 成功:壳自行重启,不返回
        if (cmd === "export_engine_log" && exportLog) {
          try {
            return Promise.resolve(exportLog());
          } catch (e) {
            return Promise.reject(e);
          }
        }
        return Promise.resolve(null);
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  };
  return { calls };
}

function SidebarUpdateProbe() {
  const { installing } = useUpdateState();
  return <span data-testid="sidebar-update-state">{installing ? "installing" : "idle"}</span>;
}

/** 隐藏排障入口的解锁手势:连点版本号 5 次。 */
async function unlock() {
  const version = await screen.findByRole("button", { name: /应用 1\.0/ });
  for (let i = 0; i < 5; i++) await userEvent.click(version);
}

describe("关于页更新(H5)", () => {
  it("发现更新使用信息提示，并明确安装后自动重启应用", async () => {
    stubShell();
    render(<AboutSection />);
    await userEvent.click(screen.getByRole("button", { name: "检查更新" }));

    const status = await screen.findByRole("status");
    expect(status.className).toContain("alert-info");
    expect(status.className).not.toContain("alert-success");
    expect(status.textContent).toContain("安装完成后应用将自动重启");
  });

  it("安装失败:复位忙态、外显失败文案,后续排障反馈不被旧错误遮蔽", async () => {
    stubShell({ failInstall: "签名校验失败", exportLog: () => "/tmp/ohmyagent.log" });
    render(<AboutSection />);
    await userEvent.click(screen.getByRole("button", { name: "检查更新" }));
    const install = await screen.findByRole("button", { name: "下载更新" });

    await userEvent.click(install);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("更新失败:签名校验失败"));
    const again = screen.getByRole("button", { name: "下载更新" }); // 忙态已复位,不再是"更新中…"
    expect((again as HTMLButtonElement).disabled).toBe(false);

    await unlock();
    await userEvent.click(screen.getByRole("button", { name: "导出日志" }));
    expect((await screen.findByRole("status")).textContent).toContain("日志已导出");
    expect(screen.queryByText(/更新失败/)).toBeNull();
  });

  it("设置页发起安装后共享忙态，侧栏提醒同步进入安装中", async () => {
    stubShell();
    render(
      <>
        <AboutSection />
        <SidebarUpdateProbe />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "检查更新" }));
    await userEvent.click(await screen.findByRole("button", { name: "下载更新" }));
    const busy = screen.getByRole("button", { name: /更新中/ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("sidebar-update-state").textContent).toBe("installing");
  });
});

describe("隐藏排障入口(连点版本号解锁)", () => {
  // 「导出日志」= 一步拿到可直接附进工单的引擎日志副本(走另存对话框),
  // 与「打开存储目录 → 自己进 ohmyagent/logs/ 找文件」不是一回事;撤掉后
  // exportEngineLog 在整个 ui-next 里零调用者。按同一把解锁钥匙恢复
  it("解锁后可导出引擎日志:走 export_engine_log,成功给回执", async () => {
    const { calls } = stubShell({ exportLog: () => "/tmp/ohmyagent.log" });
    render(<AboutSection />);
    await unlock();
    await userEvent.click(screen.getByRole("button", { name: "导出日志" }));
    await waitFor(() => expect(calls).toContain("export_engine_log"));
    expect((await screen.findByRole("status")).textContent).toContain("日志已导出");
  });

  it("另存对话框被取消(壳回 null):不谎报成功;失败则外显壳的中文 Err", async () => {
    const failing = { on: false };
    stubShell({
      exportLog: () => {
        if (failing.on) throw new Error("引擎日志不存在");
        return null;
      },
    });
    render(<AboutSection />);
    await unlock();
    await userEvent.click(screen.getByRole("button", { name: "导出日志" }));
    expect(screen.queryByText("日志已导出")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    failing.on = true;
    await userEvent.click(screen.getByRole("button", { name: "导出日志" }));
    expect((await screen.findByRole("alert")).textContent).toContain("引擎日志不存在");
  });

  // 不解锁时一个排障入口都不占位;「打开扩展目录」是真撤了(常驻入口在
  // 设置·浏览器分区),解锁也不会出现
  it("常态只有「检查更新」:三个排障入口都不出现,打开扩展目录更是已撤", async () => {
    stubShell();
    render(<AboutSection />);
    await screen.findByText(/应用 1\.0/);
    expect(screen.queryByRole("button", { name: "重启引擎" })).toBeNull();
    expect(screen.queryByRole("button", { name: "导出日志" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打开扩展目录" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打开程序目录" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打开存储目录" })).toBeNull();
  });

  it("连点版本号 5 次:两个入口现身,分别走 open_app_dir / open_log_dir", async () => {
    const { calls } = stubShell();
    render(<AboutSection />);
    const version = await screen.findByRole("button", { name: /应用 1\.0/ });
    for (let i = 0; i < 4; i++) await userEvent.click(version);
    expect(screen.queryByRole("button", { name: "打开程序目录" })).toBeNull(); // 差一次不解锁
    await userEvent.click(version);

    await userEvent.click(screen.getByRole("button", { name: "打开程序目录" }));
    await userEvent.click(screen.getByRole("button", { name: "打开存储目录" }));
    await waitFor(() => expect(calls).toContain("open_app_dir"));
    expect(calls).toContain("open_log_dir");
  });
});
