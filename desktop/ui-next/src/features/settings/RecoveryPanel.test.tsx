import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SkillRecoveryIssue } from "@/lib/ipc/skills";
import { RecoveryPanel } from "./RecoveryPanel";

const ISSUE: SkillRecoveryIssue = {
  transaction_id: "tx-1",
  entry_path: ".skill-transactions/tx-1.json",
  skill_name: "broken-skill",
  portable_name_key: "broken-skill",
  backup_available: true,
  installed_available: false,
  isolated_available: true,
  authoritative_target_missing: true,
  // The backend deliberately allows only preserve-files despite a backup being
  // present; the UI must never infer actions from candidate flags.
  actions: ["preserve-files"],
  error: "transaction layout changed",
};

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("RecoveryPanel", () => {
  it("列出 issue/candidates，只显示合法动作，并展示 preserved path 后等待 catalog target revision", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    let listCount = 0;
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          calls.push({ cmd, args });
          if (cmd === "skills_recovery_list") {
            listCount += 1;
            return Promise.resolve(listCount === 1 ? [ISSUE] : []);
          }
          if (cmd === "skills_recovery_resolve") {
            return Promise.resolve({ preserved_path: "/config/skill-recovery/tx-1", catalog_revision: 12 });
          }
          return Promise.resolve(null);
        },
      },
    };
    const refresh = vi.fn().mockResolvedValue({ revision: 12, store_id: "test", skills: [] });

    render(<RecoveryPanel refreshSkillsCatalog={refresh} />);

    expect(await screen.findByText("broken-skill")).toBeTruthy();
    expect(screen.getByText("原版本备份")).toBeTruthy();
    expect(screen.getByText("已安装版本")).toBeTruthy();
    expect(screen.getByText("隔离版本")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "恢复原版本" })).toBeNull();
    expect(screen.queryByRole("button", { name: "保留已安装版本" })).toBeNull();
    expect(screen.getByRole("region", { name: "技能库需要恢复" })).toBeTruthy();

    const action = screen.getByRole("button", { name: "保留恢复文件并解除阻塞" });
    expect(action.getAttribute("aria-describedby")).toBeTruthy();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "刷新恢复问题" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(action);
    await userEvent.keyboard("{Enter}");
    const preserved = await screen.findByText(/\/config\/skill-recovery\/tx-1/);
    expect(preserved.getAttribute("role")).toBe("status");
    await waitFor(() => expect(refresh).toHaveBeenCalledWith(12));
    expect(calls).toEqual([
      { cmd: "skills_recovery_list", args: undefined },
      { cmd: "skills_recovery_resolve", args: { transactionId: "tx-1", action: "preserve-files" } },
      { cmd: "skills_recovery_list", args: undefined },
    ]);
  });

  it("多个 issue 分别只渲染服务端给出的 restore/keep 动作，并在最后解除权威缺失后等待最高 revision", async () => {
    const restoreIssue: SkillRecoveryIssue = {
      ...ISSUE,
      transaction_id: "tx-restore",
      skill_name: "restore-me",
      isolated_available: false,
      actions: ["restore-backup"],
    };
    const keepIssue: SkillRecoveryIssue = {
      ...ISSUE,
      transaction_id: "tx-keep",
      skill_name: "keep-me",
      backup_available: false,
      installed_available: true,
      isolated_available: false,
      actions: ["keep-installed"],
    };
    let issues = [restoreIssue, keepIssue];
    const resolves: Array<Record<string, unknown> | undefined> = [];
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "skills_recovery_list") return Promise.resolve(issues);
        if (cmd === "skills_recovery_resolve") {
          resolves.push(args);
          issues = issues.filter((issue) => issue.transaction_id !== args?.transactionId);
          return Promise.resolve({
            preserved_path: null,
            catalog_revision: args?.transactionId === "tx-restore" ? 15 : 14,
          });
        }
        return Promise.resolve(null);
      } },
    };
    const refresh = vi.fn().mockResolvedValue({ revision: 15, store_id: "test", skills: [] });
    render(<RecoveryPanel initialIssues={issues} refreshSkillsCatalog={refresh} />);

    expect(await screen.findByRole("button", { name: "恢复原版本" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保留已安装版本" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保留恢复文件并解除阻塞" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "恢复原版本" }));
    await waitFor(() => expect(screen.queryByText("restore-me")).toBeNull());
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "保留已安装版本" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith(15));
    expect(resolves).toEqual([
      { transactionId: "tx-restore", action: "restore-backup" },
      { transactionId: "tx-keep", action: "keep-installed" },
    ]);
  });

  it("resolve 后 list 瞬时失败仍保留 target revision，手动刷新清错并可反复重试 catalog", async () => {
    let listCount = 0;
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: (cmd: string) => {
        if (cmd === "skills_recovery_list") {
          listCount += 1;
          if (listCount === 1) return Promise.resolve([ISSUE]);
          if (listCount === 2) return Promise.reject(new Error("temporary list failure"));
          return Promise.resolve([]);
        }
        if (cmd === "skills_recovery_resolve") {
          return Promise.resolve({ preserved_path: null, catalog_revision: 23 });
        }
        return Promise.resolve(null);
      } },
    };
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error("temporary catalog failure"))
      .mockResolvedValue({ revision: 23, store_id: "test", skills: [] });
    render(<RecoveryPanel refreshSkillsCatalog={refresh} />);

    await userEvent.click(await screen.findByRole("button", { name: "保留恢复文件并解除阻塞" }));
    expect(await screen.findByText(/temporary list failure/)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "刷新恢复问题" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith(23));
    expect(screen.queryByText(/temporary list failure/)).toBeNull();
    expect(await screen.findByText(/temporary catalog failure/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "刷新恢复问题" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(refresh.mock.calls).toEqual([[23], [23]]);
    await waitFor(() => expect(screen.queryByRole("region", { name: "技能库需要恢复" })).toBeNull());
  });
});
