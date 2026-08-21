// 自定义背景桌面 IPC：文件选择只改善体验，格式与大小安全校验一律由 Rust 完成。
import { inDesktopShell, invoke } from "./ipc";

export interface BackgroundAsset {
  revision: string;
  originalName: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  dataUrl: string;
}

/** 原生单文件选择；取消或浏览器模式返回 null。 */
export async function pickBackgroundPath(title: string): Promise<string | null> {
  if (!inDesktopShell()) return null;
  const result = await invoke<string | string[] | null>("plugin:dialog|open", {
    options: {
      title,
      directory: false,
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    },
  });
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result[0] ?? null;
  return null;
}

export function importBackground(path: string): Promise<BackgroundAsset> {
  return invoke<BackgroundAsset>("background_import", { path });
}

export function readBackgroundAsset(): Promise<BackgroundAsset | null> {
  if (!inDesktopShell()) return Promise.resolve(null);
  return invoke<BackgroundAsset | null>("background_read");
}

export function clearBackgroundAsset(): Promise<void> {
  return invoke<void>("background_clear");
}
