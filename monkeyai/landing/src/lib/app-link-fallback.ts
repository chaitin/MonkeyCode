export type AppLinkPlatform =
  | "ios"
  | "android"
  | "harmony"
  | "openharmony"
  | "desktop";

export type AppLinkDownloadPlatform = "android" | "ios" | "harmony";

export function platformFromUserAgent(ua: string): AppLinkPlatform {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // OpenHarmony 优先于 HarmonyOS：部分 UA 会同时带两个标记。
  if (/OpenHarmony/i.test(ua)) return "openharmony";
  if (/HarmonyOS/i.test(ua)) return "harmony";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

/**
 * 决定显示哪些下载入口。
 * - iOS / Android / HarmonyOS：只显示对应平台
 * - OpenHarmony：APK 和华为应用市场都显示
 * - 桌面：三个都显示，方便人工选择
 */
export function visibleDownloadPlatforms(
  platform: AppLinkPlatform,
): AppLinkDownloadPlatform[] {
  if (platform === "desktop") return ["android", "ios", "harmony"];
  if (platform === "openharmony") return ["android", "harmony"];
  return [platform];
}

/** 把网页 query 原样带到自定义 scheme，供“打开 App”按钮使用。 */
export function appLinkOpenUrl(search: string): string {
  const raw = search.trim();
  if (!raw) return "monkeyai-mobile://pair/scan";
  return `monkeyai-mobile://pair/scan${raw.startsWith("?") ? raw : `?${raw}`}`;
}
