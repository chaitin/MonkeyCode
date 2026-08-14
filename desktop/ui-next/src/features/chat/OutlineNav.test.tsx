import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OutlineItem } from "@/lib/ipc/controls";
import { b64encode } from "@/lib/protocol/codec";
import { createChatState, reduceBatch } from "@/lib/protocol/reduce";
import type { ChatItem, ChatState, Frame } from "@/lib/protocol/types";
import { OutlineNav, outlineEntriesOf, useOutlineEntries } from "./OutlineNav";

describe("outlineEntriesOf:目录 + 流内实时合并", () => {
  it("流内带 seq 的用户消息补到目录尾部;同 seq 以目录为准去重", () => {
    const outline: OutlineItem[] = [
      // 「今天」的时刻:fmtClock 跨天带日期前缀,固定历史日期会随运行日漂移
      { seq: 1, offset: 0, text: "第一问", timestamp: new Date(new Date().setHours(9, 5, 0, 0)).getTime() },
      { seq: 5, offset: 40, text: "第二问" },
    ];
    const items: ChatItem[] = [
      { kind: "user", text: "第二问", seq: 5 }, // 目录已有,不重复
      { kind: "agent", text: "回答" },
      { kind: "user", text: "刚发的第三问", seq: 9 }, // 尚未物化,从流内补
      { kind: "user", text: "无 seq 的旧记录" }, // 无锚,进不了大纲
    ];
    const entries = outlineEntriesOf(outline, items);
    expect(entries.map((e) => [e.seq, e.label])).toEqual([
      [1, "第一问"],
      [5, "第二问"],
      [9, "刚发的第三问"],
    ]);
    // 目录条目带真实翻页 offset;流内补的还没物化,无 offset
    expect(entries.map((e) => e.offset)).toEqual([0, 40, undefined]);
    expect(entries[0]?.time).toBe("09:05");
    expect(entries[1]?.time).toBe("");
  });

  it("附件行剥离与截断:纯附件消息回退附件计数,长文截 60 字", () => {
    const entries = outlineEntriesOf(
      [
        { seq: 1, offset: 0, text: "[图片] .monkeycode/uploads/a.png\n[文件] .monkeycode/uploads/b.txt" },
        { seq: 2, offset: 0, text: `看看这个\n[图片] .monkeycode/uploads/c.png` },
        { seq: 3, offset: 0, text: "长".repeat(80) },
      ],
      [],
    );
    expect(entries[0]?.label).toBe("");
    expect(entries[0]?.attCount).toBe(2);
    expect(entries[1]?.label).toBe("看看这个");
    expect(entries[2]?.label).toBe(`${"长".repeat(60)}…`);
  });

  it("agent 流式/追加复用目录引用，只有 user 变化才重算", () => {
    const outline: OutlineItem[] = [];
    const first: ChatState = {
      ...createChatState(),
      items: [{ kind: "user", text: "第一问", seq: 1 }],
      lastSeq: 1,
    };
    const { result, rerender } = renderHook(({ state }) => useOutlineEntries(outline, state), {
      initialProps: { state: first },
    });
    const entries = result.current;
    const agentFrame: Frame = {
      type: "task-running",
      kind: "acp_event",
      data: { update: { sessionUpdate: "agent_message_chunk", content: { text: "回答" } } },
      seq: 2,
    };
    const second = reduceBatch(first, [agentFrame]);
    rerender({ state: second });
    expect(result.current).toBe(entries);

    const third = reduceBatch(second, [
      { type: "user-input", data: { content: b64encode("第二问") }, seq: 3 },
    ]);
    rerender({ state: third });
    expect(result.current).not.toBe(entries);
    expect(result.current.map((entry) => entry.label)).toEqual(["第一问", "第二问"]);
  });
});

