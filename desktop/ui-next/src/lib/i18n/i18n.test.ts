import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "./en";
import { zh } from "./zh";

// 模块级缓存会跨用例残留,每个用例重置模块态
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", storageStub());
  vi.stubGlobal("navigator", { language: "en-US" });
});
afterEach(() => vi.unstubAllGlobals());

function storageStub(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
  };
}

async function freshI18n() {
  return import("./index");
}

describe("词典完整性", () => {
  it("中英文词典键集合完全一致且文案非空", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      expect(en[key], `en 缺 ${key}`).toBeTruthy();
      expect(zh[key], `zh 缺 ${key}`).toBeTruthy();
    }
  });

  it("技能导入的全部显式 key 集合完整，不以每类抽样代替覆盖", () => {
    const required = [
      "settings.skills.import",
      "settings.skills.importFolders",
      "settings.skills.importFoldersHint",
      "settings.skills.importZips",
      "settings.skills.importZipsHint",
      "settings.skills.importFailed",
      "settings.skills.recovery.title",
      "settings.skills.recovery.hint",
      "settings.skills.recovery.refresh",
      "settings.skills.recovery.loading",
      "settings.skills.recovery.loadFailed",
      "settings.skills.recovery.resolveFailed",
      "settings.skills.recovery.issues",
      "settings.skills.recovery.authorityMissing",
      "settings.skills.recovery.candidates",
      "settings.skills.recovery.candidate.backup",
      "settings.skills.recovery.candidate.installed",
      "settings.skills.recovery.candidate.isolated",
      "settings.skills.recovery.available",
      "settings.skills.recovery.unavailable",
      "settings.skills.recovery.action.restore-backup",
      "settings.skills.recovery.action.keep-installed",
      "settings.skills.recovery.action.preserve-files",
      "settings.skills.recovery.resolving",
      "settings.skills.recovery.resolvingIssue",
      "settings.skills.recovery.ready",
      "settings.skills.recovery.preservedPath",
      "settings.skills.importDialog.title",
      "settings.skills.importDialog.completedTitle",
      "settings.skills.importDialog.addSource",
      "settings.skills.importDialog.close",
      "settings.skills.importDialog.summary",
      "settings.skills.importDialog.resultSummary",
      "settings.skills.importDialog.filter.all",
      "settings.skills.importDialog.filter.importable",
      "settings.skills.importDialog.filter.conflicts",
      "settings.skills.importDialog.filter.risks",
      "settings.skills.importDialog.filter.invalid",
      "settings.skills.importDialog.filters",
      "settings.skills.importDialog.filterPanel",
      "settings.skills.importDialog.selectAll",
      "settings.skills.importDialog.selectNone",
      "settings.skills.importDialog.indexing",
      "settings.skills.importDialog.sourceIssues",
      "settings.skills.importDialog.sourceEmpty",
      "settings.skills.importDialog.sourceFailed",
      "settings.skills.importDialog.validating",
      "settings.skills.importDialog.submitting",
      "settings.skills.importDialog.retrying",
      "settings.skills.importDialog.items",
      "settings.skills.importDialog.results",
      "settings.skills.importDialog.progress",
      "settings.skills.importDialog.noItems",
      "settings.skills.importDialog.selected",
      "settings.skills.importDialog.submit",
      "settings.skills.importDialog.reviewExecutable",
      "settings.skills.importDialog.operationFailed",
      "settings.skills.importDialog.refreshFailed",
      "settings.skills.importDialog.recoveryPending",
      "settings.skills.importDialog.retryRefresh",
      "settings.skills.importDialog.refreshingCatalog",
      "settings.skills.importDialog.retryFailed",
      "settings.skills.importDialog.retry",
      "settings.skills.importDialog.retryItem",
      "settings.skills.importDialog.skipped",
      "settings.skills.importDialog.status.ready",
      "settings.skills.importDialog.status.pending",
      "settings.skills.importDialog.status.invalid",
      "settings.skills.importDialog.status.failed",
      "settings.skills.importDialog.status.succeeded",
      "settings.skills.importDialog.status.skipped",
      "settings.skills.importDialog.risk.executable-content",
      "settings.skills.importDialog.risk.tools",
      "settings.skills.importDialog.risk.scripts",
      "settings.skills.importDialog.risk.hooks",
      "settings.skills.importDialog.risk.mcp",
      "settings.skills.importDialog.risk.network",
      "settings.skills.importDialog.conflict.duplicate",
      "settings.skills.importDialog.conflict.user",
      "settings.skills.importDialog.conflict.builtin",
      "settings.skills.importDialog.conflict.case",
      "settings.skills.importDialog.selectCandidate",
      "settings.skills.importDialog.selectItem",
      "settings.skills.importDialog.expandItem",
      "settings.skills.importDialog.collapseItem",
      "settings.skills.importDialog.itemDetails",
      "settings.skills.importDialog.conflictAction",
      "settings.skills.importDialog.action.skip",
      "settings.skills.importDialog.action.replace",
      "settings.skills.importDialog.action.overrideBuiltin",
      "settings.skills.importDialog.action.selectCandidate",
      "settings.skills.importDialog.action.caseDisabled",
      "settings.skills.importDialog.unnamed",
      "settings.skills.importDialog.files",
      "settings.skills.importDialog.noDescription",
      "settings.skills.importDialog.source",
      "settings.skills.importDialog.root",
      "settings.skills.importDialog.itemId",
      "settings.skills.importDialog.renameHint",
      "settings.skills.importDialog.replaceHint",
      "settings.skills.importDialog.builtinHint",
      "settings.skills.importDialog.invalidReasons",
      "settings.skills.importDialog.risks",
      "settings.skills.importDialog.executables",
      "settings.skills.importDialog.fileTree",
      "settings.skills.importDialog.filePreview",
      "settings.skills.importDialog.chooseFile",
      "settings.skills.importDialog.previewFailed",
      "settings.skills.importDialog.loading",
      "settings.skills.importDialog.loadMore",
    ] as const;
    const actual = Object.keys(zh).filter((key) =>
      key === "settings.skills.import" ||
      key.startsWith("settings.skills.importFolders") ||
      key.startsWith("settings.skills.importZips") ||
      key === "settings.skills.importFailed" ||
      key.startsWith("settings.skills.importDialog.") ||
      key.startsWith("settings.skills.recovery."),
    );
    expect(actual.sort()).toEqual([...required].sort());
    for (const key of required) {
      expect(en[key], `en 缺技能导入文案 ${key}`).toBeTruthy();
      expect(zh[key], `zh 缺技能导入文案 ${key}`).toBeTruthy();
    }
  });
});

