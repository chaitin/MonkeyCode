import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerCtl } from "@/features/chat/composer/useComposer";
import { setLocale } from "@/lib/i18n";
import { DesignPreviewWorkbench } from "./DesignPreviewWorkbench";

type EventCb = (event: { payload: unknown }) => void;
let calls: { cmd: string; args?: Record<string, unknown> }[];
let events: Map<string, EventCb>;
let pendingCreates: (() => void)[];
let pendingDestroys: (() => void)[];
let pendingPickerToggles: (() => void)[];
let pendingSaves: (() => void)[];
let deferCreates: boolean;
let deferDestroys: boolean;
let deferPickerToggles: boolean;
let deferSaves: boolean;
let deferCaptures: boolean;
let captureError: string | null;
let applyFailureProperty: string | null;

beforeEach(() => {
  setLocale("en");
  calls = []; events = new Map(); pendingCreates = []; pendingDestroys = []; pendingPickerToggles = []; pendingSaves = []; deferCreates = false; deferDestroys = false; deferPickerToggles = false; deferSaves = false; deferCaptures = false; captureError = null; applyFailureProperty = null;
  vi.mocked(composer.sendWithFiles).mockReset().mockResolvedValue(true);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 400, y: 80, left: 400, top: 80, right: 1000, bottom: 480, width: 600, height: 400, toJSON() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
    core: { invoke: async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      if (cmd === "preview_element_apply" && (args?.edit as { property?: string } | undefined)?.property === applyFailureProperty) throw new Error("invalid style");
      if ((cmd === "preview_create" || cmd === "preview_create_artifact") && deferCreates) await new Promise<void>((resolve) => pendingCreates.push(resolve));
      if (cmd === "preview_destroy" && deferDestroys) await new Promise<void>((resolve) => pendingDestroys.push(resolve));
      if (cmd === "preview_picker_toggle" && deferPickerToggles) await new Promise<void>((resolve) => pendingPickerToggles.push(resolve));
      if (cmd === "preview_save_html" && deferSaves) await new Promise<void>((resolve) => pendingSaves.push(resolve));
      if (cmd === "preview_serialize") queueMicrotask(() => events.get("preview-serialized")?.({ payload: { requestId: args?.requestId, html: "<html>serialized</html>" } }));
      if (cmd === "preview_capture" && !deferCaptures) queueMicrotask(() => captureError
        ? events.get("preview-capture-error")?.({ payload: { requestId: args?.requestId, error: captureError } })
        : events.get("preview-captured")?.({ payload: { requestId: args?.requestId, dataUrl: "data:image/png;base64,AQID" } }));
      if (cmd === "session_call" && args?.kind === "repo_artifact_read") {
        const path = (args.payload as { path?: string } | undefined)?.path ?? "";
        if (path.endsWith(".png")) return { result: { path, kind: "image", mime: "image/png", data_url: "data:image/png;base64,AQID" } };
        if (path.endsWith(".txt")) return { result: { path, kind: "text", mime: "text/plain", content: "preview text content" } };
        return { result: { path, kind: "html", mime: "text/html", content: `<html>${path}</html>` } };
      }
      if (cmd === "session_call" && args?.kind === "repo_preview_files") return { result: { files: [
        { path: "pages/home.html", kind: "html", mime: "text/html", size: 10 },
        { path: "images/hero.png", kind: "image", mime: "image/png", size: 20 },
        { path: "notes/readme.txt", kind: "text", mime: "text/plain", size: 30 },
      ], truncated: false } };
    } },
    event: { listen: async (name: string, cb: EventCb) => { events.set(name, cb); return () => events.delete(name); } },
  };
});

afterEach(() => { delete (window as unknown as { __TAURI__?: unknown }).__TAURI__; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const composer = { sendWithFiles: vi.fn(async () => true) } as unknown as ComposerCtl;

function mount(obscured = false) {
  return render(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "localhost", url: "http://localhost:5173/app" }} composer={composer} obscured={obscured} />);
}

function mountArtifact(path = "pages/home.html") {
  return render(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "artifact", path, artifactKind: "html" }} composer={composer} obscured={false} />);
}

async function waitPreviewReady() {
  await waitFor(() => expect(calls.some((c) => c.cmd === "preview_set_zoom")).toBe(true));
}

