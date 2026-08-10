import { afterEach, describe, expect, it, vi } from "vitest";

import { repoChanges, repoFileDiff, repoListDir, repoReadFile, repoReveal } from "./repo";

afterEach(() => vi.unstubAllGlobals());

function stubInvoke(impl: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
  vi.stubGlobal("window", { __TAURI__: { core: { invoke: impl } } });
}

describe("repo_* 会话查询", () => {
  it("浏览器模式:查询类降级空值,动作类(reveal)照常抛错", async () => {
    vi.stubGlobal("window", {});
    expect(await repoListDir("s1", "")).toEqual([]);
    expect(await repoReadFile("s1", "a.txt")).toBe("");
    expect(await repoFileDiff("s1", "a.txt")).toBe("");
    expect(await repoChanges("s1")).toEqual({ changes: [], isGitRepo: false });
    await expect(repoReveal("s1", "a.txt")).rejects.toThrow();
  });

  it("经 session_call 透传:kind 与载荷形状按壳侧(repo.rs)契约", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    stubInvoke((cmd, args) => {
      calls.push({ cmd, args });
      switch (args?.kind) {
        case "repo_file_list":
          return Promise.resolve({ result: [{ name: "src", path: "src", is_dir: true, size: 0 }] });
        case "repo_read_file":
          return Promise.resolve({ result: { path: "a.txt", content: "hi" } });
        case "repo_file_diff":
          return Promise.resolve({ result: { path: "a.txt", diff: "@@ -1 +1 @@" } });
        case "repo_file_changes":
          return Promise.resolve({ result: [{ path: "a.txt", status: "M" }], is_git_repo: true });
        default:
          return Promise.resolve({ result: { ok: true } });
      }
    });

    // 线上 snake_case → UI camelCase 的归一化
    expect(await repoListDir("s1", "src/app")).toEqual([{ name: "src", path: "src", isDir: true, size: 0 }]);
    expect(await repoReadFile("s1", "a.txt")).toBe("hi");
    expect(await repoFileDiff("s1", "a.txt")).toBe("@@ -1 +1 @@");
    expect(await repoChanges("s1")).toEqual({ changes: [{ path: "a.txt", status: "M" }], isGitRepo: true });
    await repoReveal("s1", "b/c.txt");

    expect(calls.every((c) => c.cmd === "session_call")).toBe(true);
    expect(calls.every((c) => c.args?.id === "s1")).toBe(true);
    expect(calls.map((c) => [c.args?.kind, c.args?.payload])).toEqual([
      ["repo_file_list", { path: "src/app" }],
      ["repo_read_file", { path: "a.txt" }],
      ["repo_file_diff", { path: "a.txt" }],
      ["repo_file_changes", {}],
      ["repo_reveal", { path: "b/c.txt" }],
    ]);
  });

  it("{error} 应答成为异常;非 git 工作区 is_git_repo=false 原样传递", async () => {
    stubInvoke((_cmd, args) => {
      if (args?.kind === "repo_file_changes") return Promise.resolve({ result: [], is_git_repo: false });
      return Promise.resolve({ error: "读取目录失败: no such dir" });
    });
    await expect(repoListDir("s1", "gone")).rejects.toThrow("读取目录失败: no such dir");
    await expect(repoReadFile("s1", "gone")).rejects.toThrow();
    expect(await repoChanges("s1")).toEqual({ changes: [], isGitRepo: false });
  });

  it("命令层 reject(会话不存在/15s 超时)原样上抛", async () => {
    stubInvoke(() => Promise.reject(new Error("repo 查询超时(15s)")));
    await expect(repoFileDiff("s1", "a.txt")).rejects.toThrow("repo 查询超时(15s)");
  });
});
