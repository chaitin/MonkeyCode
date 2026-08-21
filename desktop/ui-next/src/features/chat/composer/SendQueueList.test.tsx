import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type DragEvent, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  emptySendQueueLane,
  reorderBefore,
  type SendQueueBlock,
  type SendQueueInFlight,
  type SendQueueItem,
} from "./sendQueue";
import { SEND_QUEUE_DRAG_MIME, SendQueueList } from "./SendQueueList";

const item = (id: string, content = id, attachments: string[] = []): SendQueueItem<string> => ({
  id,
  content,
  attachments,
  createdAt: 1,
});

class DragTransfer {
  private readonly values = new Map<string, string>();
  effectAllowed = "uninitialized";
  dropEffect = "none";
  files: File[] = [];

  get types() {
    return [...this.values.keys()];
  }

  get items() {
    return this.types.map((type) => ({ kind: "string", type }));
  }

  setData(type: string, value: string) {
    this.values.set(type, value);
  }

  getData(type: string) {
    return this.values.get(type) ?? "";
  }
}

const handles = () => screen.getAllByRole("button", { name: "拖动调整顺序" });

function dragBefore(from: number, beforeText: string) {
  const transfer = new DragTransfer();
  fireEvent.dragStart(handles()[from]!, { dataTransfer: transfer });
  const target = screen.getByText(beforeText).closest("li")!;
  fireEvent.dragOver(target, { dataTransfer: transfer });
  expect(target.querySelector("[data-send-queue-drop-indicator]")).not.toBeNull();
  fireEvent.drop(target, { dataTransfer: transfer });
}

function QueueHarness({ initial }: { initial: SendQueueItem<string>[] }) {
  const [pending, setPending] = useState(initial);
  return (
    <SendQueueList
      pending={pending}
      inFlight={null}
      blocked={null}
      onRemove={(id) => setPending((items) => items.filter((entry) => entry.id !== id))}
      onReorder={(id, beforeId) =>
        setPending((items) => reorderBefore({ ...emptySendQueueLane<string>(), pending: items }, id, beforeId).pending)
      }
      onResume={() => {}}
      onDiscardUncertain={() => {}}
    />
  );
}

