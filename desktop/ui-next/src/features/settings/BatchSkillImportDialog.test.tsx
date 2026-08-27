import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SkillImportController } from "./useSkillImportController";
import { operationsForSkillImport } from "./useSkillImportController";
import { BatchSkillImportDialog } from "./BatchSkillImportDialog";
import { RecoveryPanel } from "./RecoveryPanel";
import { resetEscLayersForTest } from "@/lib/util/escLayer";
import type { SkillImportBatchPreview, SkillImportItem } from "@/lib/ipc/skills";

function item(overrides: Partial<SkillImportItem> & Pick<SkillImportItem, "item_id" | "order" | "name">): SkillImportItem {
  const { item_id, order, name, ...rest } = overrides;
  return {
    item_id,
    source_id: "source-1",
    order,
    source_display_name: "skills.zip",
    relative_root: name ?? "bad",
    name,
    portable_name_key: name?.toLowerCase() ?? null,
    description: `${name ?? "bad"} description`,
    files: [],
    total_size: 12,
    risks: [],
    validity: { status: "valid" },
    conflict: { kind: "none" },
    duplicate_group: null,
    state: "pending",
    last_error: null,
    ...rest,
  };
}

function batch(items: SkillImportItem[], overrides: Partial<SkillImportBatchPreview> = {}): SkillImportBatchPreview {
  return {
    batch_id: "batch-1",
    phase: "collecting",
    snapshot_revision: 2,
    in_flight_source_picks: 0,
    catalog_revision: null,
    sources: [{ source_id: "source-1", order: 0, kind: "zips", display_name: "skills.zip", status: "ready", skill_count: items.length, error: null }],
    items,
    totals: {
      source_count: 1,
      item_count: items.length,
      importable_count: items.filter((entry) => entry.validity.status === "valid" && entry.conflict.kind === "none").length,
      conflict_count: items.filter((entry) => entry.conflict.kind !== "none").length,
      risk_count: items.filter((entry) => entry.risks.length > 0).length,
      invalid_count: items.filter((entry) => entry.validity.status === "invalid").length,
    },
    ...overrides,
  };
}

