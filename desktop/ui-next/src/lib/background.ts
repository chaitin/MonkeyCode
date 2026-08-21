import type { BackgroundAsset } from "./ipc/background";
import { readBackgroundAsset } from "./ipc/background";

export type BackgroundFit = "cover" | "contain" | "repeat";

export interface BackgroundPreferencesV1 {
  version: 1;
  surfaceOpacity: number;
  blurPx: number;
  fit: BackgroundFit;
}

export const DEFAULT_BACKGROUND: BackgroundPreferencesV1 = {
  version: 1,
  surfaceOpacity: 0.82,
  blurPx: 0,
  fit: "cover",
};

export interface BackgroundRuntimeState {
  asset: BackgroundAsset | null;
  error: BackgroundRuntimeError | null;
}

export interface BackgroundRuntimeError {
  code: "storedAssetUnavailable" | "loadFailed";
  detail: string;
}

export interface BackgroundInitResult extends BackgroundRuntimeState {
  preferences: BackgroundPreferencesV1;
}

const PREFERENCES_KEY = "mc.backgroundPreferences";
const PRESENT_KEY = "mc.backgroundAssetPresent";
// 首版视觉与现有组件体系不协调，常规入口暂时隐藏；通过设置页“外观主题”
// 标签的隐藏连击入口临时解锁，既不暴露给普通用户，也保留调试能力。
const CUSTOM_BACKGROUND_ENABLED = false;
let enabledOverrideForTest: boolean | null = null;
const listeners = new Set<() => void>();
let runtimeState: BackgroundRuntimeState = { asset: null, error: null };
let operationGeneration = 0;
let operationTail: Promise<void> = Promise.resolve();

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const finiteInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const isFit = (value: unknown): value is BackgroundFit => value === "cover" || value === "contain" || value === "repeat";

function normalize(value: unknown): BackgroundPreferencesV1 {
  const object = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    version: 1,
    surfaceOpacity: finiteInRange(object.surfaceOpacity, 0.35, 1)
      ? object.surfaceOpacity
      : DEFAULT_BACKGROUND.surfaceOpacity,
    blurPx: finiteInRange(object.blurPx, 0, 20) ? object.blurPx : DEFAULT_BACKGROUND.blurPx,
    fit: isFit(object.fit) ? object.fit : DEFAULT_BACKGROUND.fit,
  };
}

export function customBackgroundEnabled(): boolean {
  return enabledOverrideForTest ?? CUSTOM_BACKGROUND_ENABLED;
}

/** 仅用于覆盖隐藏入口后的内部编辑器回归测试。 */
export function setCustomBackgroundEnabledForTest(enabled: boolean): void {
  enabledOverrideForTest = enabled;
}

export function readBackgroundPreferences(): BackgroundPreferencesV1 {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    return normalize(raw === null ? null : JSON.parse(raw));
  } catch {
    return { ...DEFAULT_BACKGROUND };
  }
}

function fitCss(fit: BackgroundFit): { size: string; repeat: string; position: string } {
  switch (fit) {
    case "contain":
      return { size: "contain", repeat: "no-repeat", position: "center" };
    case "repeat":
      return { size: "auto", repeat: "repeat", position: "left top" };
    case "cover":
      return { size: "cover", repeat: "no-repeat", position: "center" };
  }
}

export function applyBackgroundPreferences(preferences: BackgroundPreferencesV1): void {
  const safe = normalize(preferences);
  const fit = fitCss(safe.fit);
  const style = document.documentElement.style;
  style.setProperty("--mc-surface-opacity", `${safe.surfaceOpacity * 100}%`);
  style.setProperty("--mc-background-blur", `${safe.blurPx}px`);
  style.setProperty("--mc-background-size", fit.size);
  style.setProperty("--mc-background-repeat", fit.repeat);
  style.setProperty("--mc-background-position", fit.position);
}

/** 写盘失败不阻止当前会话即时生效。 */
export function setBackgroundPreferences(next: BackgroundPreferencesV1): void {
  const safe = normalize(next);
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(safe));
  } catch {
    // 只丢持久化。
  }
  applyBackgroundPreferences(safe);
}

function publish(next: BackgroundRuntimeState): void {
  runtimeState = next;
  for (const listener of listeners) listener();
}

export function getBackgroundRuntimeState(): BackgroundRuntimeState {
  return runtimeState;
}

