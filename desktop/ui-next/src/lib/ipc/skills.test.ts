import { afterEach, describe, expect, it, vi } from "vitest";

import {
  skillsDelete,
  skillsImportCancel,
  skillsImportCommit,
  skillsImportCurrent,
  skillsImportPick,
  skillsImportReadText,
  skillsList,
  skillsRecoveryList,
  skillsRecoveryResolve,
  skillsSave,
  skillsSetDefault,
} from "./skills";

afterEach(() => vi.unstubAllGlobals());

describe("技能 catalog/mutation/import IPC 契约", () => {
  it("七个导入/恢复命令与 camelCase 参数严格透传", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    vi.stubGlobal("window", {
      __TAURI__: { core: { invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        if (cmd === "skills_import_current") return Promise.resolve({ snapshot_revision: 0, batch: null });
        if (cmd === "skills_import_pick") return Promise.resolve(null);
        if (cmd === "skills_import_read_text") return Promise.resolve({ relative_path: "a", offset: 0, text: "", next_offset: 0, eof: true });
        if (cmd === "skills_import_commit") return Promise.resolve({ batch_id: "b", catalog_revision: null, items: [], success_count: 0, failure_count: 0, skipped_count: 0 });
        if (cmd === "skills_recovery_list") return Promise.resolve([]);
        if (cmd === "skills_recovery_resolve") return Promise.resolve({ preserved_path: null, catalog_revision: 4 });
        return Promise.resolve(undefined);
      } } },
    });
    await skillsImportCurrent();
    await skillsImportPick("zips", "b");
    await skillsImportReadText({ batchId: "b", itemId: "i", relativePath: "SKILL.md", offset: 2, limit: 10 });
    await skillsImportCommit("b", [{ item_id: "i", action: "replace" }], true);
    await skillsImportCancel("b");
    await skillsRecoveryList();
    await skillsRecoveryResolve("tx", "preserve-files");
    expect(calls).toEqual([
      { cmd: "skills_import_current", args: undefined },
      { cmd: "skills_import_pick", args: { sourceKind: "zips", batchId: "b" } },
      { cmd: "skills_import_read_text", args: { batchId: "b", itemId: "i", relativePath: "SKILL.md", offset: 2, limit: 10 } },
      { cmd: "skills_import_commit", args: { batchId: "b", decisions: [{ item_id: "i", action: "replace" }], executableContentReviewed: true } },
      { cmd: "skills_import_cancel", args: { batchId: "b" } },
      { cmd: "skills_recovery_list", args: undefined },
      { cmd: "skills_recovery_resolve", args: { transactionId: "tx", action: "preserve-files" } },
    ]);
  });

  it("catalog snapshot 与三个 mutation revision 对外保留服务端字段", async () => {
    const calls: string[] = [];
    vi.stubGlobal("window", { __TAURI__: { core: { invoke: (cmd: string) => {
      calls.push(cmd);
      if (cmd === "skills_list") return Promise.resolve({ revision: 7, store_id: "store", skills: [] });
      return Promise.resolve({ catalog_revision: 8 });
    } } } });
    expect(await skillsList()).toEqual({ revision: 7, store_id: "store", skills: [] });
    expect(await skillsSave("x", "# x")).toEqual({ catalog_revision: 8 });
    expect(await skillsDelete("x")).toEqual({ catalog_revision: 8 });
    expect(await skillsSetDefault("x", true)).toEqual({ catalog_revision: 8 });
    expect(calls).toEqual(["skills_list", "skills_save", "skills_delete", "skills_set_default"]);
  });

  it("结构化错误不字符串化，原样 reject 给 UI 按 code 分流", async () => {
    const error = { code: "recovery-pending", issues: [] };
    vi.stubGlobal("window", { __TAURI__: { core: { invoke: () => Promise.reject(error) } } });
    await expect(skillsList()).rejects.toBe(error);
  });
});
