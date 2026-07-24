import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isProjectArchived, projectArchiveKey, readArchivedProjects, updateArchivedProjects } from "./projectArchive";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("项目归档状态", () => {
  it("跨平台归一目录分隔符，但不改变真实目录", () => {
    expect(projectArchiveKey("C:\\work\\monkey\\")).toBe("C:/work/monkey");
    expect(projectArchiveKey("/workspace/monkey/")).toBe("/workspace/monkey");
  });

  it("项目归档可持久化和恢复，不借用会话归档标记", () => {
    const archived = updateArchivedProjects(new Set(), "C:\\work\\monkey\\", true);
    expect(isProjectArchived(archived, "C:/work/monkey")).toBe(true);
    expect(readArchivedProjects()).toEqual(new Set(["C:/work/monkey"]));

    const restored = updateArchivedProjects(archived, "C:/work/monkey", false);
    expect(isProjectArchived(restored, "C:\\work\\monkey")).toBe(false);
    expect(readArchivedProjects()).toEqual(new Set());
  });
});