describe("DesignPreviewWorkbench native lifecycle", () => {
  it("follows the configured locale for toolbar labels", async () => {
    setLocale("zh-CN");
    mount();

    expect(screen.getByRole("tab", { name: "预览" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /代码/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "注释" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "截图" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "标记" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy();
    expect(screen.getByLabelText("缩放")).toBeTruthy();

    act(() => setLocale("en"));
    expect(await screen.findByRole("tab", { name: "Preview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mark/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Annotate/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Edit/ })).toBeTruthy();
  });

  // 四个动作两两相似,标签分不出差别;提示必须说清「去哪儿」——截图只进剪贴板、
  // 编辑只改预览,是最容易被误解也最容易在改文案时丢掉的两条。
  it("gives each toolbar action a tooltip that states where its result goes", async () => {
    setLocale("zh-CN");
    mount();

    expect(screen.getByRole("button", { name: "截图" }).getAttribute("title")).toContain("不发进对话");
    expect(screen.getByRole("button", { name: "注释" }).getAttribute("title")).toContain("发进对话");
    expect(screen.getByRole("button", { name: "标记" }).getAttribute("title")).toContain("发进对话");
    expect(screen.getByRole("button", { name: "编辑" }).getAttribute("title")).toContain("不写回源码");

    act(() => setLocale("en"));
    expect((await screen.findByRole("button", { name: /Edit/ })).getAttribute("title")).toContain("preview only");
  });

  it("creates with measured bounds, hides under an obscurer, restores and destroys", async () => {
    const view = mount();
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create")).toBe(true));
    expect(calls.find((c) => c.cmd === "preview_create")?.args?.bounds).toEqual({ x: 400, y: 80, width: 600, height: 400 });
    view.rerender(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "localhost", url: "http://localhost:5173/app" }} composer={composer} obscured />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_hide")).toBe(true));
    view.rerender(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "localhost", url: "http://localhost:5173/app" }} composer={composer} obscured={false} />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_show")).toBe(true));
    view.unmount();
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_destroy")).toBe(true));
  });

  it("hides the native preview while the workspace file menu is open", async () => {
    mount();
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create")).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Choose workspace preview file" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_hide")).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Choose workspace preview file" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_show")).toBe(true));
  });

  it("external obscurers freeze a screenshot in place before hiding, and clear it on restore", async () => {
    const view = mount();
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create")).toBe(true));

    view.rerender(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "localhost", url: "http://localhost:5173/app" }} composer={composer} obscured />);
    // 先截帧(浮层期间预览"不消失"),再隐藏原生 webview
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_capture")).toBe(true));
    expect(calls.find((c) => c.cmd === "preview_capture")?.args?.mode).toBe("viewport-no-copy");
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_hide")).toBe(true));
    await waitFor(() =>
      expect(document.querySelector("[data-preview-host] img")?.getAttribute("src")).toBe("data:image/png;base64,AQID"),
    );

    view.rerender(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "localhost", url: "http://localhost:5173/app" }} composer={composer} obscured={false} />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_show")).toBe(true));
    // show 落地后冻结帧才撤,避免露白
    await waitFor(() => expect(document.querySelector("[data-preview-host] img")).toBeNull());
  });

  it("falls back to a textual hint when the freeze capture fails, and still hides", async () => {
    captureError = "capture failed";
    const view = mount();
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create")).toBe(true));

    view.rerender(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "localhost", url: "http://localhost:5173/app" }} composer={composer} obscured />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_hide")).toBe(true));
    expect(screen.getByText(/menu or dialog/)).toBeTruthy();
    expect(document.querySelector("[data-preview-host] img")).toBeNull();
  });

  it("tracks pure translations of the host (pane swaps) and re-sends bounds", async () => {
    mount();
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create")).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_set_bounds")).toBe(true));

    // 同尺寸纯位移:ResizeObserver 不响,rAF 逐帧比对必须补发新矩形
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ x: 40, y: 80, left: 40, top: 80, right: 640, bottom: 480, width: 600, height: 400, toJSON() {} } as DOMRect);
    await waitFor(() =>
      expect(
        calls.some((c) => c.cmd === "preview_set_bounds" && (c.args?.bounds as { x: number } | undefined)?.x === 40),
      ).toBe(true),
    );
  });

  it("does not let the StrictMode cleanup destroy the active preview", async () => {
    deferCreates = true;
    render(<StrictMode><DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "localhost", url: "http://localhost:5173/app" }} composer={composer} obscured={false} /></StrictMode>);
    await waitFor(() => expect(pendingCreates).toHaveLength(1));

    await act(async () => {
      pendingCreates.shift()?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(pendingCreates).toHaveLength(1));
    await act(async () => {
      pendingCreates.shift()?.();
      await Promise.resolve();
    });

    expect(calls.filter((c) => c.cmd === "preview_create")).toHaveLength(2);
    expect(calls.filter((c) => c.cmd === "preview_destroy")).toHaveLength(1);
    expect(calls.at(-1)?.cmd).not.toBe("preview_destroy");
    expect(calls.some((c) => c.cmd === "preview_set_bounds")).toBe(true);
  });

  it("serializes lifecycle operations across workbench instances", async () => {
    deferCreates = true;
    const first = mountArtifact("pages/first.html");
    await waitFor(() => expect(pendingCreates).toHaveLength(1));

    first.unmount();
    const second = mountArtifact("pages/second.html");
    expect(pendingCreates).toHaveLength(1);
    await act(async () => {
      pendingCreates.shift()?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(pendingCreates).toHaveLength(1));

    const lifecycle = calls
      .filter((c) => c.cmd === "preview_create_artifact" || c.cmd === "preview_destroy")
      .map((c) => c.cmd === "preview_destroy" ? c.cmd : `${c.cmd}:${c.args?.path}`);
    expect(lifecycle).toEqual([
      "preview_create_artifact:pages/first.html",
      "preview_destroy",
      "preview_create_artifact:pages/second.html",
    ]);
    await act(async () => {
      pendingCreates.shift()?.();
      await Promise.resolve();
    });
    deferCreates = false;
    second.unmount();
  });

  it("waits for non-preview cleanup before creating the next artifact", async () => {
    deferDestroys = true;
    const view = render(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "artifact", path: "images/hero.png", artifactKind: "image" }} composer={composer} obscured={false} />);
    await waitFor(() => expect(pendingDestroys).toHaveLength(1));

    view.rerender(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "artifact", path: "pages/home.html", artifactKind: "html" }} composer={composer} obscured={false} />);
    expect(calls.some((c) => c.cmd === "preview_create_artifact")).toBe(false);
    await act(async () => {
      pendingDestroys.shift()?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create_artifact")).toBe(true));
    deferDestroys = false;
    view.unmount();
  });

  it("switches from localhost to the native artifact preview", async () => {
    mount();
    await waitFor(() => expect(calls.some((call) => call.cmd === "preview_create")).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Choose workspace preview file" }));
    await userEvent.click(await screen.findByRole("button", { name: "pages/home.html" }));

    await waitFor(() => expect(calls.some((call) => call.cmd === "preview_create_artifact" && call.args?.id === "s1" && call.args?.path === "pages/home.html")).toBe(true));
    expect(screen.queryByTitle("Preview pages/home.html")).toBeNull();
  });

  it("preserves zoom when the native preview is recreated", async () => {
    mount();
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create")).toBe(true));
    await userEvent.selectOptions(screen.getByLabelText("Zoom"), "125");
    await waitFor(() => expect(calls).toContainEqual({ cmd: "preview_set_zoom", args: { scale: 1.25 } }));

    calls = [];
    await userEvent.click(screen.getByRole("button", { name: "Choose workspace preview file" }));
    await userEvent.click(await screen.findByRole("button", { name: "pages/home.html" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create_artifact")).toBe(true));
    await waitFor(() => expect(calls).toContainEqual({ cmd: "preview_set_zoom", args: { scale: 1.25 } }));
  });

  it("switches artifact when initialTarget changes in the same session", async () => {
    const view = render(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "artifact", path: "pages/first.html", artifactKind: "html" }} composer={composer} obscured={false} />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create_artifact" && c.args?.path === "pages/first.html")).toBe(true));
    view.rerender(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "artifact", path: "pages/second.html", artifactKind: "html" }} composer={composer} obscured={false} />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create_artifact" && c.args?.path === "pages/second.html")).toBe(true));
  });

  it("reloads an unchanged artifact when a completed turn refreshes it", async () => {
    const target = { kind: "artifact", path: "index.html", artifactKind: "html" } as const;
    const view = render(<DesignPreviewWorkbench sessionId="s1" initialTarget={target} refreshKey={0} composer={composer} obscured={false} />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create_artifact" && c.args?.path === "index.html")).toBe(true));

    view.rerender(<DesignPreviewWorkbench sessionId="s1" initialTarget={target} refreshKey={1} composer={composer} obscured={false} />);

    await waitFor(() => expect(calls.filter((c) => c.cmd === "preview_reload")).toHaveLength(1));
    expect(calls.filter((c) => c.cmd === "preview_create_artifact")).toHaveLength(1);
  });

  it("reloads an artifact already selected inside the workbench", async () => {
    const view = render(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "artifact", path: "pages/first.html", artifactKind: "html" }} refreshKey={0} composer={composer} obscured={false} />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create_artifact" && c.args?.path === "pages/first.html")).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Choose workspace preview file" }));
    await userEvent.click(await screen.findByRole("button", { name: "pages/home.html" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create_artifact" && c.args?.path === "pages/home.html")).toBe(true));
    calls = [];

    const target = { kind: "artifact", path: "pages/home.html", artifactKind: "html" } as const;
    view.rerender(<DesignPreviewWorkbench sessionId="s1" initialTarget={target} refreshKey={1} composer={composer} obscured={false} />);

    await waitFor(() => expect(calls.filter((c) => c.cmd === "preview_reload")).toHaveLength(1));
    expect(calls.some((c) => c.cmd === "preview_create_artifact")).toBe(false);
  });

  it("does not reload non-native artifacts", async () => {
    const target = { kind: "artifact", path: "images/hero.png", artifactKind: "image" } as const;
    const view = render(<DesignPreviewWorkbench sessionId="s1" initialTarget={target} refreshKey={0} composer={composer} obscured={false} />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "session_call" && c.args?.kind === "repo_artifact_read")).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_destroy")).toBe(true));
    calls = [];

    view.rerender(<DesignPreviewWorkbench sessionId="s1" initialTarget={target} refreshKey={1} composer={composer} obscured={false} />);
    await act(async () => { await Promise.resolve(); });

    expect(calls.some((c) => c.cmd === "preview_reload")).toBe(false);
  });

  it("serializes rapid artifact preview switches", async () => {
    deferCreates = true;
    const view = render(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "artifact", path: "pages/first.html", artifactKind: "html" }} composer={composer} obscured={false} />);
    await waitFor(() => expect(pendingCreates).toHaveLength(1));

    view.rerender(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "artifact", path: "pages/second.html", artifactKind: "html" }} composer={composer} obscured={false} />);
    await act(async () => {
      pendingCreates.shift()?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(pendingCreates).toHaveLength(1));
    await act(async () => {
      pendingCreates.shift()?.();
      await Promise.resolve();
    });

    const paths = calls.filter((c) => c.cmd === "preview_create_artifact").map((c) => c.args?.path);
    expect(paths).toEqual(["pages/first.html", "pages/second.html"]);
    expect(calls.at(-1)?.cmd).not.toBe("preview_destroy");
  });

  it("renders workspace HTML without reading it through IPC", async () => {
    render(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "artifact", path: "pages/home.html", artifactKind: "html" }} composer={composer} obscured={false} />);

    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create_artifact" && c.args?.id === "s1" && c.args?.path === "pages/home.html")).toBe(true));
    expect(calls.some((c) => c.cmd === "session_call" && c.args?.kind === "repo_artifact_read")).toBe(false);
  });

  it("browses, searches and renders HTML, image and text workspace artifacts", async () => {
    mount();

    const choose = async (query: string, path: string) => {
      await userEvent.click(screen.getByRole("button", { name: "Choose workspace preview file" }));
      const search = await screen.findByLabelText("Search preview files");
      await userEvent.clear(search);
      await userEvent.type(search, query);
      await userEvent.click(await screen.findByRole("button", { name: path }));
    };

    await choose("home", "pages/home.html");
    await waitFor(() => expect(calls.some((call) => call.cmd === "preview_create_artifact" && call.args?.path === "pages/home.html")).toBe(true));

    await choose("hero", "images/hero.png");
    expect((await screen.findByRole("img", { name: "images/hero.png" })).getAttribute("src")).toBe("data:image/png;base64,AQID");

    await choose("readme", "notes/readme.txt");
    expect(await screen.findByText("preview text content")).toBeTruthy();
    const readPaths = calls
      .filter((call) => call.cmd === "session_call" && call.args?.kind === "repo_artifact_read")
      .map((call) => (call.args?.payload as { path?: string }).path);
    expect(readPaths).toEqual(["images/hero.png", "notes/readme.txt"]);
  });

  it("serializes before editing and saves project-relative HTML through the backend", async () => {
    mount();
    await userEvent.click(screen.getByRole("tab", { name: /Code/ }));
    const editor = await screen.findByDisplayValue("<html>serialized</html>");
    expect(editor.getAttribute("wrap")).toBe("off");
    expect(editor.className).toContain("size-full");
    await userEvent.clear(screen.getByLabelText("Project-relative HTML path"));
    await userEvent.type(screen.getByLabelText("Project-relative HTML path"), "pages/home.html");
    await userEvent.click(screen.getByRole("button", { name: "Save HTML" }));
    await waitFor(() => expect(calls).toContainEqual({ cmd: "preview_save_html", args: { sessionId: "s1", path: "pages/home.html", html: "<html>serialized</html>" } }));
    expect(calls.some((call) => call.cmd === "preview_reload")).toBe(true);
  });

  it("defaults saves to the current HTML artifact path", async () => {
    mountArtifact("pages/home.html");
    await userEvent.click(screen.getByRole("tab", { name: /Code/ }));
    await screen.findByDisplayValue("<html>serialized</html>");

    expect((screen.getByLabelText("Project-relative HTML path") as HTMLInputElement).value).toBe("pages/home.html");
    await userEvent.click(screen.getByRole("button", { name: "Save HTML" }));

    await waitFor(() => expect(calls).toContainEqual({ cmd: "preview_save_html", args: { sessionId: "s1", path: "pages/home.html", html: "<html>serialized</html>" } }));
    expect(calls.some((call) => call.cmd === "preview_reload")).toBe(true);
  });

  it("does not reload a different preview after a delayed save", async () => {
    const view = mountArtifact("pages/home.html");
    await userEvent.click(screen.getByRole("tab", { name: /Code/ }));
    await screen.findByDisplayValue("<html>serialized</html>");
    deferSaves = true;
    await userEvent.click(screen.getByRole("button", { name: "Save HTML" }));
    await waitFor(() => expect(pendingSaves).toHaveLength(1));

    view.rerender(<DesignPreviewWorkbench sessionId="s1" initialTarget={{ kind: "artifact", path: "images/hero.png", artifactKind: "image" }} composer={composer} obscured={false} />);
    expect(await screen.findByRole("img", { name: "images/hero.png" })).toBeTruthy();
    const reloadsBeforeSaveCompletes = calls.filter((call) => call.cmd === "preview_reload").length;
    await act(async () => { pendingSaves.shift()?.(); await Promise.resolve(); });
    deferSaves = false;

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Saved pages/home.html"));
    expect(calls.filter((call) => call.cmd === "preview_reload")).toHaveLength(reloadsBeforeSaveCompletes);
  });

  it("finds HTML source with Ctrl+F and cycles through matches", async () => {
    mount();
    await userEvent.click(screen.getByRole("tab", { name: /Code/ }));
    const editor = await screen.findByLabelText("HTML source") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "<main>item</main>\n<footer>item</footer>" } });

    fireEvent.keyDown(editor, { key: "f", ctrlKey: true });
    const findInput = await screen.findByLabelText("Find in HTML");
    await waitFor(() => expect(document.activeElement).toBe(findInput));
    await userEvent.type(findInput, "item");
    await waitFor(() => expect(editor.selectionStart).toBe(6));
    expect(screen.getByText("1 / 2")).toBeTruthy();

    fireEvent.keyDown(findInput, { key: "Enter" });
    expect(editor.selectionStart).toBe(26);
    expect(screen.getByText("2 / 2")).toBeTruthy();

    fireEvent.change(editor, { target: { value: "x<main>item</main>\n<footer>item</footer>" } });
    await waitFor(() => expect(editor.selectionStart).toBe(7));
    expect(screen.getByText("1 / 2")).toBeTruthy();

    fireEvent.keyDown(findInput, { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(editor));
  });

  it("preserves source offsets for case-insensitive Unicode search", async () => {
    mount();
    await userEvent.click(screen.getByRole("tab", { name: /Code/ }));
    const editor = await screen.findByLabelText("HTML source") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "<p>İX</p>" } });

    fireEvent.keyDown(editor, { key: "f", ctrlKey: true });
    const findInput = await screen.findByLabelText("Find in HTML");
    await userEvent.type(findInput, "x");

    await waitFor(() => expect(editor.selectionStart).toBe(4));
    expect(editor.selectionEnd).toBe(5);
    expect(screen.getByText("1 / 1")).toBeTruthy();
  });

  it("drives every preview toolbar control through its backend command", async () => {
    mount();
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create")).toBe(true));
    await waitFor(() => expect(calls).toContainEqual({ cmd: "preview_set_zoom", args: { scale: 1 } }));

    await userEvent.click(screen.getByRole("button", { name: "Tablet" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_set_bounds")).toBe(true));

    await userEvent.selectOptions(screen.getByLabelText("Zoom"), "125");
    expect(calls).toContainEqual({ cmd: "preview_set_zoom", args: { scale: 1.25 } });

    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(calls).toContainEqual({ cmd: "preview_picker_toggle", args: { enabled: true } }));
    expect((await screen.findByRole("status")).textContent).toContain("Select an element to edit.");

    await userEvent.click(screen.getByTitle("Reload"));
    expect(calls.some((c) => c.cmd === "preview_reload")).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /Mark/ }));
    expect(await screen.findByRole("img", { name: "Captured preview" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close capture" }));

    await userEvent.click(screen.getByRole("button", { name: "Screenshot" }));
    await waitFor(() => expect(calls.filter((c) => c.cmd === "preview_capture" && c.args?.mode === "viewport")).toHaveLength(2));
    expect(screen.getByRole("status").textContent).toContain("Screenshot copied to clipboard.");
    expect(screen.queryByRole("img", { name: "Captured preview" })).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: /Code/ }));
    expect(await screen.findByLabelText("HTML source")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_show")).toBe(true));
  });

  it("does not show picker as active when the preview is not ready", async () => {
    deferCreates = true;
    mount();
    await waitFor(() => expect(pendingCreates).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));

    expect(screen.getByRole("status").textContent).toContain("Preview is still loading.");
    expect(calls.some((c) => c.cmd === "preview_picker_toggle")).toBe(false);
    expect(screen.getByRole("button", { name: /Edit/ }).className).not.toContain("btn-primary");
    await act(async () => {
      pendingCreates.shift()?.();
      await Promise.resolve();
    });
    deferCreates = false;
  });

  it("serializes rapid picker toggles in click order", async () => {
    deferPickerToggles = true;
    mount();
    await waitPreviewReady();
    const button = screen.getByRole("button", { name: /Edit/ });

    await userEvent.click(button);
    await userEvent.click(button);

    expect(button.className).not.toContain("btn-primary");
    expect(calls.filter((c) => c.cmd === "preview_picker_toggle")).toEqual([
      { cmd: "preview_picker_toggle", args: { enabled: true } },
    ]);
    await act(async () => { pendingPickerToggles.shift()?.(); await Promise.resolve(); });
    await waitFor(() => expect(calls.filter((c) => c.cmd === "preview_picker_toggle")).toEqual([
      { cmd: "preview_picker_toggle", args: { enabled: true } },
      { cmd: "preview_picker_toggle", args: { enabled: false } },
    ]));
    await act(async () => { pendingPickerToggles.shift()?.(); await Promise.resolve(); });
  });

  it("keeps the selected element usable when its background capture fails", async () => {
    captureError = "snapshot failed";
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: { selector: "#hero", text: "Hello", tag: "DIV", bounds: { x: 0, y: 0, width: 10, height: 10 }, styles: {} } }));

    const panel = await screen.findByRole("dialog", { name: "Selected element" });
    expect(within(panel).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(panel.parentElement?.querySelector("img")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("snapshot failed");
  });

  it("drops an element result captured before localhost navigation", async () => {
    deferCaptures = true;
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: { selector: "#old", text: "Old", tag: "DIV", bounds: { x: 0, y: 0, width: 10, height: 10 }, styles: {} } }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_capture")).toBe(true));
    const captureCall = calls.filter((c) => c.cmd === "preview_capture").at(-1);

    const address = screen.getByLabelText("Preview address");
    await userEvent.clear(address);
    await userEvent.type(address, "http://localhost:5173/new");
    await userEvent.click(screen.getByTitle("Navigate"));
    act(() => events.get("preview-captured")?.({ payload: { requestId: captureCall?.args?.requestId, dataUrl: "data:image/png;base64,AQID" } }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Selected element" })).toBeNull());
  });

  it("ignores an old element capture after reopening the picker", async () => {
    deferCaptures = true;
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Annotate/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: { tag: "A", selector: "nav > a", text: "Docs", bounds: { x: 10, y: 20, width: 120, height: 32 }, styles: {} } }));
    await waitFor(() => expect(calls.some((call) => call.cmd === "preview_capture")).toBe(true));
    const captureCall = calls.filter((call) => call.cmd === "preview_capture").at(-1);

    await userEvent.click(screen.getByRole("button", { name: /Annotate/ }));
    act(() => events.get("preview-captured")?.({ payload: { requestId: captureCall?.args?.requestId, dataUrl: "data:image/png;base64,AQID" } }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Selected element" })).toBeNull());
  });

  it("keeps the selected page visible behind the comment panel", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Annotate/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: { tag: "A", selector: "nav > a", text: "Docs", bounds: { x: 10, y: 20, width: 120, height: 32 }, styles: {} } }));

    const panel = await screen.findByRole("dialog", { name: "Selected element" });
    expect(panel.parentElement?.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AQID");
    expect(calls).toContainEqual(expect.objectContaining({ cmd: "preview_capture", args: expect.objectContaining({ mode: "viewport-no-copy" }) }));
    await waitFor(() => expect(calls.some((call) => call.cmd === "preview_hide")).toBe(true));
  });

  it("sends a comment for the selected element", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Annotate/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: { tag: "A", selector: "nav > a", text: "Docs", bounds: { x: 10, y: 20, width: 120, height: 32 }, styles: {} } }));

    await userEvent.type(await screen.findByLabelText("Comment"), "Make this link clearer");
    await userEvent.click(screen.getByRole("button", { name: "Send comment" }));

    await waitFor(() => expect(composer.sendWithFiles).toHaveBeenCalledTimes(1));
    expect(vi.mocked(composer.sendWithFiles).mock.calls[0]?.[0]).toContain("nav > a");
  });

  it("does not let an older comment completion clear a newer selection", async () => {
    let resolveSend = (_accepted: boolean) => {};
    vi.mocked(composer.sendWithFiles).mockReturnValueOnce(new Promise<boolean>((resolve) => { resolveSend = resolve; }));
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Annotate/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: { tag: "A", selector: "#first", text: "First", bounds: { x: 10, y: 20, width: 120, height: 32 }, styles: {} } }));
    const firstPanel = await screen.findByRole("dialog", { name: "Selected element" });
    await userEvent.type(within(firstPanel).getByLabelText("Comment"), "Update first");
    await userEvent.click(within(firstPanel).getByRole("button", { name: "Send comment" }));
    await userEvent.click(within(firstPanel).getByRole("button", { name: "Close preview" }));

    await userEvent.click(screen.getByRole("button", { name: /Annotate/ }));
    act(() => events.get("preview-element-picked")?.({ payload: { tag: "BUTTON", selector: "#second", text: "Second", bounds: { x: 20, y: 40, width: 100, height: 30 }, styles: {} } }));
    expect(await screen.findByText(/BUTTON · #second/)).toBeTruthy();
    await act(async () => { resolveSend(true); await Promise.resolve(); });

    expect(screen.getByText(/BUTTON · #second/)).toBeTruthy();
  });

  // 地址栏此前只在 localhost 目标下渲染,而切到 localhost 只能靠 agent 在消息里
  // 打印过 URL——用户自己起的 dev server 无从进入,预览等于只能看静态文件。
  it("lets a static-file preview be pointed at a dev server through the address bar", async () => {
    mountArtifact("dist/index.html");
    const bar = await screen.findByLabelText("Preview address");
    expect((bar as HTMLInputElement).value).toBe("dist/index.html");

    await userEvent.clear(bar);
    await userEvent.type(bar, "http://localhost:5173/{Enter}");

    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create")).toBe(true));
    expect(calls.filter((c) => c.cmd === "preview_create").at(-1)?.args?.url).toBe("http://localhost:5173/");
  });

  // 地址栏显示的是文件路径,却只收 URL——那是把「看起来能改的东西」做成不能
  // 改。两种输入都收:localhost 切 dev server,工作区路径切静态文件。
  it("accepts a workspace file path typed into the address bar", async () => {
    mountArtifact("pages/home.html");
    const bar = await screen.findByLabelText("Preview address");
    await userEvent.clear(bar);
    await userEvent.type(bar, "images/hero.png{Enter}");

    // repo_preview_files 报过的路径才认;命中后按该文件的 kind 切目标
    expect(await screen.findByRole("img", { name: "images/hero.png" })).toBeTruthy();
  });

  it("accepts a bare host:port typed into the address bar", async () => {
    mountArtifact("dist/index.html");
    const bar = await screen.findByLabelText("Preview address");
    await userEvent.clear(bar);
    await userEvent.type(bar, "localhost:5173{Enter}");

    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create")).toBe(true));
    expect(calls.filter((c) => c.cmd === "preview_create").at(-1)?.args?.url).toBe("http://localhost:5173/");
  });

  it("still shows the element dialog after switching from a file to a dev server", async () => {
    mountArtifact("dist/index.html");
    const bar = await screen.findByLabelText("Preview address");
    await userEvent.clear(bar);
    await userEvent.type(bar, "localhost:5173{Enter}");
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_create")).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: { selector: "#hero", text: "Hi", tag: "DIV", bounds: { x: 10, y: 20, width: 120, height: 32 }, styles: {} } }));

    expect(await screen.findByRole("dialog", { name: "Selected element" })).toBeTruthy();
  });

  it("rejects a path that repo_preview_files never reported", async () => {
    mountArtifact("pages/home.html");
    const bar = await screen.findByLabelText("Preview address");
    await userEvent.clear(bar);
    await userEvent.type(bar, "nope/missing.html{Enter}");

    expect(await screen.findByText(/Only localhost/)).toBeTruthy();
  });

  it("treats Enter on an unchanged artifact path as a reload, not an invalid URL", async () => {
    mountArtifact("dist/index.html");
    const bar = await screen.findByLabelText("Preview address");
    await userEvent.type(bar, "{Enter}");

    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_reload")).toBe(true));
    expect(screen.queryByText(/Only localhost/)).toBeNull();
  });

  it("includes the current artifact path in an element comment", async () => {
    mountArtifact("pages/home.html");
    await userEvent.click(screen.getByRole("button", { name: /Annotate/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: { tag: "A", selector: "nav > a", text: "Docs", bounds: { x: 10, y: 20, width: 120, height: 32 }, styles: {} } }));

    await userEvent.type(await screen.findByLabelText("Comment"), "Make this link clearer");
    await userEvent.click(screen.getByRole("button", { name: "Send comment" }));

    await waitFor(() => expect(composer.sendWithFiles).toHaveBeenCalledTimes(1));
    expect(vi.mocked(composer.sendWithFiles).mock.calls[0]?.[0]).toContain("File path: pages/home.html");
    const attachment = vi.mocked(composer.sendWithFiles).mock.calls[0]?.[1]?.[0];
    expect(await attachment?.text()).toContain('"target": "pages/home.html"');
  });

  it("positions the selected-element panel relative to the centered preview host", async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      if (this.dataset.previewHost !== undefined) return { x: 500, y: 100, left: 500, top: 100, right: 890, bottom: 480, width: 390, height: 380, toJSON() {} };
      return { x: 400, y: 80, left: 400, top: 80, right: 1000, bottom: 480, width: 600, height: 400, toJSON() {} };
    });
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: { selector: "#hero", text: "Hello", tag: "DIV", bounds: { x: 10, y: 20, width: 10, height: 10 }, styles: {} } }));

    const panel = await screen.findByRole("dialog", { name: "Selected element" });
    expect(panel.style.left).toContain("110px");
    expect(panel.style.top).toContain("58px");
    expect(panel.style.maxHeight).toBe("330px");
    expect(panel.className).toContain("overflow-auto");
    const background = panel.parentElement?.querySelector("img");
    expect(background?.style.left).toBe("100px");
    expect(background?.style.top).toBe("20px");
    expect(background?.style.width).toBe("390px");
    expect(background?.style.height).toBe("380px");
  });

  it("keeps the selected-element panel visible for elements near the overlay bottom", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: { selector: "#footer", text: "Footer", tag: "DIV", bounds: { x: 10, y: 370, width: 100, height: 20 }, styles: {} } }));

    const panel = await screen.findByRole("dialog", { name: "Selected element" });
    expect(panel.style.top).toBe("");
    expect(panel.style.bottom).toBe("38px");
    expect(panel.style.maxHeight).toBe("350px");
  });

  // 侧边栏形态(2026-08-30)把 overlay 变矮:点到占满视口的大块元素时,元素
  // 上下都挤不出空间,旧算法把 maxHeight 算成 0——弹窗在 DOM 里但高度为零,
  // 用户看到的是「选中了却什么都没弹」。放不下时必须改为盖住元素。
  it("falls back to overlapping the element when neither side has room", async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      if (this.dataset.previewHost !== undefined) return { x: 400, y: 80, left: 400, top: 80, right: 700, bottom: 320, width: 300, height: 240, toJSON() {} };
      return { x: 400, y: 80, left: 400, top: 80, right: 700, bottom: 320, width: 300, height: 240, toJSON() {} };
    });
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    // 整块 section:几乎铺满 240 高的 overlay,上下各剩不到 10px
    act(() => events.get("preview-element-picked")?.({ payload: { selector: "section", text: "Whole page", tag: "SECTION", bounds: { x: 0, y: 4, width: 300, height: 232 }, styles: {} } }));

    const panel = await screen.findByRole("dialog", { name: "Selected element" });
    expect(panel.style.top).toBe("12px");
    expect(panel.style.bottom).toBe("");
    // 关键:高度不能是 0,否则弹窗等于不存在
    expect(parseFloat(panel.style.maxHeight)).toBeGreaterThan(100);
  });

  it("keeps the wider selected-element panel inside the preview overlay", async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      if (this.dataset.previewHost !== undefined) return { x: 500, y: 100, left: 500, top: 100, right: 890, bottom: 480, width: 390, height: 380, toJSON() {} };
      return { x: 400, y: 80, left: 400, top: 80, right: 1000, bottom: 480, width: 600, height: 400, toJSON() {} };
    });
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: { selector: "#hero", text: "Hello", tag: "DIV", bounds: { x: 180, y: 20, width: 10, height: 10 }, styles: {} } }));

    const panel = await screen.findByRole("dialog", { name: "Selected element" });
    expect(panel.style.left).toContain("236px");
  });

  it("selects element layout options before WebKit blur closes the list", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: {
      selector: "#hero", text: "Hello", tag: "DIV", bounds: { x: 0, y: 0, width: 100, height: 20 },
      styles: { alignItems: "normal" },
    } }));
    const panel = await screen.findByRole("dialog", { name: "Selected element" });
    const align = within(panel).getByRole("button", { name: "Align" });
    await userEvent.click(align);

    fireEvent.pointerDown(within(panel).getByRole("option", { name: "center" }));
    fireEvent.blur(align, { relatedTarget: null });
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls).toContainEqual({
      cmd: "preview_element_apply",
      args: { edit: { selector: "#hero", property: "alignItems", value: "center" } },
    }));
  });

  it("edits grouped element styles and saves only changed values", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expect(calls.some((c) => c.cmd === "preview_picker_toggle" && c.args?.enabled === true)).toBe(true);
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: {
      selector: "#hero", text: "Hello", tag: "DIV", bounds: { x: 0, y: 0, width: 516.5, height: 46 },
      styles: { width: "516.5px", height: "46px", justifyContent: "normal", alignItems: "normal", backgroundColor: "rgba(0, 0, 0, 0)", opacity: "1", paddingTop: "0px", borderStyle: "none", borderColor: "rgb(0, 0, 0)", borderRadius: "0px" },
    } }));
    const panel = await screen.findByRole("dialog", { name: "Selected element" });

    expect((within(panel).getByLabelText("Width") as HTMLInputElement).value).toBe("516.5px");
    await userEvent.clear(within(panel).getByLabelText("Width"));
    await userEvent.type(within(panel).getByLabelText("Width"), "640px");
    await userEvent.click(within(panel).getByRole("button", { name: "Justify" }));
    await userEvent.click(within(panel).getByRole("option", { name: "space-between" }));
    await userEvent.clear(within(panel).getByLabelText("Padding Top"));
    await userEvent.type(within(panel).getByLabelText("Padding Top"), "12px");
    await userEvent.clear(within(panel).getByLabelText("Fill"));
    await userEvent.type(within(panel).getByLabelText("Fill"), "#ffffff");
    await userEvent.click(within(panel).getByRole("button", { name: "Style" }));
    await userEvent.click(within(panel).getByRole("option", { name: "solid" }));
    await userEvent.clear(within(panel).getByLabelText("Radius"));
    await userEvent.type(within(panel).getByLabelText("Radius"), "8px");
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Selected element" })).toBeNull());
    const edits = calls.filter((c) => c.cmd === "preview_element_apply").map((c) => c.args?.edit);
    expect(edits).toEqual([
      { selector: "#hero", property: "backgroundColor", value: "#ffffff" },
      { selector: "#hero", property: "width", value: "640px" },
      { selector: "#hero", property: "justifyContent", value: "space-between" },
      { selector: "#hero", property: "paddingTop", value: "12px" },
      { selector: "#hero", property: "borderStyle", value: "solid" },
      { selector: "#hero", property: "borderRadius", value: "8px" },
    ]);
  });

  it("opens the color palette beside its trigger", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: {
      selector: "#hero", text: "Hello", tag: "DIV", bounds: { x: 0, y: 0, width: 100, height: 20 },
      styles: { color: "#336699" },
    } }));
    const panel = await screen.findByRole("dialog", { name: "Selected element" });
    const trigger = within(panel).getByRole("button", { name: "Text color picker" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ x: 900, y: 200, left: 900, top: 200, right: 916, bottom: 216, width: 16, height: 16, toJSON() {} });

    await userEvent.click(trigger);

    const palette = screen.getByRole("dialog", { name: "Text color palette" });
    expect(palette.style.left).toBe("684px");
    expect(palette.style.top).toBe("200px");
  });

  it("supports both color pickers and typed color values", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: {
      selector: "#hero", text: "Hello", tag: "DIV", bounds: { x: 0, y: 0, width: 100, height: 20 },
      styles: { color: "#ff0000", backgroundColor: "rgba(0, 0, 0, 0)", borderColor: "#000000" },
    } }));
    const panel = await screen.findByRole("dialog", { name: "Selected element" });

    await userEvent.click(within(panel).getByRole("button", { name: "Text color picker" }));
    fireEvent.change(screen.getByLabelText("Text color hue"), { target: { value: "120" } });
    expect((within(panel).getByLabelText("Text color") as HTMLInputElement).value).toBe("#00ff00");
    await userEvent.clear(within(panel).getByLabelText("Color"));
    await userEvent.type(within(panel).getByLabelText("Color"), "rgb(10, 20, 30)");
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));

    const edits = calls.filter((call) => call.cmd === "preview_element_apply").map((call) => call.args?.edit);
    expect(edits).toEqual([
      { selector: "#hero", property: "color", value: "#00ff00" },
      { selector: "#hero", property: "borderColor", value: "rgb(10, 20, 30)" },
    ]);
  });

  it("rolls back earlier edits when a later edit fails", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: {
      selector: "#hero", text: "Hello", tag: "DIV", bounds: { x: 0, y: 0, width: 100, height: 20 },
      styles: { backgroundColor: "transparent", width: "100px" },
    } }));
    const panel = await screen.findByRole("dialog", { name: "Selected element" });
    await userEvent.clear(within(panel).getByLabelText("Fill"));
    await userEvent.type(within(panel).getByLabelText("Fill"), "#ffffff");
    await userEvent.clear(within(panel).getByLabelText("Width"));
    await userEvent.type(within(panel).getByLabelText("Width"), "100px;");
    applyFailureProperty = "width";

    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((call) => call.cmd === "preview_element_undo")).toBe(true));
    expect(calls.filter((call) => call.cmd === "preview_element_apply").map((call) => (call.args?.edit as { property?: string }).property)).toEqual(["backgroundColor", "width"]);
    expect(screen.getByRole("dialog", { name: "Selected element" })).toBeTruthy();
    expect((within(panel).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("cancels element style drafts without applying them", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: { selector: "#hero", text: "Hello", tag: "DIV", bounds: { x: 0, y: 0, width: 10, height: 10 }, styles: {} } }));
    const panel = await screen.findByRole("dialog", { name: "Selected element" });
    await userEvent.clear(within(panel).getByLabelText("Width"));
    await userEvent.type(within(panel).getByLabelText("Width"), "20px");
    await userEvent.click(within(panel).getByRole("button", { name: "Cancel" }));

    expect(calls.some((c) => c.cmd === "preview_element_apply")).toBe(false);
    expect(screen.queryByRole("dialog", { name: "Selected element" })).toBeNull();
  });

  it("deletes an element from the editor footer", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: { selector: "#hero", text: "Hello", tag: "DIV", bounds: { x: 0, y: 0, width: 10, height: 10 }, styles: {} } }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete element" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_element_apply" && (c.args?.edit as { property?: string }).property === "delete")).toBe(true));
    expect(screen.queryByRole("dialog", { name: "Selected element" })).toBeNull();
  });

  it("does not restore a stale element comment after marked feedback is sent", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Annotate/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));
    act(() => events.get("preview-element-picked")?.({ payload: {
      tag: "BUTTON",
      selector: "button.tab:nth-of-type(1)",
      text: "",
      bounds: { x: 20, y: 40, width: 7, height: 7 },
      styles: {},
    } }));
    expect(await screen.findByRole("dialog", { name: "Selected element" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Mark/ }));
    expect(screen.queryByRole("dialog", { name: "Selected element" })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: /^Send$/ }));

    await waitFor(() => expect(composer.sendWithFiles).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "Selected element" })).toBeNull();
  });

  it("ignores an element selection delivered after marking starts", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Annotate/ }));
    await waitFor(() => expect(events.has("preview-element-picked")).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: /Mark/ }));
    expect(await screen.findByRole("img", { name: "Captured preview" })).toBeTruthy();
    act(() => events.get("preview-element-picked")?.({ payload: {
      tag: "BUTTON",
      selector: "button.tab:nth-of-type(1)",
      text: "",
      bounds: { x: 20, y: 40, width: 7, height: 7 },
      styles: {},
    } }));

    expect(screen.queryByRole("dialog", { name: "Selected element" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() => expect(composer.sendWithFiles).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "Selected element" })).toBeNull();
  });

  it("toggles marking off and hides its toolbar when Mark is clicked again", async () => {
    mount();
    const mark = screen.getByRole("button", { name: /Mark/ });

    await userEvent.click(mark);
    expect(await screen.findByLabelText("Annotation surface")).toBeTruthy();
    expect(mark.className).toContain("btn-primary");

    await userEvent.click(mark);
    expect(screen.queryByLabelText("Annotation surface")).toBeNull();
    expect(mark.className).toContain("btn-ghost");
    await waitFor(() => expect(calls.some((call) => call.cmd === "preview_show")).toBe(true));
  });

  it("shows a rectangle while it is being dragged", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Mark/ }));

    const surface = await screen.findByLabelText("Annotation surface");
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({ x: 400, y: 80, left: 400, top: 80, right: 1000, bottom: 480, width: 600, height: 400, toJSON() {} });
    Object.defineProperty(surface, "setPointerCapture", { value: vi.fn() });
    fireEvent(surface, new MouseEvent("pointerdown", { bubbles: true, clientX: 460, clientY: 200 }));
    fireEvent(surface, new MouseEvent("pointermove", { bubbles: true, clientX: 580, clientY: 280 }));

    const rect = surface.querySelector('rect[stroke="red"]');
    expect(rect).toBeTruthy();
    expect(rect?.getAttribute("width")).toBe("20");
    expect(rect?.getAttribute("height")).toBe("20");

    fireEvent(surface, new MouseEvent("pointercancel", { bubbles: true }));
    expect(surface.querySelector('rect[stroke="red"]')).toBeNull();
  });

  // 发出去之后再弹一张「下载 / 发送到对话」的原生结果卡,是对已经做完的事二次
  // 追问。结果卡只该服务「关掉标注但没发」那条路。
  it("does not raise the native result card after the markup was sent", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Mark/ }));
    await userEvent.type(await screen.findByLabelText("Message to Agent"), "Copy is unclear");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(composer.sendWithFiles).toHaveBeenCalledTimes(1));
    expect(calls.some((c) => c.cmd === "preview_result_show")).toBe(false);
    // 标注层照常收起
    expect(screen.queryByLabelText("Annotation surface")).toBeNull();
  });

  it("opens the inline editor at the clicked image position and commits its text", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Mark/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Text" }));

    expect(screen.queryByLabelText("Annotation text")).toBeNull();
    const surface = screen.getByLabelText("Annotation surface");
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({ x: 400, y: 80, left: 400, top: 80, right: 1000, bottom: 480, width: 600, height: 400, toJSON() {} });
    const pointerDown = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 460, clientY: 200 });
    fireEvent(surface, pointerDown);

    expect(pointerDown.defaultPrevented).toBe(true);
    const input = screen.getByLabelText("Annotation text");
    expect(input.style.left).toBe("10%");
    expect(input.style.top).toBe("30%");
    expect(document.activeElement).toBe(input);
    await userEvent.type(input, "Move this section{Enter}");

    const text = surface.querySelector("text");
    expect(text?.textContent).toBe("Move this section");
    expect(text?.getAttribute("x")).toBe("10");
    expect(text?.getAttribute("y")).toBe("30");
  });

  it("sends the Agent message with the composed PNG", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Mark/ }));
    expect(await screen.findByRole("img", { name: "Captured preview" })).toBeTruthy();
    const feedback = screen.getByLabelText("Message to Agent");
    await userEvent.type(feedback, "Make the hero section more compact");
    await userEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() => expect(composer.sendWithFiles).toHaveBeenCalledTimes(1));
    const call = vi.mocked(composer.sendWithFiles).mock.calls[0];
    expect(call).toBeDefined();
    const [text, files] = call!;
    expect(text).toContain("Make the hero section more compact");
    expect(text).toContain("Design preview feedback for http://localhost:5173/app");
    expect(text).toContain("Annotations: 0.");
    expect(files).toHaveLength(1);
    const file = files[0];
    expect(file).toBeDefined();
    expect(file!.type).toBe("image/png");
    expect(file!.size).toBe(3);
    expect(await screen.findByText("Feedback sent through the composer.")).toBeTruthy();
  });

  it("keeps the capture open and visibly reports a guarded send failure", async () => {
    vi.mocked(composer.sendWithFiles).mockResolvedValueOnce(false);
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Mark/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Send$/ }));
    expect(await screen.findByText(/Feedback was not sent/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "Captured preview" })).toBeTruthy();
    expect(calls.some((c) => c.cmd === "preview_result_show")).toBe(false);
  });

  it("uses the same image composer path for the native preview-result send action", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Mark/ }));
    // 结果卡由「关闭标注」raise:那条路才是「先收起、稍后再下载/发送」
    await userEvent.click(await screen.findByRole("button", { name: "Close capture" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_result_show")).toBe(true));
    await waitFor(() => expect(events.has("preview-result-action")).toBe(true));
    act(() => { events.get("preview-result-action")?.({ payload: "send" }); });
    await waitFor(() => expect(composer.sendWithFiles).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(calls.some((c) => c.cmd === "preview_result_hide")).toBe(true));
  });
});
