import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogList, type LogListHandle } from "../LogList";
import { createChatState } from "@/lib/protocol/reduce";
import type { ChatItem } from "@/lib/protocol/types";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.add(target);
  }

  unobserve(target: Element) {
    this.observed.delete(target);
  }

  disconnect() {
    this.observed.clear();
  }

  resize(target: Element, height: number) {
    this.callback(
      [{ target, contentRect: { height } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

const rect = (top: number, height: number, right = 1_000): DOMRect =>
  ({ top, bottom: top + height, left: 0, right, width: right, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

function historyItems(count: number): ChatItem[] {
  return Array.from({ length: count }, (_, index) => ({ kind: "agent" as const, text: `row ${index}` }));
}

async function mountedHarness() {
  const listRef = createRef<LogListHandle>();
  const state = { ...createChatState(), items: historyItems(300) };
  const view = render(
    <div data-chat-log="">
      <LogList ref={listRef} state={state} sessionId="height-test" />
    </div>,
  );
  act(() => expect(listRef.current?.ensureRawIndex(200)).toBe(true));
  await waitFor(() => expect(view.container.querySelector('[data-raw-index="190"]')).toBeTruthy());

  const scroller = view.container.querySelector<HTMLElement>("[data-chat-log]")!;
  const root = view.container.querySelector<HTMLElement>("[data-chat-items]")!;
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 18_600 },
  });
  scroller.scrollTop = 12_400; // 200 × agent 估高 62px
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(rect(0, 600));
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect(-12_400, 18_600));
  return { ...view, scroller };
}

function rowObserver(row: Element): FakeResizeObserver {
  const observer = FakeResizeObserver.instances.findLast((candidate) => candidate.observed.has(row));
  if (!observer) throw new Error("virtual row ResizeObserver was not installed");
  return observer;
}

describe("useTimelineWindow 动态高度锚定", () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("阅读位置上方的行增高时，同帧补偿 scrollTop", async () => {
    const { container, scroller } = await mountedHarness();
    const row = container.querySelector<HTMLElement>('[data-raw-index="190"]')!;
    act(() => rowObserver(row).resize(row, 102)); // 估高 62 → 实高 102
    expect(scroller.scrollTop).toBe(12_440);
  });

  it("拖动原生滚动条期间只记实高，不与浏览器争抢位置", async () => {
    const { container, scroller } = await mountedHarness();
    const row = container.querySelector<HTMLElement>('[data-raw-index="190"]')!;
    scroller.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 995 }));
    act(() => rowObserver(row).resize(row, 102));
    expect(scroller.scrollTop).toBe(12_400);
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
});