export function subscribeBackgroundRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function markPresent(present: boolean): void {
  try {
    if (present) localStorage.setItem(PRESENT_KEY, "1");
    else localStorage.removeItem(PRESENT_KEY);
  } catch {
    // 诊断标记不可写不影响运行时。
  }
}

function hadStoredAsset(): boolean {
  try {
    return localStorage.getItem(PRESENT_KEY) === "1";
  } catch {
    return false;
  }
}

function decodeDataUrl(dataUrl: string): Promise<void> {
  const image = new Image();
  image.src = dataUrl;
  return image.decode();
}

export function beginBackgroundOperation(): number {
  operationGeneration += 1;
  return operationGeneration;
}

export function cancelBackgroundOperations(): void {
  operationGeneration += 1;
}

export function isBackgroundOperationCurrent(generation: number): boolean {
  return generation === operationGeneration;
}

/** 跨 BackgroundEditor 实例串行化资产事务，确保后发动作不会被先发 IPC 尾部反压。 */
export function runBackgroundAssetOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationTail.then(operation, operation);
  operationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function decodeBackground(asset: BackgroundAsset): Promise<void> {
  return decodeDataUrl(asset.dataUrl);
}

/** 只提交已预解码资产；设置页先确认 Rust 分阶段事务，再调用本函数。 */
export function applyDecodedBackground(asset: BackgroundAsset): void {
  const root = document.documentElement;
  root.style.setProperty("--mc-background-image", `url("${asset.dataUrl}")`);
  root.dataset.mcBackground = "active";
  markPresent(true);
  publish({ asset, error: null });
}

/** 先预解码，成功后一次提交 DOM 与 UI；启动恢复沿用这条路径。 */
export async function installBackground(asset: BackgroundAsset): Promise<void> {
  await decodeDataUrl(asset.dataUrl);
  applyDecodedBackground(asset);
}

export function removeAppliedBackground(): void {
  const root = document.documentElement;
  delete root.dataset.mcBackground;
  root.style.removeProperty("--mc-background-image");
  markPresent(false);
  publish({ asset: null, error: null });
}

function failStoredBackground(error: BackgroundRuntimeError): void {
  const root = document.documentElement;
  delete root.dataset.mcBackground;
  root.style.removeProperty("--mc-background-image");
  publish({ asset: null, error });
}

/**
 * mutation 的 IPC 失败可能是“已提交但响应丢失”；重新读取 Rust current 才能判定
 * 最终状态。读取和预解码期间若已有更新动作开始，旧恢复不得再提交 UI。
 */
export async function reconcileBackgroundRuntime(generation: number): Promise<void> {
  if (!isBackgroundOperationCurrent(generation)) return;
  let asset: BackgroundAsset | null;
  try {
    asset = await readBackgroundAsset();
  } catch (error) {
    if (isBackgroundOperationCurrent(generation)) {
      failStoredBackground({ code: hadStoredAsset() ? "storedAssetUnavailable" : "loadFailed", detail: errorMessage(error) });
    }
    return;
  }
  if (!isBackgroundOperationCurrent(generation)) return;
  if (!asset) {
    removeAppliedBackground();
    return;
  }
  try {
    await decodeDataUrl(asset.dataUrl);
  } catch (error) {
    if (isBackgroundOperationCurrent(generation)) {
      failStoredBackground({ code: "loadFailed", detail: errorMessage(error) });
    }
    return;
  }
  if (isBackgroundOperationCurrent(generation)) applyDecodedBackground(asset);
}

/** React 挂载前执行；任何失败均保留主题实色后备，并把可恢复错误留给设置页。 */
export async function initializeStoredBackground(): Promise<BackgroundInitResult> {
  const preferences = readBackgroundPreferences();
  applyBackgroundPreferences(preferences);
  try {
    const asset = await readBackgroundAsset();
    if (!asset) {
      removeAppliedBackground();
      return { preferences, asset: null, error: null };
    }
    await installBackground(asset);
    return { preferences, asset, error: null };
  } catch (error) {
    const detail = errorMessage(error);
    // 这里只发布结构化状态；面向用户的前缀由设置页按当前 locale 翻译。
    failStoredBackground({ code: hadStoredAsset() ? "storedAssetUnavailable" : "loadFailed", detail });
    return { preferences, asset: null, error: runtimeState.error };
  }
}

/** 测试隔离模块级状态。 */
export function resetBackgroundRuntimeForTest(): void {
  runtimeState = { asset: null, error: null };
  operationGeneration = 0;
  operationTail = Promise.resolve();
  enabledOverrideForTest = null;
  listeners.clear();
}