describe("SendQueueList", () => {
  it("锁定发送中项并展示正文完整提示、待发附件数和稳定 ID 删除", () => {
    const onRemove = vi.fn();
    const inFlight: SendQueueInFlight<string> = {
      item: item("sending-id", "发送中消息", ["a"]),
      phase: "awaiting-receipt",
      startedAt: 2,
    };
    render(
      <SendQueueList
        pending={[item("stable-first", "第一条很长的待发消息", ["a", "b"]), item("stable-second", "第二条消息")]}
        inFlight={inFlight}
        blocked={null}
        onRemove={onRemove}
        onReorder={() => {}}
        onResume={() => {}}
        onDiscardUncertain={() => {}}
      />,
    );

    expect(screen.getByText("待发送 2")).toBeTruthy();
    expect(screen.getByText("每轮结束后发送一条")).toBeTruthy();
    expect(screen.getByText("发送中")).toBeTruthy();
    const lockedRow = screen.getByText("发送中消息").closest("li")!;
    expect(within(lockedRow).queryByRole("button", { name: "拖动调整顺序" })).toBeNull();
    expect(within(lockedRow).queryByRole("button", { name: "删除待发送消息" })).toBeNull();
    expect(screen.getByTitle("第一条很长的待发消息")).toBeTruthy();
    expect(screen.getByTitle("2 个附件")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "删除待发送消息" })[1]!);
    expect(onRemove).toHaveBeenCalledWith("stable-second");
  });

  it("按稳定 ID 向前和向后重排，并即时显示插入线", () => {
    render(<QueueHarness initial={[item("a", "第一条消息"), item("b", "第二条消息"), item("c", "第三条消息")]} />);

    dragBefore(2, "第一条消息");
    expect(handles().map((handle) => handle.closest("li")?.textContent)).toEqual(["1第三条消息", "2第一条消息", "3第二条消息"]);

    dragBefore(0, "第二条消息");
    expect(handles().map((handle) => handle.closest("li")?.textContent)).toEqual(["1第一条消息", "2第三条消息", "3第二条消息"]);
  });

  it("可拖到队尾，并逐项删除后保留其他项相对顺序", () => {
    render(<QueueHarness initial={[item("a", "第一条消息"), item("b", "第二条消息"), item("c", "第三条消息")]} />);
    const transfer = new DragTransfer();
    fireEvent.dragStart(handles()[0]!, { dataTransfer: transfer });
    const endZone = screen.getByRole("region", { name: "待发送消息队列" }).querySelector("li[aria-hidden]")!;
    fireEvent.dragOver(endZone, { dataTransfer: transfer });
    expect(endZone.querySelector("[data-send-queue-drop-indicator]")).not.toBeNull();
    fireEvent.drop(endZone, { dataTransfer: transfer });
    expect(handles().map((handle) => handle.closest("li")?.textContent)).toEqual(["1第二条消息", "2第三条消息", "3第一条消息"]);

    fireEvent.click(screen.getAllByRole("button", { name: "删除待发送消息" })[1]!);
    expect(handles().map((handle) => handle.closest("li")?.textContent)).toEqual(["1第二条消息", "2第一条消息"]);
  });

  it("为 blocked 与 uncertain 暴露明确且互斥的恢复动作契约", () => {
    const onResume = vi.fn();
    const onDiscard = vi.fn();
    const blocked: SendQueueBlock = { code: "send-rejected", message: "网络不可用", at: 3, itemId: "a" };
    const { rerender } = render(
      <SendQueueList
        pending={[item("a", "第一条消息")]}
        inFlight={null}
        blocked={blocked}
        onRemove={() => {}}
        onReorder={() => {}}
        onResume={onResume}
        onDiscardUncertain={onDiscard}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("网络不可用");
    fireEvent.click(screen.getByRole("button", { name: "恢复发送" }));
    expect(onResume).toHaveBeenCalledOnce();

    const uncertain: SendQueueInFlight<string> = {
      item: item("uncertain-id", "状态未知消息"),
      phase: "uncertain",
      startedAt: 4,
    };
    rerender(
      <SendQueueList
        pending={[]}
        inFlight={uncertain}
        blocked={{ code: "receipt-unknown", message: "没有收到回显", at: 5 }}
        onRemove={() => {}}
        onReorder={() => {}}
        onResume={onResume}
        onDiscardUncertain={onDiscard}
      />,
    );
    expect(screen.getByText("投递状态待确认")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "恢复发送" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    fireEvent.click(screen.getByRole("button", { name: "移除此消息" }));
    expect(onResume).toHaveBeenCalledTimes(2);
    expect(onDiscard).toHaveBeenCalledWith("uncertain-id");
  });

  it.each(["本地", "云端"])("内部排序不冒泡到%s附件拖放入口", (entry) => {
    const upload = vi.fn();
    const entered = vi.fn();
    const ParentUpload = ({ children }: { children: ReactNode }) => (
      <div
        aria-label={`${entry}附件入口`}
        onDragEnter={(event: DragEvent<HTMLDivElement>) => {
          if (![...event.dataTransfer.items].some((candidate) => candidate.kind === "file")) return;
          entered();
        }}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          const files = [...event.dataTransfer.files];
          if (files.length) upload(files);
        }}
      >
        {children}
      </div>
    );
    render(
      <ParentUpload>
        <QueueHarness initial={[item("a", "第一条消息"), item("b", "第二条消息")]} />
      </ParentUpload>,
    );
    const transfer = new DragTransfer();
    fireEvent.dragStart(handles()[1]!, { dataTransfer: transfer });
    expect(transfer.types).toContain(SEND_QUEUE_DRAG_MIME);
    const target = screen.getByText("第一条消息").closest("li")!;
    fireEvent.dragEnter(target, { dataTransfer: transfer });
    fireEvent.dragOver(target, { dataTransfer: transfer });
    fireEvent.drop(target, { dataTransfer: transfer });
    expect(entered).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});
