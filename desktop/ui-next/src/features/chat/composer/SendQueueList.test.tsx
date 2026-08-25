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

  it("steering outbox 独立显示，dispatching 时禁止其他项重复插入，acked 隐藏", () => {
    const onSteer = vi.fn();
    const outbox = { item: item("a", "正在补充"), phase: "dispatching" as const, startedAt: 2, originalIndex: 0 };
    const props = {
      pending: [item("b", "后续消息")],
      inFlight: null,
      blocked: null,
      onRemove: vi.fn(),
      onReorder: vi.fn(),
      onSteer,
      onResume: vi.fn(),
      onDiscardUncertain: vi.fn(),
    };
    const { rerender } = render(<SendQueueList {...props} steering={[outbox]} />);
    const steeringRow = screen.getByText("正在补充").closest("li")!;
    expect(within(steeringRow).getByText("正在插入…")).toBeTruthy();
    expect(within(steeringRow).queryByRole("button", { name: "拖动调整顺序" })).toBeNull();
    expect((screen.getByRole("button", { name: "立即发送" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<SendQueueList {...props} steering={[{ ...outbox, phase: "acked" }]} />);
    expect(screen.queryByText("正在补充")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "立即发送" }));
    expect(onSteer).toHaveBeenCalledWith("b");
  });

  it("只有 acked/discardRequested steering 时不渲染队列空壳", () => {
    const hidden = [
      { item: item("acked", "已确认 ACK"), phase: "acked" as const, startedAt: 2, originalIndex: 0 },
      { item: item("cleared", "用户已清空"), phase: "dispatching" as const, startedAt: 3, originalIndex: 1, discardRequested: true },
    ];
    render(
      <SendQueueList
        pending={[]}
        inFlight={null}
        blocked={null}
        steering={hidden}
        onRemove={() => {}}
        onReorder={() => {}}
        onResume={() => {}}
        onDiscardUncertain={() => {}}
      />,
    );
    expect(screen.queryByRole("region", { name: "待发送消息队列" })).toBeNull();
  });

  it("uncertain steering 外显并提供独立 retry/discard", () => {
    const onRetrySteering = vi.fn();
    const onDiscardSteering = vi.fn();
    render(
      <SendQueueList
        pending={[]}
        inFlight={null}
        blocked={null}
        steering={[{ item: item("maybe", "可能已插入"), phase: "uncertain", startedAt: 2, originalIndex: 0 }]}
        onRemove={() => {}}
        onReorder={() => {}}
        onRetrySteering={onRetrySteering}
        onDiscardSteering={onDiscardSteering}
        onResume={() => {}}
        onDiscardUncertain={() => {}}
      />,
    );
    expect(screen.getByText("插入状态待确认")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    fireEvent.click(screen.getByRole("button", { name: "移除此消息" }));
    expect(onRetrySteering).toHaveBeenCalledWith("maybe");
    expect(onDiscardSteering).toHaveBeenCalledWith("maybe");
  });

  it("收到回执后隐藏已出现在时间线的发送中项", () => {
    render(
      <SendQueueList
        pending={[]}
        inFlight={{ item: item("sent", "已经发送的消息"), phase: "awaiting-turn-end", startedAt: 2 }}
        blocked={null}
        onRemove={() => {}}
        onReorder={() => {}}
        onResume={() => {}}
        onDiscardUncertain={() => {}}
      />,
    );

    expect(screen.queryByRole("region", { name: "待发送消息队列" })).toBeNull();
    expect(screen.queryByText("发送中")).toBeNull();
  });

  it("空队列取消屏障不渲染空暂停栏", () => {
    render(
      <SendQueueList
        pending={[]}
        inFlight={null}
        blocked={{ code: "user-paused", message: "Paused by user", at: 3 }}
        onRemove={() => {}}
        onReorder={() => {}}
        onResume={() => {}}
        onDiscardUncertain={() => {}}
        onClearQueue={() => {}}
      />,
    );
    expect(screen.queryByRole("region", { name: "待发送消息队列" })).toBeNull();
  });

  it("按稳定 ID 向前和向后重排，并即时显示插入线", () => {
    render(<QueueHarness initial={[item("a", "第一条消息"), item("b", "第二条消息"), item("c", "第三条消息")]} />);

    dragBefore(2, "第一条消息");
    expect(handles().map((handle) => handle.closest("li")?.textContent)).toEqual(["1第三条消息", "2第一条消息", "3第二条消息"]);

    dragBefore(0, "第二条消息");
    expect(handles().map((handle) => handle.closest("li")?.textContent)).toEqual(["1第一条消息", "2第三条消息", "3第二条消息"]);
  });

  it("拖拽把手支持 Alt+方向键重排，并消费对应键盘事件", () => {
    const onReorder = vi.fn();
    const bubbled = vi.fn();
    render(
      <div onKeyDown={bubbled}>
        <SendQueueList
          pending={[item("a", "第一条消息"), item("b", "第二条消息"), item("c", "第三条消息"), item("d", "第四条消息")]}
          inFlight={null}
          blocked={null}
          onRemove={() => {}}
          onReorder={onReorder}
          onResume={() => {}}
          onDiscardUncertain={() => {}}
        />
      </div>,
    );

    expect(handles()[1]?.getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowUp Alt+ArrowDown");
    expect(fireEvent.keyDown(handles()[1]!, { key: "ArrowUp", altKey: true })).toBe(false);
    expect(onReorder).toHaveBeenLastCalledWith("b", "a");
    expect(fireEvent.keyDown(handles()[1]!, { key: "ArrowDown", altKey: true })).toBe(false);
    expect(onReorder).toHaveBeenLastCalledWith("b", "d");
    expect(fireEvent.keyDown(handles()[2]!, { key: "ArrowDown", altKey: true })).toBe(false);
    expect(onReorder).toHaveBeenLastCalledWith("c", null);
    expect(bubbled).not.toHaveBeenCalled();
  });

  it("折叠队列的末个可见项向下移动时自动展开并保留焦点", () => {
    render(
      <QueueHarness
        initial={[item("a", "第一条消息"), item("b", "第二条消息"), item("c", "第三条消息"), item("d", "第四条消息")]}
      />,
    );
    const focused = handles()[2]!;
    focused.focus();

    fireEvent.keyDown(focused, { key: "ArrowDown", altKey: true });

    expect(handles()).toHaveLength(4);
    const moved = screen.getByText("第三条消息").closest("li")!;
    expect(within(moved).getByRole("button", { name: "拖动调整顺序" })).toBe(document.activeElement);
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

  it("超过三条默认折叠，并可展开其余项后再次收起", () => {
    render(
      <QueueHarness
        initial={[
          item("a", "第一条消息"),
          item("b", "第二条消息"),
          item("c", "第三条消息"),
          item("d", "第四条消息"),
          item("e", "第五条消息"),
        ]}
      />,
    );

    expect(screen.getByText("第三条消息")).toBeTruthy();
    expect(screen.queryByText("第四条消息")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开其余 2 条" }));
    expect(screen.getByText("第四条消息")).toBeTruthy();
    expect(screen.getByText("第五条消息")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByText("第四条消息")).toBeNull();
  });

  it("附件数可展开为文件名，图片可看大图、文件可执行打开动作", async () => {
    interface Attachment {
      name: string;
      image: boolean;
    }
    const attachments: Attachment[] = [
      { name: "设计图.png", image: true },
      { name: "需求.pdf", image: false },
    ];
    const openAttachment = vi.fn();
    render(
      <SendQueueList
        pending={[{ id: "with-atts", content: "带附件消息", attachments, createdAt: 1 }]}
        inFlight={null}
        blocked={null}
        onRemove={() => {}}
        onReorder={() => {}}
        onResume={() => {}}
        onDiscardUncertain={() => {}}
        attachmentName={(attachment) => attachment.name}
        attachmentIsImage={(attachment) => attachment.image}
        loadAttachmentUrl={() => Promise.resolve("data:image/png;base64,AAA")}
        onOpenAttachment={openAttachment}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看 2 个附件" }));
    expect(screen.getByText("需求.pdf")).toBeTruthy();
    const image = await screen.findByRole("img", { name: "设计图.png" });
    fireEvent.click(image);
    expect(screen.getByRole("dialog", { name: "设计图.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "需求.pdf" }));
    expect(openAttachment).toHaveBeenCalledWith(attachments[1]);
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

  it("用户暂停状态提供继续发送与二次确认清空", () => {
    const onResume = vi.fn();
    const onClearQueue = vi.fn();
    render(
      <SendQueueList
        pending={[item("a", "第一条消息")]}
        inFlight={null}
        blocked={{ code: "user-paused", message: "Paused by user", at: 6 }}
        onRemove={() => {}}
        onReorder={() => {}}
        onResume={onResume}
        onDiscardUncertain={() => {}}
        onClearQueue={onClearQueue}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("队列已暂停");
    expect(screen.queryByRole("button", { name: "恢复发送" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "继续发送" }));
    expect(onResume).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "清空队列" }));
    expect(onClearQueue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认清空" }));
    expect(onClearQueue).toHaveBeenCalledOnce();
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
