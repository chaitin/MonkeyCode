import { afterEach, describe, expect, it, vi } from "vitest";
import { readDesignTemplatePreview } from "./session";

afterEach(() => vi.unstubAllGlobals());

describe("readDesignTemplatePreview", () => {
  it("只把命令返回的生成路径转换成 asset URL，不回传 HTML", async () => {
    const invoke = vi.fn(async () => "/workspace/.monkeycode/design/rendered-template-previews/key.html");
    const convertFileSrc = vi.fn((path: string, protocol: string) => `asset://localhost${path}?protocol=${protocol}`);
    vi.stubGlobal("window", { __TAURI__: { core: { invoke, convertFileSrc } } });

    await expect(readDesignTemplatePreview("sid", "digest/source/example.html"))
      .resolves.toBe("asset://localhost/workspace/.monkeycode/design/rendered-template-previews/key.html?protocol=asset");
    expect(invoke).toHaveBeenCalledWith("design_template_preview_read", {
      id: "sid",
      path: "digest/source/example.html",
    });
    expect(convertFileSrc).toHaveBeenCalledWith(
      "/workspace/.monkeycode/design/rendered-template-previews/key.html",
      "asset",
    );
  });
});
