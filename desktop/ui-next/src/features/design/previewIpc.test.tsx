import { afterEach, describe, expect, it, vi } from "vitest";
import { previewCreate, previewElementApply, previewSaveHtml, requestCapture } from "./previewIpc";

type Callback = (event: { payload: unknown }) => void;

function installTauri() {
  const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  const listeners = new Map<string, Callback>();
  Object.assign(window, {
    __TAURI__: {
      core: { invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => { calls.push({ cmd, args }); }) },
      event: { listen: vi.fn(async (name: string, cb: Callback) => { listeners.set(name, cb); return () => listeners.delete(name); }) },
    },
  });
  return { calls, listeners };
}

afterEach(() => { delete (window as { __TAURI__?: unknown }).__TAURI__; vi.restoreAllMocks(); });

describe("preview IPC contract", () => {
  it("uses Rust command literals and exact camelCase payloads", async () => {
    const { calls } = installTauri();
    await previewCreate("http://localhost:3000/x", { x: 1, y: 2, width: 300, height: 200 });
    await previewElementApply({ selector: "#hero", property: "fontSize", value: "20px" });
    await previewSaveHtml("sid", "site/index.html", "<html />");
    expect(calls).toEqual([
      { cmd: "preview_create", args: { url: "http://localhost:3000/x", bounds: { x: 1, y: 2, width: 300, height: 200 } } },
      { cmd: "preview_element_apply", args: { edit: { selector: "#hero", property: "fontSize", value: "20px" } } },
      { cmd: "preview_save_html", args: { sessionId: "sid", path: "site/index.html", html: "<html />" } },
    ]);
  });

  it("registers listeners before invoke and ignores stale capture request IDs", async () => {
    const { calls, listeners } = installTauri();
    const pending = requestCapture("viewport", 1000);
    await vi.waitFor(() => expect(calls[0]?.cmd).toBe("preview_capture"));
    expect(listeners.has("preview-captured")).toBe(true);
    const requestId = calls[0]!.args?.requestId as string;
    listeners.get("preview-captured")?.({ payload: { requestId: "0".repeat(32), dataUrl: "stale" } });
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    listeners.get("preview-captured")?.({ payload: { requestId, dataUrl: "data:image/png;base64,ok" } });
    await expect(pending).resolves.toMatchObject({ requestId });
  });
});
