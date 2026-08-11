// 待办覆盖视图:收集(添加/编辑/勾选)与调度(派发/回链跳转)两条主线。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SessionMeta } from "@/lib/ipc/sessions";
import type { TodoItem } from "@/lib/ipc/todos";
import { TodoView } from "./TodoView";

const item = (over: Partial<TodoItem> = {}): TodoItem => ({
  id: over.id ?? "t1",
  content: "修登录页",
  status: "pending",
  created_at: "2026-08-11T00:00:00Z",
  updated_at: "2026-08-11T00:00:00Z",
  ...over,
});

const session = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  id: "s1",
  title: "修登录页",
  workdir: "/tmp/demo",
  model: "m",
  turns: 1,
  status: "running",
  ...over,
});

const noopOps = { add: vi.fn(), edit: vi.fn(), toggle: vi.fn(), remove: vi.fn() };

function mount(todos: TodoItem[], over: Partial<Parameters<typeof TodoView>[0]> = {}) {
  const props = {
    todos,
    sessions: [] as SessionMeta[],
    ops: { ...noopOps },
    onDispatch: vi.fn(),
    onOpenSession: vi.fn(),
    onOpenCloud: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<TodoView {...props} />);
  return props;
}

describe("待办视图", () => {
  it("空态给引导;输入 Enter 添加并清空输入框,空串不提交", async () => {
    const p = mount([]);
    expect(screen.getByText("还没有待办")).toBeTruthy();
    const input = screen.getByLabelText("添加") as HTMLInputElement;
    await userEvent.type(input, "  {Enter}"); // 全空白 = 无效
    expect(p.ops.add).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, "修登录页{Enter}");
    expect(p.ops.add).toHaveBeenCalledWith("修登录页");
    expect(input.value).toBe("");
  });

  it("未派发行:悬停派发钮带原文回调;勾选走 toggle", async () => {
    const p = mount([item()]);
    await userEvent.click(screen.getByRole("button", { name: /派发成任务/ }));
    expect(p.onDispatch).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
    await userEvent.click(screen.getByRole("checkbox"));
    expect(p.ops.toggle).toHaveBeenCalledWith("t1");
  });

  it("点正文进行内编辑:Enter 提交新正文,Esc 取消;空提交不生效", async () => {
    const p = mount([item()]);
    await userEvent.click(screen.getByRole("button", { name: "修登录页" }));
    const box = screen.getByLabelText("编辑") as HTMLInputElement;
    await userEvent.clear(box);
    await userEvent.type(box, "修注册页{Enter}");
    expect(p.ops.edit).toHaveBeenCalledWith("t1", "修注册页");
    // 再进一次编辑,Esc 取消不提交
    p.ops.edit.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "修登录页" }));
    await userEvent.keyboard("{Escape}");
    expect(p.ops.edit).not.toHaveBeenCalled();
  });

  it("已派发(本地):行尾出关联会话状态词,点击跳回;会话被删则置灰说明", async () => {
    const p = mount([item({ dispatched_kind: "local", dispatched_id: "s1" })], {
      sessions: [session()],
    });
    const link = screen.getByRole("button", { name: /运行中/ });
    expect(screen.queryByRole("button", { name: /派发成任务/ })).toBeNull(); // 派发过不再给派发钮
    await userEvent.click(link);
    expect(p.onOpenSession).toHaveBeenCalledWith("s1");

    // 关联会话不在会话表里(被删):状态词换说明并禁用
    mount([item({ id: "t2", dispatched_kind: "local", dispatched_id: "gone" })]);
    const dead = screen.getByRole("button", { name: /关联任务已被删除/ }) as HTMLButtonElement;
    expect(dead.disabled).toBe(true);
  });

  it("已派发(云端):徽标点击切到云端空间", async () => {
    const p = mount([item({ dispatched_kind: "cloud", dispatched_id: "c1" })]);
    await userEvent.click(screen.getByRole("button", { name: /云端/ }));
    expect(p.onOpenCloud).toHaveBeenCalled();
  });

  it("完成行沉底进「已完成」小节,划线降档,不给派发钮", () => {
    mount([item(), item({ id: "t2", content: "写文档", status: "done" })]);
    expect(screen.getByText("已完成 · 1")).toBeTruthy();
    const doneText = screen.getByRole("button", { name: "写文档" });
    expect(doneText.className).toContain("line-through");
    expect(screen.getAllByRole("button", { name: /派发成任务/ })).toHaveLength(1); // 只有未完成那行有
  });

  it("头部关闭钮与 Esc(非输入焦点)都走 onClose", async () => {
    const p = mount([item()]);
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
});
