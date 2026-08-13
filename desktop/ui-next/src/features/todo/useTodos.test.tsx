// 待办域编排:图片附件的上传/挂载/清理链路(列表变更本体已由侧栏待办组
// 测试从 ops 面覆盖,这里钉 useTodos 与壳命令面的对账)。
// 文件后缀 .tsx:dom project 才收(renderHook 要 DOM 环境)。
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TodoItem } from "@/lib/ipc/todos";
import { useTodos } from "./useTodos";

/** 壳桩(NewTaskModal.test 同款):按命令名分发并留痕。 */
function stubShell(overrides: Record<string, (args?: Record<string, unknown>) => Promise<unknown>> = {}) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        const over = overrides[cmd];
        if (over) return over(args);
        if (cmd === "todos_load") return Promise.resolve([]);
        if (cmd === "todo_upload_begin") return Promise.resolve({ handle: 7 });
        if (cmd === "upload_finish") return Promise.resolve({ path: "shot.png" });
        return Promise.resolve(null);
      },
    },
  };
  return calls;
}

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

const lastSavedItems = (calls: Array<{ cmd: string; args?: Record<string, unknown> }>) =>
  calls.filter((c) => c.cmd === "todos_save").at(-1)?.args?.items as TodoItem[] | undefined;

describe("useTodos 图片编排", () => {
  it("add 带图:分块上传落盘后把文件名挂上条目并再次全量落盘", async () => {
    const calls = stubShell();
    const { result } = renderHook(() => useTodos(vi.fn()));
    // 先让挂载期 todosLoad 落定(App 在启动时就挂了这只钩子,视图交互远在
    // 其后):不等的话回包 setTodos 会冲掉下面的乐观添加,测的就不是真时序
    await act(async () => {});
    const shot = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    act(() => result.current.add("修图", [shot]));
    await waitFor(() => expect(lastSavedItems(calls)?.[0]?.images).toEqual(["shot.png"]));
    // 内容通道 = todo_upload_begin 开档 + 共用的 chunk/finish 收尾
    const cmds = calls.map((c) => c.cmd);
    expect(cmds).toContain("todo_upload_begin");
    expect(cmds).toContain("upload_finish");
  });

  it("上传失败走 upload 类别外显,条目保留无图", async () => {
    const onError = vi.fn();
    const calls = stubShell({ todo_upload_begin: () => Promise.reject(new Error("磁盘满")) });
    const { result } = renderHook(() => useTodos(onError));
    await act(async () => {}); // 同上:先让挂载期加载落定
    act(() => result.current.add("修图", [new File([new Uint8Array([1])], "x.png", { type: "image/png" })]));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("upload", "磁盘满"));
    expect(lastSavedItems(calls)?.[0]?.images).toBeUndefined();
  });

  it("reorder:挪到目标之前并全量落盘;不动 updated_at,原位落点不写盘", async () => {
    const stored = ["t1", "t2", "t3"].map((id) => ({
      id,
      content: id,
      status: "pending",
      created_at: "2026-08-13T00:00:00Z",
      updated_at: "2026-08-13T00:00:00Z",
    })) as TodoItem[];
    const calls = stubShell({ todos_load: () => Promise.resolve(stored) });
    const { result } = renderHook(() => useTodos(vi.fn()));
    await waitFor(() => expect(result.current.todos).toHaveLength(3));

    act(() => result.current.reorder("t3", "t1"));
    const saved = lastSavedItems(calls);
    expect(saved?.map((i) => i.id)).toEqual(["t3", "t1", "t2"]);
    // 排序是清单的事,不是条目变更:updated_at 原样
    expect(saved?.every((i) => i.updated_at === "2026-08-13T00:00:00Z")).toBe(true);

    const savesBefore = calls.filter((c) => c.cmd === "todos_save").length;
    act(() => result.current.reorder("t3", "t1")); // 已在 t1 之前 = 原位
    expect(calls.filter((c) => c.cmd === "todos_save").length).toBe(savesBefore);
  });

  it("removeImage 摘名并清文件;remove 连带清理条目全部图片", async () => {
    const stored: TodoItem = {
      id: "t1",
      content: "修图",
      status: "pending",
      images: ["a.png", "b.png"],
      created_at: "2026-08-11T00:00:00Z",
      updated_at: "2026-08-11T00:00:00Z",
    };
    const calls = stubShell({ todos_load: () => Promise.resolve([stored]) });
    const { result } = renderHook(() => useTodos(vi.fn()));
    await waitFor(() => expect(result.current.todos).toHaveLength(1));

    act(() => result.current.removeImage("t1", "a.png"));
    expect(lastSavedItems(calls)?.[0]?.images).toEqual(["b.png"]);
    await waitFor(() =>
      expect(calls.some((c) => c.cmd === "todo_upload_delete" && c.args?.path === "a.png")).toBe(true),
    );

    act(() => result.current.remove("t1"));
    expect(lastSavedItems(calls)).toEqual([]);
    await waitFor(() =>
      expect(calls.some((c) => c.cmd === "todo_upload_delete" && c.args?.path === "b.png")).toBe(true),
    );
  });
});
