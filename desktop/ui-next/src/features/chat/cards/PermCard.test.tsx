import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { PermItem } from "@/lib/protocol/types";
import { PermActions, PermCard } from "./PermCard";

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

interface Call {
  cmd: string;
  args?: Record<string, unknown>;
}

function stubShell({ permRemember = true }: { permRemember?: boolean } = {}): Call[] {
  const calls: Call[] = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        if (cmd === "engine_caps") {
          return Promise.resolve({ browser_ext: false, usage_update: true, perm_remember: permRemember, attachments: true });
        }
        return Promise.resolve(undefined);
      },
    },
  };
  return calls;
}

// 引擎给的 title 形如「<工具> <参数>」(driver/frame.rs);过一遍工具词表
// 才是中文界面该看到的东西,原串退到 title 悬停
const PERM: PermItem = { kind: "perm", id: "p1", title: "Bash rm -rf /tmp/x", tool: "Bash", state: "open" };

describe("审批卡", () => {
  it("待答复:警示头 + 本地化操作正文(原串进 title)+ 四动作 + ⏎/esc 脚注", () => {
    stubShell();
    render(<PermCard item={PERM} sessionId="s1" />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("需要确认")).toBeTruthy();
    expect(screen.getByText("Bash")).toBeTruthy();
    // 修复前这里摊的是 `Bash rm -rf /tmp/x`,而同会话里锚定型审批行显示的
    // 是「需要确认 · 执行命令」——两种审批形态语言不一致
    const body = screen.getByText("执行命令 rm -rf /tmp/x");
    expect(body.classList.contains("mc-workbench-material-muted")).toBe(true);
    expect(body.getAttribute("title")).toBe("Bash rm -rf /tmp/x");
    for (const name of ["允许", "本会话始终允许", "此项目永久允许", "拒绝"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByText("⏎")).toBeTruthy();
    expect(screen.getByText("esc")).toBeTruthy();
  });

  it("engine_caps.perm_remember=false 隐藏两个「始终」档", async () => {
    stubShell({ permRemember: false });
    render(<PermCard item={PERM} sessionId="s1" />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "本会话始终允许" })).toBeNull());
    expect(screen.queryByRole("button", { name: "此项目永久允许" })).toBeNull();
    expect(screen.getByRole("button", { name: "允许" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeTruthy();
  });

  it.each([
    ["允许", { approved: true, remember: false, persist: false }],
    ["本会话始终允许", { approved: true, remember: true, persist: false }],
    ["此项目永久允许", { approved: true, remember: true, persist: true }],
    ["拒绝", { approved: false, remember: false, persist: false }],
  ] as const)("点「%s」→ permission-resp 载荷正确且本地乐观置态", async (name, expected) => {
    const calls = stubShell();
    render(<PermCard item={PERM} sessionId="s1" />);
    await userEvent.click(screen.getByRole("button", { name }));
    const sent = calls.find((c) => c.cmd === "session_send");
    expect(sent?.args).toEqual({
      id: "s1",
      ftype: "permission-resp",
      payload: { id: "p1", ...expected },
    });
    // 乐观回写:按钮消失,出现结果标签(权威 outcome 由 resolved 帧回写归约层)
    expect(screen.queryByRole("button", { name: "允许" })).toBeNull();
    expect(screen.getByText(expected.approved ? "已允许" : "已拒绝")).toBeTruthy();
  });

  it("发送失败回滚:按钮恢复可点(答复没送达不能假装已决)", async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string) =>
          cmd === "session_send" ? Promise.reject(new Error("boom")) : Promise.resolve(null),
      },
    };
    render(<PermCard item={PERM} sessionId="s1" />);
    await userEvent.click(screen.getByRole("button", { name: "允许" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "允许" })).toBeTruthy());
  });

  it("已决/过期收成一行状态(审计痕迹,不再有按钮)", () => {
    stubShell();
    render(<PermCard item={{ ...PERM, state: "denied" }} sessionId="s1" />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("已拒绝")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("乐观态按 perm.id 键控:同一渲染位换新审批卡,按钮行重现(H8)", async () => {
    stubShell();
    const { rerender } = render(<PermCard item={PERM} sessionId="s1" />);
    await userEvent.click(screen.getByRole("button", { name: "允许" }));
    expect(screen.queryByRole("button", { name: "允许" })).toBeNull();
    expect(screen.getByText("已允许")).toBeTruthy();

    // React 复用同一组件实例(位置/类型相同):新卡不能顶着旧卡的乐观徽标
    rerender(<PermCard item={{ ...PERM, id: "p2", title: "curl example.com" }} sessionId="s1" />);
    expect(screen.getByRole("button", { name: "允许" })).toBeTruthy();
    expect(screen.queryByText("已允许")).toBeNull();
  });

  it("只读回放(readonly):open 态也收成一行审计痕迹,无按钮", () => {
    stubShell();
    render(<PermCard item={PERM} sessionId="c1" readonly />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("需要确认")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("PermActions 可独立复用(工具卡内嵌形态)", async () => {
    const calls = stubShell();
    render(<PermActions perm={PERM} sessionId="s1" />);
    await userEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(calls.some((c) => c.cmd === "session_send")).toBe(true);
  });
});
