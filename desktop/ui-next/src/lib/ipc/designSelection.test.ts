// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendDesignSelection, sendDesignSelectionVia } from "./approvals";
import { designTemplatePreviewRead } from "./sessions";

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("design selection IPC", () => {
  it("uses the literal protected preview command", async () => {
    const invoke = vi.fn().mockResolvedValue("<html>preview</html>");
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
    await expect(designTemplatePreviewRead("s1", "bundle/index.html")).resolves.toBe("<html>preview</html>");
    expect(invoke).toHaveBeenCalledWith("design_template_preview_read", { id: "s1", path: "bundle/index.html" });
  });

  it("sends the response through injected and local FrameSender paths", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const response = { request_id: "d1", action: "select" as const, selected_id: "clean", refinement_text: "warmer" };
    await sendDesignSelectionVia(sender, response);
    expect(sender).toHaveBeenCalledWith("design/selection/respond", response);

    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
    await sendDesignSelection("s1", response);
    expect(invoke).toHaveBeenCalledWith("session_send", { id: "s1", ftype: "design/selection/respond", payload: response });
  });
});