function controller(currentBatch: SkillImportBatchPreview, overrides: Partial<SkillImportController> = {}): SkillImportController {
  return {
    batch: currentBatch,
    snapshotRevision: currentBatch.snapshot_revision,
    operation: null,
    error: null,
    operations: operationsForSkillImport(currentBatch),
    refresh: vi.fn().mockResolvedValue(undefined),
    pick: vi.fn().mockResolvedValue(currentBatch),
    commit: vi.fn().mockResolvedValue({ batch_id: currentBatch.batch_id, catalog_revision: 2, items: [], success_count: 0, failure_count: 0, skipped_count: 0 }),
    cancel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => {
  resetEscLayersForTest();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("BatchSkillImportDialog", () => {
  it("最高层来源菜单先消费 Escape，第二次 Escape 才取消未提交批次", async () => {
    const user = userEvent.setup();
    const current = controller(batch([item({ item_id: "a", order: 0, name: "a" })]));
    render(<BatchSkillImportDialog controller={current} refreshSkillsCatalog={vi.fn()} onImported={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "添加来源" });
    expect(document.activeElement).toBe(trigger);
    await user.keyboard("{Enter}");
    const menu = screen.getByRole("menu", { name: "添加来源" });
    expect(trigger.getAttribute("aria-controls")).toBe(menu.id);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "添加来源" })).toBeNull();
    expect(current.cancel).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(current.cancel).toHaveBeenCalledTimes(1);
    expect(current.commit).not.toHaveBeenCalled();
  });

  it("以 tab/tabpanel、列表和原生选择控件提供语义，并可按可见焦点顺序纯键盘提交", async () => {
    const user = userEvent.setup();
    const current = controller(batch([item({ item_id: "a", order: 0, name: "a" })]));
    render(<BatchSkillImportDialog controller={current} refreshSkillsCatalog={vi.fn()} onImported={vi.fn()} />);

    const allTab = screen.getByRole("tab", { name: "全部 1", selected: true });
    const panel = screen.getByRole("tabpanel", { name: "全部 1" });
    expect(allTab.getAttribute("aria-controls")).toBe(panel.id);
    expect(within(panel).getByRole("list", { name: "待导入技能" })).toBeTruthy();

    await user.tab(); // close
    await user.tab(); // selected filter tab (roving tabindex)
    expect(document.activeElement).toBe(allTab);
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "无效 0", selected: true })).toBe(document.activeElement);
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "全部 1", selected: true })).toBe(document.activeElement);
    await user.tab(); // select all
    await user.tab(); // clear selection
    await user.keyboard("{Enter}");
    await user.tab(); // item checkbox
    const choice = screen.getByRole("checkbox", { name: "选择技能 a" });
    expect(document.activeElement).toBe(choice);
    await user.keyboard(" ");
    expect((choice as HTMLInputElement).checked).toBe(true);
    await user.tab(); // expand
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "收起 a 的详情" })).toBeTruthy();
    await user.tab(); // cancel
    await user.tab(); // submit
    const submit = screen.getByRole("button", { name: "导入 1 个技能" });
    expect(document.activeElement).toBe(submit);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "添加来源" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(submit);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(current.commit).toHaveBeenCalledWith([{ item_id: "a", action: "install" }], false));
  });

  it("支持追加来源、摘要筛选、默认选择、重名单选、冲突动作和稳定全量决策", async () => {
    const entries = [
      item({ item_id: "normal", order: 0, name: "normal", risks: [{ kind: "executable-content", paths: ["run.sh"] }] }),
      item({ item_id: "user", order: 1, name: "user", conflict: { kind: "user-skill", existing_name: "user" } }),
      item({ item_id: "builtin", order: 2, name: "builtin", conflict: { kind: "builtin-skill", existing_name: "builtin" } }),
      item({ item_id: "dup-a", order: 3, name: "dup", conflict: { kind: "batch-duplicate", catalog_conflict: { kind: "none" } }, duplicate_group: "dup" }),
      item({ item_id: "dup-b", order: 4, name: "DUP", portable_name_key: "dup", conflict: { kind: "batch-duplicate", catalog_conflict: { kind: "none" } }, duplicate_group: "dup" }),
      item({ item_id: "case", order: 5, name: "CASE", conflict: { kind: "user-name-case", existing_name: "case" } }),
      item({ item_id: "invalid", order: 6, name: null, portable_name_key: null, validity: { status: "invalid", reasons: ["名称无效"] } }),
    ];
    const current = controller(batch(entries));
    render(<BatchSkillImportDialog controller={current} refreshSkillsCatalog={vi.fn()} onImported={vi.fn()} />);

    expect(await screen.findByText(/1 个来源 · 7 个技能/)).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "选择技能 normal" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "选择技能 user" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: "选择候选 dup" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "选择候选 DUP" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: /选择技能 invalid/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: "选择技能 CASE" }) as HTMLInputElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole("tab", { name: /^风险 1$/ }));
    expect(screen.getByRole("checkbox", { name: "选择技能 normal" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "选择技能 user" })).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: /^全部 7$/ }));

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "user 的冲突动作" }), "replace");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "builtin 的冲突动作" }), "install");
    await userEvent.click(screen.getByRole("radio", { name: "选择候选 DUP" }));
    expect((screen.getByRole("radio", { name: "选择候选 dup" }) as HTMLInputElement).checked).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "添加来源" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /选择 ZIP/ }));
    expect(current.pick).toHaveBeenCalledWith("zips");

    const submit = screen.getByRole("button", { name: "导入 4 个技能" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("checkbox", { name: /我已检查/ }));
    await userEvent.click(submit);
    await waitFor(() => expect(current.commit).toHaveBeenCalledTimes(1));
    expect(current.commit).toHaveBeenCalledWith([
      { item_id: "normal", action: "install" },
      { item_id: "user", action: "replace" },
      { item_id: "builtin", action: "install" },
      { item_id: "dup-a", action: "skip" },
      { item_id: "dup-b", action: "install" },
      { item_id: "case", action: "skip" },
      { item_id: "invalid", action: "skip" },
    ], true);
  });

  it("批次重名同时保留 user/builtin 动作，大小写变体仍禁用", async () => {
    const entries = [
      item({ item_id: "user-a", order: 0, name: "user-dup", conflict: { kind: "batch-duplicate", catalog_conflict: { kind: "user-skill", existing_name: "user-dup" } }, duplicate_group: "user-dup" }),
      item({ item_id: "user-b", order: 1, name: "user-dup", portable_name_key: "user-dup", conflict: { kind: "batch-duplicate", catalog_conflict: { kind: "user-skill", existing_name: "user-dup" } }, duplicate_group: "user-dup" }),
      item({ item_id: "builtin-a", order: 2, name: "builtin-dup", conflict: { kind: "batch-duplicate", catalog_conflict: { kind: "builtin-skill", existing_name: "builtin-dup" } }, duplicate_group: "builtin-dup" }),
      item({ item_id: "builtin-b", order: 3, name: "builtin-dup", portable_name_key: "builtin-dup", conflict: { kind: "batch-duplicate", catalog_conflict: { kind: "builtin-skill", existing_name: "builtin-dup" } }, duplicate_group: "builtin-dup" }),
      item({ item_id: "case-a", order: 4, name: "case-dup", conflict: { kind: "batch-duplicate", catalog_conflict: { kind: "user-name-case", existing_name: "Case-Dup" } }, duplicate_group: "case-dup" }),
      item({ item_id: "case-b", order: 5, name: "case-dup", portable_name_key: "case-dup", conflict: { kind: "batch-duplicate", catalog_conflict: { kind: "user-name-case", existing_name: "Case-Dup" } }, duplicate_group: "case-dup" }),
    ];
    const current = controller(batch(entries));
    render(<BatchSkillImportDialog controller={current} refreshSkillsCatalog={vi.fn()} onImported={vi.fn()} />);

    const userCandidates = screen.getAllByRole("radio", { name: "选择候选 user-dup" }) as HTMLInputElement[];
    const builtinCandidates = screen.getAllByRole("radio", { name: "选择候选 builtin-dup" }) as HTMLInputElement[];
    const caseCandidates = screen.getAllByRole("radio", { name: "选择候选 case-dup" }) as HTMLInputElement[];
    expect(userCandidates[0]!.checked).toBe(true);
    expect(builtinCandidates[0]!.checked).toBe(true);
    expect(caseCandidates.every((candidate) => candidate.disabled)).toBe(true);

    await userEvent.click(userCandidates[1]!);
    await userEvent.click(builtinCandidates[1]!);
    await userEvent.click(screen.getByRole("button", { name: "导入 2 个技能" }));
    await waitFor(() => expect(current.commit).toHaveBeenCalledWith([
      { item_id: "user-a", action: "skip" },
      { item_id: "user-b", action: "replace" },
      { item_id: "builtin-a", action: "skip" },
      { item_id: "builtin-b", action: "install" },
      { item_id: "case-a", action: "skip" },
      { item_id: "case-b", action: "skip" },
    ], false));
  });

  it("取消全选与全选可导入项只改变无冲突有效项，不越过冲突/重名/无效约束", async () => {
    const entries = [
      item({ item_id: "plain", order: 0, name: "plain" }),
      item({ item_id: "user", order: 1, name: "user", conflict: { kind: "user-skill", existing_name: "user" } }),
      item({ item_id: "dup-a", order: 2, name: "dup", conflict: { kind: "batch-duplicate", catalog_conflict: { kind: "none" } }, duplicate_group: "dup" }),
      item({ item_id: "dup-b", order: 3, name: "DUP", portable_name_key: "dup", conflict: { kind: "batch-duplicate", catalog_conflict: { kind: "none" } }, duplicate_group: "dup" }),
      item({ item_id: "invalid", order: 4, name: null, portable_name_key: null, validity: { status: "invalid", reasons: ["bad"] } }),
    ];
    render(<BatchSkillImportDialog controller={controller(batch(entries))} refreshSkillsCatalog={vi.fn()} onImported={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "取消全选" }));
    expect((screen.getByRole("checkbox", { name: "选择技能 plain" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: "选择候选 dup" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: "选择候选 DUP" }) as HTMLInputElement).checked).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "全选可导入项" }));
    expect((screen.getByRole("checkbox", { name: "选择技能 plain" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "选择技能 user" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: "选择候选 dup" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: "选择候选 DUP" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: /选择技能 invalid/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("已选择 1 个")).toBeTruthy();
  });

  it("冲突动作获得键盘焦点后可用方向键改为替换，并显示替换行为提示", async () => {
    const user = userEvent.setup();
    const conflict = item({
      item_id: "replace-me",
      order: 0,
      name: "replace-me",
      conflict: { kind: "user-skill", existing_name: "replace-me" },
    });
    const current = controller(batch([conflict]));
    render(<BatchSkillImportDialog controller={current} refreshSkillsCatalog={vi.fn()} onImported={vi.fn()} />);

    const select = screen.getByRole("combobox", { name: "replace-me 的冲突动作" }) as HTMLSelectElement;
    select.focus();
    expect(document.activeElement).toBe(select);
    await user.keyboard("{ArrowDown}");
    expect(select.value).toBe("replace");
    expect((screen.getByRole("checkbox", { name: "选择技能 replace-me" }) as HTMLInputElement).checked).toBe(true);

    const expand = screen.getByRole("button", { name: "展开 replace-me 的详情" });
    expand.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText(/现有技能 replace-me 将被完整替换/)).toBeTruthy();
    const submit = screen.getByRole("button", { name: "导入 1 个技能" });
    submit.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(current.commit).toHaveBeenCalledWith([{ item_id: "replace-me", action: "replace" }], false));
  });

  it.each(["validating", "retry-validating", "submitting", "retrying"] as const)("%s 阶段锁定关闭、Escape、追加和决策", async (phase) => {
    const activeBatch = batch([item({ item_id: "a", order: 0, name: "a" })], { phase, snapshot_revision: 3 });
    const current = controller(activeBatch);
    render(<BatchSkillImportDialog controller={current} refreshSkillsCatalog={vi.fn()} onImported={vi.fn()} />);

    const close = screen.getByRole("button", { name: "关闭" });
    expect((close as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "添加来源" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard("{Escape}");
    fireEvent.click(document.querySelector(".modal-backdrop")!);
    expect(current.cancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "导入技能" })).toBeTruthy();
  });

  it("提交按钮因 phase 切换卸载时焦点转入进度容器，modal 内已有用户焦点则不抢", () => {
    const collectingBatch = batch([item({ item_id: "a", order: 0, name: "a" })]);
    const { rerender } = render(
      <BatchSkillImportDialog controller={controller(collectingBatch)} refreshSkillsCatalog={vi.fn()} onImported={vi.fn()} />,
    );

    const allTab = screen.getByRole("tab", { name: "全部 1" });
    allTab.focus();
    const lockedCollecting = controller(collectingBatch, { operation: "committing" });
    rerender(<BatchSkillImportDialog controller={lockedCollecting} refreshSkillsCatalog={vi.fn()} onImported={vi.fn()} />);
    expect(document.activeElement).toBe(allTab);

    const unlocked = controller(collectingBatch);
    rerender(<BatchSkillImportDialog controller={unlocked} refreshSkillsCatalog={vi.fn()} onImported={vi.fn()} />);
    const submit = screen.getByRole("button", { name: "导入 1 个技能" });
    submit.focus();
    expect(document.activeElement).toBe(submit);

    const submittingBatch = batch(collectingBatch.items, { phase: "submitting", snapshot_revision: 3 });
    rerender(<BatchSkillImportDialog controller={controller(submittingBatch)} refreshSkillsCatalog={vi.fn()} onImported={vi.fn()} />);
    const progress = screen.getByRole("status", { name: "技能导入进度" });
    expect(document.activeElement).toBe(progress);
    expect(screen.getByRole("dialog", { name: "导入技能" }).contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("RecoveryPending 时内嵌恢复面板，全部权威缺失解决并重试刷新后才允许关闭", async () => {
    const completed = batch([
      item({ item_id: "ok", order: 0, name: "ok", state: "succeeded" }),
    ], { phase: "completed", snapshot_revision: 8, catalog_revision: 9 });
    const issue = {
      transaction_id: "tx-dialog",
      entry_path: ".skill-transactions/tx-dialog.json",
      skill_name: "missing",
      portable_name_key: "missing",
      backup_available: true,
      installed_available: false,
      isolated_available: false,
      authoritative_target_missing: true,
      actions: ["restore-backup" as const],
      error: "target missing",
    };
    let listCount = 0;
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string) => {
          if (cmd === "skills_recovery_list") {
            listCount += 1;
            return Promise.resolve(listCount === 1 ? [issue] : []);
          }
          if (cmd === "skills_recovery_resolve") {
            return Promise.resolve({ preserved_path: null, catalog_revision: 10 });
          }
          return Promise.resolve(null);
        },
      },
    };
    const recoveryError = { code: "recovery-pending" as const, issues: [issue] };
    const refresh = vi.fn()
      .mockRejectedValueOnce(recoveryError)
      .mockResolvedValue({ revision: 10, store_id: "test", skills: [] });
    const current = controller(completed);

    render(
      <BatchSkillImportDialog
        controller={current}
        refreshSkillsCatalog={refresh}
        onImported={vi.fn()}
        recoverySlot={<RecoveryPanel initialIssues={[issue]} refreshSkillsCatalog={refresh} />}
      />,
    );

    expect(await screen.findByText("missing")).toBeTruthy();
    const footerClose = () => screen.getAllByRole("button", { name: "关闭" }).at(-1) as HTMLButtonElement;
    expect(footerClose().disabled).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(current.cancel).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "恢复原版本" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith(10));
    expect(footerClose().disabled).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "重试刷新" }));
    await waitFor(() => expect(footerClose().disabled).toBe(false));
    expect(refresh.mock.calls).toEqual([[9], [10], [9]]);
  });

  it("展示累计结果、只提交 failed 项重试，并在 catalog target revision 可见前禁止关闭", async () => {
    const completed = batch([
      item({ item_id: "ok", order: 0, name: "ok", state: "succeeded" }),
      item({ item_id: "bad", order: 1, name: "bad", state: "failed", last_error: "磁盘空间不足" }),
      item({ item_id: "skip", order: 2, name: "skip", state: "skipped" }),
    ], { phase: "completed", snapshot_revision: 8, catalog_revision: 9 });
    const current = controller(completed);
    let resolveRefresh!: (value: { revision: number; store_id: string; skills: [] }) => void;
    const refresh = vi.fn(() => new Promise<{ revision: number; store_id: string; skills: [] }>((resolve) => { resolveRefresh = resolve; }));
    const imported = vi.fn();
    render(<BatchSkillImportDialog controller={current} refreshSkillsCatalog={refresh} onImported={imported} />);

    expect(await screen.findByText("成功 1 · 失败 1 · 跳过 1")).toBeTruthy();
    expect(screen.getByText("磁盘空间不足")).toBeTruthy();
    expect(refresh).toHaveBeenCalledWith(9);
    const footerClose = () => screen.getAllByRole("button", { name: "关闭" }).at(-1) as HTMLButtonElement;
    expect(footerClose().disabled).toBe(true);

    resolveRefresh({ revision: 9, store_id: "test", skills: [] });
    await waitFor(() => expect(imported).toHaveBeenCalledWith(["ok"]));
    expect(footerClose().disabled).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "重试失败项 (1)" }));
    await waitFor(() => expect(current.commit).toHaveBeenCalledWith([{ item_id: "bad", action: "install" }], false));
    expect(within(screen.getByRole("list", { name: "技能导入结果" })).getAllByRole("listitem")).toHaveLength(3);
  });
});
