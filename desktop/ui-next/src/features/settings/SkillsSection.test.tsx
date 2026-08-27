import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { SkillImportBatchPreview, SkillImportSourceKind } from "@/lib/ipc/skills";
import { SkillsSection } from "./SkillsSection";

function importedBatch(kinds: SkillImportSourceKind[], revision: number): SkillImportBatchPreview {
  const sources = kinds.map((kind, index) => ({
    source_id: `source-${index}`,
    order: index,
    kind,
    display_name: kind === "folders" ? `folder-${index + 1}` : `archive-${index + 1}.zip`,
    status: "ready" as const,
    skill_count: 1,
    error: null,
  }));
  const items = sources.map((source, index) => ({
    item_id: `item-${index}`,
    source_id: source.source_id,
    order: index,
    source_display_name: source.display_name,
    relative_root: `skill-${index}`,
    name: `skill-${index}`,
    portable_name_key: `skill-${index}`,
    description: `description-${index}`,
    files: [],
    total_size: 1,
    risks: [],
    validity: { status: "valid" as const },
    conflict: { kind: "none" as const },
    duplicate_group: null,
    state: "pending" as const,
    last_error: null,
  }));
  return {
    batch_id: "batch-multi",
    phase: "collecting",
    snapshot_revision: revision,
    in_flight_source_picks: 0,
    catalog_revision: null,
    sources,
    items,
    totals: {
      source_count: sources.length,
      item_count: items.length,
      importable_count: items.length,
      conflict_count: 0,
      risk_count: 0,
      invalid_count: 0,
    },
  };
}

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("技能设置导入入口", () => {
  it("list 的结构化普通对象 rejection 优先展示 message", async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: (cmd: string) => {
        if (cmd === "skills_list") return Promise.reject({ code: "list-failed", message: "catalog unavailable" });
        if (cmd === "skills_import_current") return Promise.resolve({ snapshot_revision: 0, batch: null });
        if (cmd === "skills_recovery_list") return Promise.resolve([]);
        return Promise.resolve(null);
      } },
      event: { listen: () => Promise.resolve(() => {}) },
    };

    render(<SkillsSection />);

    expect(await screen.findByText("技能库读取失败:catalog unavailable")).toBeTruthy();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
  });

  it("save/delete/default/import 的普通对象 rejection 安全展示 message 或通用文案", async () => {
    const calls: string[] = [];
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: (cmd: string) => {
        calls.push(cmd);
        if (cmd === "skills_list") return Promise.resolve({
          revision: 1,
          store_id: "test",
          skills: [{
            name: "custom",
            description: "Custom skill",
            source: "user",
            content: "---\ndescription: Custom skill\n---",
            overrides: false,
            default_enabled: true,
          }],
        });
        if (cmd === "skills_import_current") return Promise.resolve({ snapshot_revision: 0, batch: null });
        if (cmd === "skills_recovery_list") return Promise.resolve([]);
        if (cmd === "skills_set_default") return Promise.reject({ code: "default-failed", message: "default unavailable" });
        if (cmd === "skills_save") return Promise.reject({ code: "save-failed", message: "save unavailable" });
        if (cmd === "skills_delete") return Promise.reject({ code: "delete-failed", message: "delete unavailable" });
        if (cmd === "skills_import_pick") return Promise.reject({ code: "pick-failed", detail: "must not stringify" });
        return Promise.resolve(null);
      } },
      event: { listen: () => Promise.resolve(() => {}) },
    };

    render(<SkillsSection />);
    expect(await screen.findByText("Custom skill")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "取消默认" }));
    expect(await screen.findByText("保存失败:default unavailable")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("保存失败:save unavailable")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByText("删除失败:delete unavailable")).toBeTruthy();

    const importButton = (screen.getAllByRole("button", { name: "导入技能" }))[0]!;
    await userEvent.click(importButton);
    await userEvent.click(screen.getByRole("menuitem", { name: /选择文件夹/ }));
    expect(await screen.findByText("导入来源选择失败:未知错误")).toBeTruthy();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
    expect(calls).toEqual(expect.arrayContaining([
      "skills_set_default",
      "skills_save",
      "skills_delete",
      "skills_import_pick",
    ]));
  });

  it("完成批次的 target 请求晚于 focus 的 RecoveryPending 失败时，dialog 进入恢复态而不悬挂", async () => {
    const completed = importedBatch(["folders"], 7);
    completed.phase = "completed";
    completed.catalog_revision = 5;
    completed.items[0]!.state = "succeeded";
    const issue = {
      transaction_id: "tx-concurrent",
      entry_path: ".skill-transactions/tx-concurrent.json",
      skill_name: "needs-recovery",
      portable_name_key: "needs-recovery",
      backup_available: true,
      installed_available: false,
      isolated_available: false,
      authoritative_target_missing: true,
      actions: ["restore-backup"],
      error: "target missing",
    };
    const pendingLists: Array<{ reject: (reason: unknown) => void }> = [];
    let deferLists = false;
    let resolveCurrent!: (value: unknown) => void;
    const current = new Promise((resolve) => { resolveCurrent = resolve; });
    let listCalls = 0;
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: (cmd: string) => {
        if (cmd === "skills_list") {
          listCalls += 1;
          if (!deferLists) return Promise.resolve({ revision: 1, store_id: "test", skills: [] });
          return new Promise((_resolve, reject) => pendingLists.push({ reject }));
        }
        if (cmd === "skills_import_current") return current;
        if (cmd === "skills_recovery_list") return Promise.resolve([issue]);
        return Promise.resolve(null);
      } },
      event: { listen: () => Promise.resolve(() => {}) },
    };

    render(<SkillsSection />);
    await waitFor(() => expect(listCalls).toBeGreaterThan(0));
    await act(async () => { await Promise.resolve(); });
    deferLists = true;
    await act(async () => resolveCurrent({ snapshot_revision: 7, batch: completed }));
    expect(await screen.findByRole("dialog", { name: "导入完成" })).toBeTruthy();
    await waitFor(() => expect(pendingLists).toHaveLength(1));

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(pendingLists).toHaveLength(2));
    const focusFailure = { code: "recovery-pending", issues: [issue] };
    const targetFailure = { code: "recovery-pending", issues: [issue] };
    await act(async () => pendingLists[1]?.reject(focusFailure));
    await act(async () => pendingLists[0]?.reject(targetFailure));

    expect(await screen.findByRole("region", { name: "技能库需要恢复" })).toBeTruthy();
    expect(screen.getByText("needs-recovery")).toBeTruthy();
    expect(screen.getByText("请先解决下方全部权威技能目录缺失问题，再重试技能库刷新；刷新成功前不能关闭。")).toBeTruthy();
    const closeButtons = screen.getAllByRole("button", { name: "关闭" }) as HTMLButtonElement[];
    expect(closeButtons.at(-1)?.disabled).toBe(true);
  });

  it("顶部和自定义空态都有新建/导入，来源菜单调用 task 17 controller pick", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          calls.push({ cmd, args });
          if (cmd === "skills_list") return Promise.resolve({ revision: 1, store_id: "test", skills: [] });
          if (cmd === "skills_import_current") return Promise.resolve({ snapshot_revision: 0, batch: null });
          if (cmd === "skills_import_pick") return Promise.resolve(null);
          return Promise.resolve(null);
        },
      },
      event: { listen: () => Promise.resolve(() => {}) },
    };

    render(<SkillsSection />);

    await waitFor(() => expect(screen.getAllByRole("button", { name: "新建技能" })).toHaveLength(2));
    const importButtons = await screen.findAllByRole("button", { name: "导入技能" });
    expect(importButtons).toHaveLength(2);
    const topImport = importButtons[0]!;
    const emptyImport = importButtons[1]!;
    await waitFor(() => expect((topImport as HTMLButtonElement).disabled).toBe(false));

    await userEvent.click(topImport);
    const topMenu = screen.getByRole("menu", { name: "导入技能" });
    expect(topImport.getAttribute("aria-controls")).toBe(topMenu.id);
    expect(topImport.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(screen.getByRole("menuitem", { name: /选择文件夹/ }));
    await waitFor(() =>
      expect(calls).toContainEqual({ cmd: "skills_import_pick", args: { sourceKind: "folders", batchId: null } }),
    );

    await waitFor(() => expect((emptyImport as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(emptyImport);
    await userEvent.click(screen.getByRole("menuitem", { name: /选择 ZIP/ }));
    await waitFor(() =>
      expect(calls).toContainEqual({ cmd: "skills_import_pick", args: { sourceKind: "zips", batchId: null } }),
    );
  });

  it("一次多文件夹后继续追加一次多 ZIP，始终复用同一批次并更新真实摘要", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    const folders = importedBatch(["folders", "folders"], 1);
    const withZips = importedBatch(["folders", "folders", "zips", "zips"], 2);
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          calls.push({ cmd, args });
          if (cmd === "skills_list") return Promise.resolve({ revision: 0, store_id: "test", skills: [] });
          if (cmd === "skills_import_current") return Promise.resolve({ snapshot_revision: 0, batch: null });
          if (cmd === "skills_recovery_list") return Promise.resolve([]);
          if (cmd === "skills_import_pick") {
            return Promise.resolve(args?.sourceKind === "folders" ? folders : withZips);
          }
          return Promise.resolve(null);
        },
      },
      event: { listen: () => Promise.resolve(() => {}) },
    };

    render(<SkillsSection />);
    const importButton = (await screen.findAllByRole("button", { name: "导入技能" }))[0]!;
    await waitFor(() => expect((importButton as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(importButton);
    await userEvent.click(screen.getByRole("menuitem", { name: /选择文件夹/ }));

    expect(await screen.findByText(/2 个来源 · 2 个技能/)).toBeTruthy();
    expect(screen.getByText(/folder-1 \/ skill-0/)).toBeTruthy();
    expect(screen.getByText(/folder-2 \/ skill-1/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "添加来源" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /选择 ZIP/ }));
    expect(await screen.findByText(/4 个来源 · 4 个技能/)).toBeTruthy();
    expect(screen.getByText(/archive-3\.zip \/ skill-2/)).toBeTruthy();
    expect(screen.getByText(/archive-4\.zip \/ skill-3/)).toBeTruthy();
    expect(calls.filter((call) => call.cmd === "skills_import_pick").map((call) => call.args)).toEqual([
      { sourceKind: "folders", batchId: null },
      { sourceKind: "zips", batchId: "batch-multi" },
    ]);
  });

  it("current 返回在途来源时工作台外显索引状态并禁止提交、追加和关闭", async () => {
    const inFlight = {
      ...importedBatch(["folders", "folders"], 5),
      in_flight_source_picks: 1,
    };
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: (cmd: string) => {
        if (cmd === "skills_list") return Promise.resolve({ revision: 0, store_id: "test", skills: [] });
        if (cmd === "skills_import_current") return Promise.resolve({ snapshot_revision: 5, batch: inFlight });
        if (cmd === "skills_recovery_list") return Promise.resolve([]);
        return Promise.resolve(null);
      } },
      event: { listen: () => Promise.resolve(() => {}) },
    };

    render(<SkillsSection />);
    expect(await screen.findByText("正在选择并安全索引来源…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "添加来源" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "导入 2 个技能" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByRole("button", { name: "关闭" }).at(-1) as HTMLButtonElement).disabled).toBe(true);
  });

  it("提交 IPC 在途期间立即锁定整个工作台并拒绝 Escape/重复提交", async () => {
    const preview = importedBatch(["folders"], 1);
    let resolveCommit: ((value: unknown) => void) | undefined;
    const calls: string[] = [];
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: (cmd: string) => {
        calls.push(cmd);
        if (cmd === "skills_list") return Promise.resolve({ revision: 0, store_id: "test", skills: [] });
        if (cmd === "skills_import_current") return Promise.resolve({ snapshot_revision: 1, batch: preview });
        if (cmd === "skills_recovery_list") return Promise.resolve([]);
        if (cmd === "skills_import_commit") return new Promise((resolve) => { resolveCommit = resolve; });
        if (cmd === "skills_import_cancel") return Promise.resolve(undefined);
        return Promise.resolve(null);
      } },
      event: { listen: () => Promise.resolve(() => {}) },
    };

    render(<SkillsSection />);
    const submit = await screen.findByRole("button", { name: "导入 1 个技能" });
    await userEvent.click(submit);
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByRole("dialog", { name: "导入技能" }).getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "添加来源" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(submit);
    expect(calls.filter((cmd) => cmd === "skills_import_commit")).toHaveLength(1);
    expect(calls).not.toContain("skills_import_cancel");

    await act(async () => resolveCommit?.({
      batch_id: "batch-multi", catalog_revision: null, items: [],
      success_count: 0, failure_count: 0, skipped_count: 0,
    }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "导入技能" }).getAttribute("aria-busy")).toBe("false"));
  });

  it("技能分区展示异常事务横幅及后端允许的恢复动作", async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string) => {
          if (cmd === "skills_list") return Promise.resolve({ revision: 2, store_id: "test", skills: [] });
          if (cmd === "skills_import_current") return Promise.resolve({ snapshot_revision: 0, batch: null });
          if (cmd === "skills_recovery_list") return Promise.resolve([{
            transaction_id: "tx-settings",
            entry_path: ".skill-transactions/tx-settings.json",
            skill_name: "interrupted",
            portable_name_key: "interrupted",
            backup_available: true,
            installed_available: false,
            isolated_available: false,
            authoritative_target_missing: false,
            actions: ["restore-backup"],
            error: "cleanup interrupted",
          }]);
          return Promise.resolve(null);
        },
      },
      event: { listen: () => Promise.resolve(() => {}) },
    };

    render(<SkillsSection />);

    expect(await screen.findByRole("region", { name: "技能库需要恢复" })).toBeTruthy();
    expect(screen.getByText("interrupted")).toBeTruthy();
    expect(screen.getByRole("button", { name: "恢复原版本" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保留已安装版本" })).toBeNull();
  });

  it("current 重附着完成批次，等待 catalog revision 后展开并高亮成功技能", async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string) => {
          if (cmd === "skills_list") return Promise.resolve({
            revision: 4,
            store_id: "test",
            skills: [{ name: "imported", description: "Imported description", source: "user", content: "---", overrides: false, default_enabled: true }],
          });
          if (cmd === "skills_import_current") return Promise.resolve({
            snapshot_revision: 7,
            batch: {
              batch_id: "batch-finished",
              phase: "completed",
              snapshot_revision: 7,
              in_flight_source_picks: 0,
              catalog_revision: 4,
              sources: [],
              items: [{
                item_id: "item-imported", source_id: "source", order: 0, source_display_name: "skills.zip",
                relative_root: "imported", name: "imported", portable_name_key: "imported", description: "Imported description",
                files: [], total_size: 1, risks: [], validity: { status: "valid" }, conflict: { kind: "none" },
                duplicate_group: null, state: "succeeded", last_error: null,
              }],
              totals: { source_count: 1, item_count: 1, importable_count: 1, conflict_count: 0, risk_count: 0, invalid_count: 0 },
            },
          });
          return Promise.resolve(null);
        },
      },
      event: { listen: () => Promise.resolve(() => {}) },
    };

    render(<SkillsSection />);
    expect(await screen.findByRole("dialog", { name: "导入完成" })).toBeTruthy();
    const description = await screen.findByText("Imported description");
    await waitFor(() => expect(description.closest("li")?.className).toContain("bg-success/10"));
    const customGroup = screen.getByRole("button", { name: /自定义.*1/ });
    expect(customGroup.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => {
      const closeButtons = screen.getAllByRole("button", { name: "关闭" }) as HTMLButtonElement[];
      expect(closeButtons.at(-1)?.disabled).toBe(false);
    });
  });
});
