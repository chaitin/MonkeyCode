import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBackgroundAsset,
  importBackground,
  pickBackgroundPath,
  readBackgroundAsset,
} from "./background";

afterEach(() => vi.unstubAllGlobals());

function shell(result: (cmd: string, args?: Record<string, unknown>) => unknown) {
  const invoke = vi.fn((cmd: string, args?: Record<string, unknown>) => Promise.resolve(result(cmd, args)));
  vi.stubGlobal("window", { __TAURI__: { core: { invoke } } });
  return invoke;
}

describe("背景 IPC", () => {
  it("浏览器模式不打开对话框且读取收敛为无资产", async () => {
    vi.stubGlobal("window", {});
    expect(await pickBackgroundPath("选择背景")).toBeNull();
    expect(await readBackgroundAsset()).toBeNull();
  });

  it("原生对话框固定单路径和静态图片过滤器，取消返回 null", async () => {
    const invoke = shell(() => null);
    expect(await pickBackgroundPath("选择背景")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("plugin:dialog|open", {
      options: {
        title: "选择背景",
        directory: false,
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      },
    });
  });

  it("单路径、导入、读取与清除命令按字面契约透传", async () => {
    const asset = {
      revision: "abc",
      originalName: "wall.png",
      mime: "image/png",
      width: 2,
      height: 1,
      dataUrl: "data:image/png;base64,AA==",
    } as const;
    const invoke = shell((cmd) => (cmd === "plugin:dialog|open" ? "/tmp/wall.png" : cmd === "background_read" || cmd === "background_import" ? asset : null));
    expect(await pickBackgroundPath("Pick")).toBe("/tmp/wall.png");
    expect(await importBackground("/tmp/wall.png")).toEqual(asset);
    expect(await readBackgroundAsset()).toEqual(asset);
    await clearBackgroundAsset();
    expect(invoke).toHaveBeenCalledWith("background_import", { path: "/tmp/wall.png" });
    expect(invoke).toHaveBeenCalledWith("background_read", undefined);
    expect(invoke).toHaveBeenCalledWith("background_clear", undefined);
  });
});