describe("OutlineNav 交互", () => {
  const entries = outlineEntriesOf(
    [
      { seq: 1, offset: 0, text: "第一问" },
      { seq: 5, offset: 40, text: "" },
    ],
    [],
  );

  it("少于 2 条不占轨道", () => {
    render(<OutlineNav entries={entries.slice(0, 1)} onJump={() => {}} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("悬停点列浮出面板;点条目回调 seq+offset 并收起;空消息给兜底文案", () => {
    const onJump = vi.fn();
    render(<OutlineNav entries={entries} onJump={onJump} />);
    const nav = screen.getByRole("navigation", { name: "提问大纲" });
    expect(screen.queryByText("第一问")).toBeNull();
    fireEvent.mouseEnter(nav.firstElementChild!);
    expect(screen.queryByText("第一问")).toBeNull(); // 点列外的空白轨道不触发展开
    fireEvent.mouseEnter(nav.querySelector("[data-outline-rail]")!);
    expect(screen.queryByText("第一问")).toBeNull(); // 点列自身的 padding / gap 也不触发
    fireEvent.mouseEnter(nav.querySelector("[data-outline-dot]")!);
    expect(screen.getByText("第一问")).toBeTruthy();
    expect(screen.getByText("(空消息)")).toBeTruthy();
    fireEvent.click(screen.getByText("第一问"));
    expect(onJump).toHaveBeenCalledWith(1, 0); // 目录条目透传翻页 offset
    expect(screen.queryByText("第一问")).toBeNull(); // 跳转即收起
  });

  it("流内实时条目无 offset:回调 (seq, undefined),调用方走 DOM 兜底", () => {
    const onJump = vi.fn();
    const merged = outlineEntriesOf(
      [{ seq: 1, offset: 0, text: "第一问" }],
      [{ kind: "user", text: "刚发的提问", seq: 9 }],
    );
    render(<OutlineNav entries={merged} onJump={onJump} />);
    fireEvent.mouseEnter(screen.getByRole("navigation", { name: "提问大纲" }).querySelector("[data-outline-dot]")!);
    fireEvent.click(screen.getByText("刚发的提问"));
    expect(onJump).toHaveBeenCalledWith(9, undefined);
  });

  it("activeSeq 当前项:面板内该条 aria-current=true,其余不带", () => {
    render(<OutlineNav entries={entries} activeSeq={5} onJump={() => {}} />);
    fireEvent.mouseEnter(screen.getByRole("navigation", { name: "提问大纲" }).querySelector("[data-outline-dot]")!);
    expect(screen.getByText("(空消息)").closest("button")?.getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("第一问").closest("button")?.getAttribute("aria-current")).toBeNull();
  });
});

// 点列仍保留限高，极小窗口下不会溢出到 composer；长会话则只展示
// 当前轮附近的点，完整条目保留在展开面板中。
describe("长对话点列压缩", () => {
  const many = outlineEntriesOf(
    Array.from({ length: 40 }, (_, i) => ({ seq: i + 1, offset: i * 10, text: `问题 ${i + 1}` })),
    [],
  );

  it("常驻点列最多显示 12 条；无当前项时展示最新条目，展开面板仍保留全部", () => {
    const { container } = render(<OutlineNav entries={many} onJump={() => {}} />);
    const dots = [...container.querySelectorAll("[data-outline-dot]")];
    expect(dots).toHaveLength(12);
    expect(dots.map((dot) => dot.getAttribute("data-outline-dot"))).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i + 29)),
    );

    fireEvent.mouseEnter(container.querySelector("[data-outline-dot]")!);
    expect(container.querySelectorAll(".dropdown-content li")).toHaveLength(40);
  });

  it("有当前项时点列围绕当前轮截取", () => {
    const { container } = render(<OutlineNav entries={many} activeSeq={20} onJump={() => {}} />);
    const dots = [...container.querySelectorAll("[data-outline-dot]")];
    expect(dots).toHaveLength(12);
    expect(dots.some((dot) => dot.getAttribute("data-outline-dot") === "20")).toBe(true);
  });

  it("限高 + 纵滚 + 藏滚条都在点列自身,dropdown 外壳不带 overflow", () => {
    const { container } = render(<OutlineNav entries={many} onJump={() => {}} />);
    const shell = container.querySelector(".dropdown") as HTMLElement;
    const rail = shell.firstElementChild as HTMLElement;
    // 外壳一旦 overflow 非 visible 会把 position:absolute 的浮出面板一起裁掉
    expect(shell.className).not.toMatch(/overflow-/);
    expect(shell.className).not.toMatch(/max-h-/);
    expect(rail.className).toContain("overflow-y-auto");
    expect(rail.className).toContain("mc-no-scrollbar");
    // 外壳用消息区域的明确高度作为百分比限高基准，但保持 overflow visible
    expect(shell.className).toContain("h-full");
    expect(rail.className).toContain("max-h-full");
    expect(rail.className).not.toMatch(/vh/);
    fireEvent.mouseEnter(rail.querySelector("[data-outline-dot]")!);
    const panel = container.querySelector(".dropdown-content") as HTMLElement;
    expect(panel.className).toContain("max-h-full");
    expect(panel.className).not.toMatch(/vh/);
  });
});
