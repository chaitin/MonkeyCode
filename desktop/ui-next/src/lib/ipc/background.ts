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

export interface StagedBackgroundAsset extends BackgroundAsset {
  stagedId: string;
}

let stagedIdSequence = 0;

/** invoke 前生成，确保即使导入响应丢失，调用方仍知道可丢弃的事务 ID。 */
export function createBackgroundStagedId(): string {
  stagedIdSequence = (stagedIdSequence + 1) % Number.MAX_SAFE_INTEGER;
  const random = Math.random().toString(36).slice(2) || "0";
  // 仅使用 Rust valid_staged_id 接受的 ASCII 字母、数字和连字符；长度远小于 160。
  return `web-${Date.now().toString(36)}-${stagedIdSequence.toString(36)}-${random}`;
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

export function importBackground(path: string, stagedId: string): Promise<StagedBackgroundAsset> {
  return invoke<StagedBackgroundAsset>("background_import", { path, stagedId });
}

export function confirmBackground(stagedId: string): Promise<void> {
  return invoke<void>("background_confirm", { stagedId });
}

export function discardBackground(stagedId: string): Promise<void> {
  return invoke<void>("background_discard", { stagedId });
}

/**
 * 保留原业务错误的清理路径：短暂 IPC 失败重试一次；仍失败时明确记录。
 * Rust 的 pending TTL 会在后续 read/import 等锁内操作中完成最终回收。
 */
export async function discardBackgroundBestEffort(stagedId: string): Promise<boolean> {
  try {
    await discardBackground(stagedId);
    return true;
  } catch (firstError) {
    try {
      await discardBackground(stagedId);
      return true;
    } catch (retryError) {
      console.warn("[background] staged asset discard failed; pending TTL will retry cleanup", {
        stagedId,
        firstError,
        retryError,
      });
      return false;
    }
  }
}

export function readBackgroundAsset(): Promise<BackgroundAsset | null> {
  if (!inDesktopShell()) return Promise.resolve(null);
  return invoke<BackgroundAsset | null>("background_read");
}

export function clearBackgroundAsset(): Promise<void> {
  return invoke<void>("background_clear");
}
