import { describe, expect, it } from "vitest";

import { createChatState, reduceFrame } from "./reduce";
import type { DesignTemplateSelectionItem, Frame } from "./types";

const frame = (type: string, data?: unknown): Frame => ({ type, ...(data === undefined ? {} : { data }) });
const request = frame("design-template-selection-request", {
  request_id: "design-1",
  title: "Choose",
  items: [
    { id: "clean", title: "Clean", image: "clean.png", recommended: true, reason: "Fits the brief" },
    { id: "live", title: "Live", image: "fallback.png", preview: { type: "html", path: ".monkeycode/design-template-previews/live/index.html" } },
    { id: "bad", title: "Bad", preview: { type: "video", path: "x" } },
  ],
});

const card = (state: ReturnType<typeof createChatState>) => state.items[0] as DesignTemplateSelectionItem;

describe("design template selection reducer", () => {
  it("normalizes defensively and upserts duplicate open requests", () => {
    const first = reduceFrame(createChatState(), request);
    expect(card(first)).toMatchObject({
      requestId: "design-1",
      mode: "direction",
      state: "open",
      allowedActions: { select: true, next: true, direct: true, cancel: true },
    });
    expect(card(first).items.map((item) => item.id)).toEqual(["clean", "live"]);

    const updated = reduceFrame(first, frame("design-template-selection-request", {
      ...(request.data as object), title: "Updated", actions: { select: true, next: false },
    }));
    expect(updated.items).toHaveLength(1);
    expect(card(updated)).toMatchObject({ title: "Updated", allowedActions: { select: true, next: false, direct: false, cancel: false } });
  });

  it("preserves explicit template mode", () => {
    const state = reduceFrame(createChatState(), frame("design-template-selection-request", {
      ...(request.data as object),
      mode: "template",
    }));
    expect(card(state).mode).toBe("template");
  });

  it("handles response/cancellation and never reopens terminal duplicate cards", () => {
    const open = reduceFrame(createChatState(), request);
    const responded = reduceFrame(open, frame("design-selection-respond", {
      request_id: "design-1", action: "select", selected_id: "clean", refinement_text: "More contrast",
    }));
    expect(card(responded)).toMatchObject({ state: "responded", action: "select", selectedId: "clean", refinementText: "More contrast" });
    expect(card(reduceFrame(responded, request)).state).toBe("responded");

    const cancelled = reduceFrame(open, frame("design-selection-cancelled", { request_id: "design-1", reason: "Task changed" }));
    expect(card(cancelled)).toMatchObject({ state: "cancelled", reason: "Task changed" });
  });

  it.each(["task-ended", "task-error"])("expires an open card on %s", (type) => {
    const open = reduceFrame(createChatState(), request);
    expect(card(reduceFrame(open, frame(type, type === "task-error" ? { error: "boom" } : undefined))).state).toBe("expired");
  });
});
