import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginBackgroundOperation,
  DEFAULT_BACKGROUND,
  getBackgroundRuntimeState,
  initializeStoredBackground,
  installBackground,
  readBackgroundPreferences,
  reconcileBackgroundRuntime,
  removeAppliedBackground,
  resetBackgroundRuntimeForTest,
  setBackgroundPreferences,
} from "./background";
import type { BackgroundAsset } from "./ipc/background";

let values: Map<string, string>;
let attributes: Map<string, string>;
let styles: Map<string, string>;
let decode: ReturnType<typeof vi.fn>;

const asset: BackgroundAsset = {
  revision: "a".repeat(64),
  originalName: "wall.png",
  mime: "image/png",
  width: 2,
  height: 1,
  dataUrl: "data:image/png;base64,AA==",
};

beforeEach(() => {
  values = new Map();
  attributes = new Map();
  styles = new Map();
  decode = vi.fn(() => Promise.resolve());
  const dataset: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  });
  vi.stubGlobal("document", {
    documentElement: {
      dataset,
      setAttribute: (key: string, value: string) => void attributes.set(key, value),
      removeAttribute: (key: string) => void attributes.delete(key),
      style: {
        setProperty: (key: string, value: string) => void styles.set(key, value),
        removeProperty: (key: string) => void styles.delete(key),
      },
    },
  });
  vi.stubGlobal("Image", class {
    src = "";
    decode = decode;
  });
  vi.stubGlobal("window", {});
  resetBackgroundRuntimeForTest();
});

afterEach(() => {
  resetBackgroundRuntimeForTest();
  vi.unstubAllGlobals();
});

describe("背景偏好", () => {
  it("缺失、坏 JSON、NaN、越界和未知 fit 逐字段回退", () => {
    expect(readBackgroundPreferences()).toEqual(DEFAULT_BACKGROUND);
    values.set("mc.backgroundPreferences", "{");
    expect(readBackgroundPreferences()).toEqual(DEFAULT_BACKGROUND);
    values.set(
      "mc.backgroundPreferences",
      JSON.stringify({ version: 99, surfaceOpacity: Number.NaN, blurPx: 21, fit: "stretch" }),
    );
    expect(readBackgroundPreferences()).toEqual(DEFAULT_BACKGROUND);
    values.set("mc.backgroundPreferences", JSON.stringify({ surfaceOpacity: 0.35, blurPx: 20, fit: "contain" }));
    expect(readBackgroundPreferences()).toEqual({ version: 1, surfaceOpacity: 0.35, blurPx: 20, fit: "contain" });
  });

  it("设置即时写盘并落 CSS 变量，三种填充映射正确", () => {
    setBackgroundPreferences({ version: 1, surfaceOpacity: 0.6, blurPx: 4, fit: "cover" });
    expect(styles.get("--mc-surface-opacity")).toBe("60%");
    expect(styles.get("--mc-background-blur")).toBe("4px");
    expect(styles.get("--mc-background-size")).toBe("cover");
    expect(styles.get("--mc-background-repeat")).toBe("no-repeat");
    expect(styles.get("--mc-background-position")).toBe("center");

    setBackgroundPreferences({ version: 1, surfaceOpacity: 0.82, blurPx: 0, fit: "contain" });
    expect(styles.get("--mc-background-size")).toBe("contain");
    setBackgroundPreferences({ version: 1, surfaceOpacity: 0.82, blurPx: 0, fit: "repeat" });
    expect(styles.get("--mc-background-size")).toBe("auto");
    expect(styles.get("--mc-background-repeat")).toBe("repeat");
    expect(styles.get("--mc-background-position")).toBe("left top");
    expect(JSON.parse(values.get("mc.backgroundPreferences") ?? "null").fit).toBe("repeat");
  });

  it("存储不可写仍即时应用", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => {} });
    expect(() => setBackgroundPreferences({ version: 1, surfaceOpacity: 0.5, blurPx: 3, fit: "cover" })).not.toThrow();
    expect(styles.get("--mc-surface-opacity")).toBe("50%");
  });
});

describe("背景运行时初始化", () => {
  function shellRead(value: unknown, reject = false) {
    vi.stubGlobal("window", {
      __TAURI__: {
        core: { invoke: () => (reject ? Promise.reject(value) : Promise.resolve(value)) },
      },
    });
  }

  it("成功时预解码后才启用属性并发布资产", async () => {
    shellRead(asset);
    const result = await initializeStoredBackground();
    expect(decode).toHaveBeenCalledTimes(1);
    expect(result.asset).toEqual(asset);
    expect((document.documentElement as HTMLElement).dataset.mcBackground).toBe("active");
    expect(styles.get("--mc-background-image")).toContain(asset.dataUrl);
    expect(values.get("mc.backgroundAssetPresent")).toBe("1");
  });

  it("无资产保持主题底色并清掉存在标记", async () => {
    values.set("mc.backgroundAssetPresent", "1");
    shellRead(null);
    expect((await initializeStoredBackground()).asset).toBeNull();
    expect((document.documentElement as HTMLElement).dataset.mcBackground).toBeUndefined();
    expect(values.has("mc.backgroundAssetPresent")).toBe(false);
  });

  it("IPC 或预解码失败移除 active、保留诊断，且安装失败不替换旧背景", async () => {
    values.set("mc.backgroundAssetPresent", "1");
    shellRead(new Error("missing"), true);
    const failed = await initializeStoredBackground();
    expect(failed.error).toEqual({ code: "storedAssetUnavailable", detail: "missing" });

    decode.mockResolvedValueOnce(undefined);
    await installBackground(asset);
    const oldImage = styles.get("--mc-background-image");
    decode.mockRejectedValueOnce(new Error("decode"));
    await expect(installBackground({ ...asset, revision: "b".repeat(64) })).rejects.toThrow("decode");
    expect(styles.get("--mc-background-image")).toBe(oldImage);
    expect(getBackgroundRuntimeState().asset?.revision).toBe(asset.revision);

    removeAppliedBackground();
    expect(styles.has("--mc-background-image")).toBe(false);
  });

  it("权威状态预解码失败会清掉旧 UI，而预解码期间过期的恢复不能提交", async () => {
    await installBackground(asset);
    const next = { ...asset, revision: "b".repeat(64), dataUrl: "data:image/png;base64,BB==" };
    shellRead(next);

    decode.mockRejectedValueOnce(new Error("authoritative decode failed"));
    await reconcileBackgroundRuntime(beginBackgroundOperation());
    expect(getBackgroundRuntimeState()).toEqual({
      asset: null,
      error: { code: "loadFailed", detail: "authoritative decode failed" },
    });
    expect(styles.has("--mc-background-image")).toBe(false);

    await installBackground(asset);
    let resolveDecode!: () => void;
    decode.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveDecode = resolve;
    }));
    const recovery = reconcileBackgroundRuntime(beginBackgroundOperation());
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(4));
    beginBackgroundOperation();
    resolveDecode();
    await recovery;

    expect(getBackgroundRuntimeState().asset).toEqual(asset);
    expect(styles.get("--mc-background-image")).toContain(asset.dataUrl);
  });
});
