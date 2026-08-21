import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { QueuePanel } from "./QueuePanel";
import type { QueueItem } from "./useComposer";

const queue: QueueItem[] = [
  { id: "a", text: "第一条消息", atts: [] },
  { id: "b", text: "", atts: [{ path: "docs/a.txt", name: "a.txt", isImage: false }] },
];

beforeEach(() => setLocale("zh-CN"));

describe("QueuePanel", () => {
  it("空队列隐藏；折叠显示数量和队首摘要，并仅使用主题语义外观类", () => {
    const props = { updateQueueItem: vi.fn(), removeQueueItem: vi.fn(), moveQueueItem: vi.fn() };
    const { rerender } = render(<QueuePanel queue={[]} {...props} />);
    expect(screen.queryByRole("region", { name: "待处理消息队列" })).toBeNull();
    rerender(<QueuePanel queue={queue} {...props} />);
    const panel = screen.getByRole("region", { name: "待处理消息队列" });
    expect(panel.textContent).toContain("队列 · 2 条待处理");
    expect(panel.textContent).toContain("下一条: 第一条消息");
    expect(panel.className).toContain("bg-base-100");
    expect(panel.className).toContain("border-base-300");
  });

  it("提交中的可见队首显示 spinner 并锁定排序、编辑和删除", async () => {
    render(
      <QueuePanel
        queue={queue}
        lockedId="a"
        updateQueueItem={vi.fn()}
        removeQueueItem={vi.fn()}
        moveQueueItem={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /队列 · 2 条待处理/ }));
    expect(screen.getByLabelText("正在发送")).toBeTruthy();
    for (const name of ["将第 1 条前移", "将第 1 条后移", "编辑第 1 条", "删除第 1 条"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getByRole("button", { name: "将第 2 条前移" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("第一条消息").closest("li")?.getAttribute("draggable")).toBe("false");
  });

  it("编辑中的队首开始提交后禁用修改和保存", async () => {
    const update = vi.fn();
    const props = { queue, updateQueueItem: update, removeQueueItem: vi.fn(), moveQueueItem: vi.fn() };
    const { rerender } = render(<QueuePanel {...props} />);
    await userEvent.click(screen.getByRole("button", { name: /队列 · 2 条待处理/ }));
    await userEvent.click(screen.getByRole("button", { name: "编辑第 1 条" }));
    const input = screen.getByLabelText("编辑第 1 条消息") as HTMLTextAreaElement;
    await userEvent.clear(input);
    await userEvent.type(input, "尚未保存的新内容");

    rerender(<QueuePanel {...props} lockedId="a" />);
    expect(input.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(update).not.toHaveBeenCalled();
  });

  it("展开显示 FIFO 顺序；HTML5 拖拽按稳定 id 请求排序", async () => {
    const move = vi.fn();
    render(<QueuePanel queue={queue} updateQueueItem={vi.fn()} removeQueueItem={vi.fn()} moveQueueItem={move} />);
    await userEvent.click(screen.getByRole("button", { name: /队列 · 2 条待处理/ }));
    const panel = screen.getByRole("region", { name: "待处理消息队列" });
    const rows = within(panel).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("第一条消息"),
      expect.stringContaining("a.txt"),
    ]);
    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "none",
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
    };
    fireEvent.dragStart(rows[1]!, { dataTransfer });
    fireEvent.dragOver(rows[0]!, { dataTransfer });
    fireEvent.drop(rows[0]!, { dataTransfer });
    expect(move).toHaveBeenCalledWith("b", 0);
  });
});
