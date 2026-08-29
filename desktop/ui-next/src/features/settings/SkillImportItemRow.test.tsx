import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SkillImportItem, SkillImportTextChunk } from "@/lib/ipc/skills";
import { SkillImportItemRow } from "./SkillImportItemRow";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const ITEM: SkillImportItem = {
  item_id: "item-1",
  source_id: "source-1",
  order: 0,
  source_display_name: "bundle.zip",
  relative_root: "wrapper/source-dir",
  name: "renamed-skill",
  portable_name_key: "renamed-skill",
  description: "A complete skill description",
  files: [{
    relative_path: "scripts",
    name: "scripts",
    kind: "directory",
    size: 0,
    executable: false,
    children: [{ relative_path: "scripts/run.sh", name: "run.sh", kind: "file", size: 12, executable: true, children: [] }],
  }, { relative_path: "SKILL.md", name: "SKILL.md", kind: "file", size: 70_000, executable: false, children: [] }],
  total_size: 70_012,
  risks: [
    { kind: "executable-content", paths: ["scripts/run.sh"] },
    { kind: "network", paths: ["SKILL.md"] },
    { kind: "mcp", paths: ["SKILL.md"] },
  ],
  validity: { status: "valid" },
  conflict: { kind: "user-skill", existing_name: "renamed-skill" },
  duplicate_group: null,
  state: "failed",
  last_error: "previous failure",
};

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("SkillImportItemRow", () => {
  it("提供 checkbox、展开区和文件树语义，并可按焦点顺序纯键盘展开", async () => {
    const user = userEvent.setup();
    render(<ul><SkillImportItemRow batchId="batch-1" item={ITEM} action="replace" disabled={false} onActionChange={() => {}} /></ul>);

    const choice = screen.getByRole("checkbox", { name: "选择技能 renamed-skill" });
    expect(choice.getAttribute("aria-describedby")).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(choice);
    await user.tab();

    const toggle = screen.getByRole("button", { name: "展开 renamed-skill 的详情", expanded: false });
    expect(document.activeElement).toBe(toggle);
    const detailsId = toggle.getAttribute("aria-controls")!;
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "收起 renamed-skill 的详情" }).id).toBe(detailsId);
    expect(screen.getByRole("tree", { name: "技能文件树" })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: "scripts", expanded: true })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /SKILL.md/, selected: false })).toBeTruthy();
  });

  it("展示契约详情、改名/替换提示、文件树、能力风险并分页读取 UTF-8", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          calls.push({ cmd, args });
          if (cmd === "skills_import_read_text") {
            const offset = args?.offset as number;
            return Promise.resolve(offset === 0
              ? { relative_path: "SKILL.md", offset: 0, text: "第一", next_offset: 6, eof: false }
              : { relative_path: "SKILL.md", offset: 6, text: "第二", next_offset: 12, eof: true });
          }
          return Promise.resolve(null);
        },
      },
    };

    render(<ul><SkillImportItemRow batchId="batch-1" item={ITEM} action="replace" disabled={false} onActionChange={() => {}} /></ul>);
    await userEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText("A complete skill description")).toBeTruthy();
    expect(screen.getByText("bundle.zip")).toBeTruthy();
    expect(screen.getByText("wrapper/source-dir")).toBeTruthy();
    expect(screen.getByText("item-1")).toBeTruthy();
    expect(screen.getByText(/安装到目录 renamed-skill/)).toBeTruthy();
    expect(screen.getByText(/将被完整替换/)).toBeTruthy();
    expect(screen.getByText("previous failure")).toBeTruthy();
    expect(screen.getAllByText(/scripts\/run.sh/)).toHaveLength(2);
    expect(screen.getByText("网络")).toBeTruthy();
    expect(screen.getByText("MCP")).toBeTruthy();

    await userEvent.click(screen.getByRole("treeitem", { name: /SKILL.md/ }));
    await screen.findByText("第一");
    expect(calls).toContainEqual({
      cmd: "skills_import_read_text",
      args: { batchId: "batch-1", itemId: "item-1", relativePath: "SKILL.md", offset: 0, limit: 65_536 },
    });
    await userEvent.click(screen.getByRole("button", { name: "加载下一页" }));
    await waitFor(() => expect(screen.getByText("第一第二")).toBeTruthy());
    expect(calls.at(-1)?.args?.offset).toBe(6);
    expect(screen.queryByRole("button", { name: "加载下一页" })).toBeNull();
  });

  it("A 切到 B 且 B 先返回时只展示 B 的最新读取结果", async () => {
    const reads = new Map<string, Deferred<SkillImportTextChunk>>([
      ["scripts/run.sh", deferred<SkillImportTextChunk>()],
      ["SKILL.md", deferred<SkillImportTextChunk>()],
    ]);
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (_cmd: string, args?: Record<string, unknown>) => reads.get(String(args?.relativePath))!.promise,
      },
    };

    render(<ul><SkillImportItemRow batchId="batch-1" item={ITEM} action="replace" disabled={false} onActionChange={() => {}} /></ul>);
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    await userEvent.click(screen.getByRole("treeitem", { name: /run.sh/ }));
    await userEvent.click(screen.getByRole("treeitem", { name: /SKILL.md/ }));

    await act(async () => {
      reads.get("SKILL.md")!.resolve({ relative_path: "SKILL.md", offset: 0, text: "B 最新内容", next_offset: 12, eof: true });
      await reads.get("SKILL.md")!.promise;
    });
    expect(screen.getByText("B 最新内容")).toBeTruthy();

    await act(async () => {
      reads.get("scripts/run.sh")!.resolve({ relative_path: "scripts/run.sh", offset: 0, text: "A 迟到内容", next_offset: 20, eof: false });
      await reads.get("scripts/run.sh")!.promise;
    });
    expect(screen.getByText("B 最新内容")).toBeTruthy();
    expect(screen.queryByText("A 迟到内容")).toBeNull();
    expect(screen.queryByRole("button", { name: "加载下一页" })).toBeNull();
  });

  it("组件卸载后忽略迟到的读取失败", async () => {
    const lateRead = deferred<SkillImportTextChunk>();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: () => lateRead.promise },
    };

    const view = render(<ul><SkillImportItemRow batchId="batch-1" item={ITEM} action="replace" disabled={false} onActionChange={() => {}} /></ul>);
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    await userEvent.click(screen.getByRole("treeitem", { name: /SKILL.md/ }));
    view.unmount();

    await act(async () => {
      lateRead.reject(new Error("卸载后的迟到错误"));
      await lateRead.promise.catch(() => undefined);
    });
    expect(screen.queryByText(/卸载后的迟到错误/)).toBeNull();
  });

  it("翻页读取与切换文件交错时不把旧页追加到新文件", async () => {
    const appendRead = deferred<SkillImportTextChunk>();
    const nextFileRead = deferred<SkillImportTextChunk>();
    const calls: Array<Record<string, unknown> | undefined> = [];
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (_cmd: string, args?: Record<string, unknown>) => {
          calls.push(args);
          if (args?.relativePath === "scripts/run.sh" && args.offset === 0) {
            return Promise.resolve({ relative_path: "scripts/run.sh", offset: 0, text: "A 第一页", next_offset: 9, eof: false });
          }
          if (args?.relativePath === "scripts/run.sh") return appendRead.promise;
          return nextFileRead.promise;
        },
      },
    };

    render(<ul><SkillImportItemRow batchId="batch-1" item={ITEM} action="replace" disabled={false} onActionChange={() => {}} /></ul>);
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    await userEvent.click(screen.getByRole("treeitem", { name: /run.sh/ }));
    await screen.findByText("A 第一页");
    await userEvent.click(screen.getByRole("button", { name: "加载下一页" }));
    expect(calls.at(-1)?.offset).toBe(9);

    await userEvent.click(screen.getByRole("treeitem", { name: /SKILL.md/ }));
    expect(screen.queryByText("A 第一页")).toBeNull();

    await act(async () => {
      appendRead.resolve({ relative_path: "scripts/run.sh", offset: 9, text: "A 迟到追加", next_offset: 21, eof: true });
      await appendRead.promise;
    });
    expect(screen.queryByText(/A (第一页|迟到追加)/)).toBeNull();
    expect((screen.getByRole("button", { name: "读取中…" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      nextFileRead.resolve({ relative_path: "SKILL.md", offset: 0, text: "B 第一页", next_offset: 10, eof: true });
      await nextFileRead.promise;
    });
    expect(screen.getByText("B 第一页")).toBeTruthy();
    expect(screen.queryByText(/A (第一页|迟到追加)/)).toBeNull();
    expect(screen.queryByRole("button", { name: "加载下一页" })).toBeNull();
  });

  it("重名候选按 nested catalog 冲突产出 replace/install，nested 大小写冲突禁用", async () => {
    const onUserAction = vi.fn();
    const userDuplicate: SkillImportItem = {
      ...ITEM,
      item_id: "user-duplicate",
      state: "pending",
      last_error: null,
      conflict: {
        kind: "batch-duplicate",
        catalog_conflict: { kind: "user-skill", existing_name: "renamed-skill" },
      },
      duplicate_group: "renamed-skill",
    };
    const view = render(<ul><SkillImportItemRow batchId="batch-1" item={userDuplicate} action="skip" disabled={false} onActionChange={onUserAction} /></ul>);
    await userEvent.click(screen.getByRole("radio", { name: "选择候选 renamed-skill" }));
    expect(onUserAction).toHaveBeenCalledWith("replace");

    view.rerender(<ul><SkillImportItemRow batchId="batch-1" item={{
      ...userDuplicate,
      item_id: "builtin-duplicate",
      conflict: { kind: "batch-duplicate", catalog_conflict: { kind: "builtin-skill", existing_name: "renamed-skill" } },
    }} action="skip" disabled={false} onActionChange={onUserAction} /></ul>);
    await userEvent.click(screen.getByRole("radio", { name: "选择候选 renamed-skill" }));
    expect(onUserAction).toHaveBeenLastCalledWith("install");

    view.rerender(<ul><SkillImportItemRow batchId="batch-1" item={{
      ...userDuplicate,
      item_id: "case-duplicate",
      conflict: { kind: "batch-duplicate", catalog_conflict: { kind: "builtin-name-case", existing_name: "Renamed-Skill" } },
    }} action="skip" disabled={false} onActionChange={onUserAction} /></ul>);
    expect((screen.getByRole("radio", { name: "选择候选 renamed-skill" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("无效项和大小写冲突不可选择并展示原因", async () => {
    const invalid: SkillImportItem = {
      ...ITEM,
      item_id: "invalid",
      name: null,
      portable_name_key: null,
      validity: { status: "invalid", reasons: ["frontmatter name 非法", "SKILL.md 超限"] },
      conflict: { kind: "builtin-name-case", existing_name: "Existing" },
      state: "pending",
      last_error: null,
    };
    render(<ul><SkillImportItemRow batchId="batch-1" item={invalid} action="skip" disabled={false} onActionChange={() => {}} /></ul>);
    expect((screen.getByRole("checkbox", { name: /选择技能 invalid/ }) as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("frontmatter name 非法")).toBeTruthy();
    expect(screen.getByText("SKILL.md 超限")).toBeTruthy();
    expect(screen.getAllByText(/Existing.*大小写冲突/).length).toBeGreaterThan(0);
  });
});
