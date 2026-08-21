import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBackgroundAsset,
  confirmBackground,
  createBackgroundOwnerToken,
  createBackgroundStagedId,
  discardBackground,
  discardBackgroundBestEffort,
  importBackground,
  pickBackgroundPath,
  readBackgroundAsset,
} from "./background";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    const staged = { ...asset, stagedId: "stage-1" };
    const invoke = shell((cmd) =>
      cmd === "plugin:dialog|open" ? "/tmp/wall.png" : cmd === "background_read" ? asset : cmd === "background_import" ? staged : null,
    );
    expect(await pickBackgroundPath("Pick")).toBe("/tmp/wall.png");
    const ownerToken = "a".repeat(64);
    expect(await importBackground("/tmp/wall.png", staged.stagedId, ownerToken)).toEqual(staged);
    await confirmBackground(staged.stagedId, ownerToken);
    await discardBackground(staged.stagedId, ownerToken);
    expect(await readBackgroundAsset()).toEqual(asset);
    await clearBackgroundAsset();
    expect(invoke).toHaveBeenCalledWith("background_import", { path: "/tmp/wall.png", stagedId: "stage-1", ownerToken });
    expect(invoke).toHaveBeenCalledWith("background_confirm", { stagedId: "stage-1", ownerToken });
    expect(invoke).toHaveBeenCalledWith("background_discard", { stagedId: "stage-1", ownerToken });
    expect(invoke).toHaveBeenCalledWith("background_read", undefined);
    expect(invoke).toHaveBeenCalledWith("background_clear", undefined);
  });

  it("调用前生成的 staged ID 符合 Rust 规则且同进程连续调用不冲突", () => {
    const first = createBackgroundStagedId();
    const second = createBackgroundStagedId();
    expect(first).toMatch(/^[A-Za-z0-9-]{1,160}$/);
    expect(second).toMatch(/^[A-Za-z0-9-]{1,160}$/);
    expect(second).not.toBe(first);
  });

  it("调用前通过旧 WebKit 可用的 getRandomValues 生成独立 256-bit owner token", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.forEach((_, index) => {
        bytes[index] = index;
      });
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    expect(createBackgroundOwnerToken()).toBe(
      Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0")).join(""),
    );
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("getRandomValues 不可用时降级令牌仍符合 Rust 规则且连续调用不同", () => {
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const first = createBackgroundOwnerToken();
    const second = createBackgroundOwnerToken();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
  });

  it("discard 短暂失败重试一次，持续失败会记录 TTL 可恢复状态", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const attempts = new Map<string, number>();
    const invoke = shell((cmd, args) => {
      if (cmd !== "background_discard") return null;
      const stagedId = String(args?.stagedId);
      const count = (attempts.get(stagedId) ?? 0) + 1;
      attempts.set(stagedId, count);
      if (stagedId === "retry-once" && count === 1) throw new Error("temporary IPC failure");
      if (stagedId === "ttl-fallback") throw new Error("persistent IPC failure");
      return null;
    });

    const ownerToken = "b".repeat(64);
    expect(await discardBackgroundBestEffort("retry-once", ownerToken)).toBe(true);
    expect(attempts.get("retry-once")).toBe(2);
    expect(warn).not.toHaveBeenCalled();
    expect(await discardBackgroundBestEffort("ttl-fallback", ownerToken)).toBe(false);
    expect(attempts.get("ttl-fallback")).toBe(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("pending TTL"),
      expect.objectContaining({ stagedId: "ttl-fallback" }),
    );
    expect(invoke.mock.calls.every(([, args]) => args?.ownerToken === ownerToken)).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(4);
  });
});
