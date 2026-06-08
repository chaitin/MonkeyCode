/**
 * 自建 OTA（expo-updates，非 EAS）。
 *  - 只更新 JS bundle + assets，原生改动仍需重新出包；runtimeVersion 不匹配的旧包收不到。
 *  - 开发模式 / 未启用 updates 时全部空操作（__DEV__ 下 expo-updates 关闭）。
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

export type OtaResult = 'updated' | 'none' | 'disabled' | 'error';

/** 检查并下载更新（不重启）。下载成功的更新会在下次冷启动自动生效，或调用方主动 reloadAsync。 */
export async function checkAndFetchOta(): Promise<OtaResult> {
  if (__DEV__ || !Updates.isEnabled) return 'disabled';
  try {
    const res = await Updates.checkForUpdateAsync();
    if (!res.isAvailable) return 'none';
    await Updates.fetchUpdateAsync();
    return 'updated';
  } catch {
    return 'error';
  }
}

export async function applyOta(): Promise<void> {
  await Updates.reloadAsync();
}

export type OtaCheck =
  | { status: 'disabled' }
  | { status: 'none' }
  | { status: 'error'; message?: string }
  | { status: 'available'; updateId: string; createdAt: Date | null };

/** 只检查、不下载：返回可更新版本信息，交给 UI 展示并让用户决定是否更新。 */
export async function checkOta(): Promise<OtaCheck> {
  if (__DEV__ || !Updates.isEnabled) return { status: 'disabled' };
  try {
    const res = await Updates.checkForUpdateAsync();
    if (!res.isAvailable) return { status: 'none' };
    const m = res.manifest as { id?: string; createdAt?: string } | undefined;
    return { status: 'available', updateId: m?.id ?? '', createdAt: m?.createdAt ? new Date(m.createdAt) : null };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : undefined };
  }
}

/** 下载并立即重启以应用更新（用户确认后调用）。 */
export async function downloadAndApplyOta(): Promise<void> {
  await Updates.fetchUpdateAsync();
  await Updates.reloadAsync();
}

/** 已安装的原生版本（来自安装包，与 OTA 无关）。 */
export function installedAppVersion(): string {
  return Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? '';
}

/** 当前运行的 OTA 更新 id（即 manifest id；内置启动、无 OTA 时为 null）。作为版本号后缀展示用。 */
export function currentOtaId(): string | null {
  return Updates.updateId ?? null;
}

export type AppUpdate = { version: string; url: string } | null;

/**
 * 检查是否有更新的「原生版本」（新安装包）。比 OTA 优先：原生改动 OTA 推不动，
 * 必须引导用户去装新包。返回 null 表示原生已是最新（此时再去查 OTA）。
 * 版本比较按 app.json 的可比较格式（如日期 260606）做字符串比较。
 *
 * 用 path 而非 query：`<updatesServer>/app-version/<platform>.json` —— 这样可以直接
 * 作为静态文件托管在 OSS/CDN 上（每个平台一个 JSON，内容为 { version, url }）。
 */
export async function checkAppUpdate(): Promise<AppUpdate> {
  const base = (Constants.expoConfig?.extra as { updatesServer?: string } | undefined)?.updatesServer?.replace(/\/$/, '');
  const installed = installedAppVersion();
  if (!base || !installed) return null;
  try {
    const res = await fetch(`${base}/app-version/${Platform.OS}.json`);
    if (!res.ok) return null;
    const j = (await res.json()) as { version?: string; url?: string };
    if (j?.version && String(j.version) > installed) {
      return { version: String(j.version), url: String(j.url || '') };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 启动 + 每次回到前台时静默检查并下载更新；本次会话首次下载成功时回调一次 onReady
 * （交给调用方决定是否提示重启，避免反复打扰）。
 */
export function useOtaAutoUpdate(onReady: () => void) {
  const prompted = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const run = useCallback(() => {
    void checkAndFetchOta().then((r) => {
      if (r === 'updated' && !prompted.current) {
        prompted.current = true;
        onReadyRef.current();
      }
    });
  }, []);

  useEffect(() => {
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, [run]);
}
