import { describe, expect, it, vi } from "vitest";
import { dispatchPreviewResultAction } from "./previewResultAction";

const actions = ["download", "send", "close"] as const;

describe("dispatchPreviewResultAction", () => {
  it.each(actions)("dispatches only the %s handler and awaits it", async (action) => {
    const handlers = {
      download: vi.fn(), send: vi.fn(), close: vi.fn(),
    };
    await dispatchPreviewResultAction(action, handlers);
    for (const candidate of actions) {
      expect(handlers[candidate]).toHaveBeenCalledTimes(candidate === action ? 1 : 0);
    }
  });
});
