import { afterEach, describe, expect, it, vi } from "vitest";

import { applyUiScale, readUiScale, setUiScale, UI_SCALES } from "./uiScale";

afterEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty("zoom");
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("uiScale", () => {
  it("readUiScale:缺省/非法值回落 100%,合法档位原样", () => {
    expect(readUiScale()).toBe(1);
    localStorage.setItem("mc.uiScale", "1.37"); // 不在档位表:手改存储/旧版本残留
    expect(readUiScale()).toBe(1);
    localStorage.setItem("mc.uiScale", "1.25");
    expect(readUiScale()).toBe(1.25);
  });

  it("壳内走 Tauri setZoom(WebView 页面缩放,连图标/栏宽一起缩)", () => {
    const setZoom = vi.fn(() => Promise.resolve());
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      webview: { getCurrentWebview: () => ({ setZoom }) },
    };
    setUiScale(1.1);
    expect(setZoom).toHaveBeenCalledWith(1.1);
    expect(localStorage.getItem("mc.uiScale")).toBe("1.1");
    // 壳内不落 CSS zoom:两条通道叠加会双重缩放
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("");
  });

  it("浏览器模式退化为根节点 CSS zoom;回 100% 时清除", () => {
    applyUiScale(1.25);
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("1.25");
    applyUiScale(1);
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("");
  });

  it("档位表:100% 在列,档位有序且不重复", () => {
    expect(UI_SCALES).toContain(1);
    expect([...UI_SCALES].sort((a, b) => a - b)).toEqual([...UI_SCALES]);
    expect(new Set(UI_SCALES).size).toBe(UI_SCALES.length);
  });
});