describe("locale 解析与切换", () => {
  it("存量 mc.locale 优先;无存量按系统语言 zh* 归中文", async () => {
    vi.stubGlobal("localStorage", storageStub({ "mc.locale": "zh-CN" }));
    let i18n = await freshI18n();
    expect(i18n.getLocale()).toBe("zh-CN");

    vi.resetModules();
    vi.stubGlobal("localStorage", storageStub());
    vi.stubGlobal("navigator", { language: "zh-TW" });
    i18n = await freshI18n();
    expect(i18n.getLocale()).toBe("zh-CN");

    vi.resetModules();
    vi.stubGlobal("navigator", { language: "fr-FR" });
    i18n = await freshI18n();
    expect(i18n.getLocale()).toBe("en");
  });

  it("setLocale 即时生效、写盘并通知订阅者;存储不可写仍生效", async () => {
    const i18n = await freshI18n();
    expect(i18n.t("sidebar.newTask")).toBe("New task");
    i18n.setLocale("zh-CN");
    expect(i18n.t("sidebar.newTask")).toBe("新建任务");

    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("readonly");
      },
    });
    expect(() => i18n.setLocale("en")).not.toThrow();
    expect(i18n.t("sidebar.newTask")).toBe("New task");
  });

  it("插值替换占位符", async () => {
    const i18n = await freshI18n();
    i18n.setLocale("zh-CN");
    expect(i18n.t("main.shellInfo", { version: "1.2.3", engine: "0.9" })).toBe("壳 1.2.3 · 引擎 0.9");
  });
});
