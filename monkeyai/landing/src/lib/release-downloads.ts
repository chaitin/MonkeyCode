type ReleasePlatform = "android" | "ios" | "linux-amd" | "linux-arm" | "macos" | "windows";

type ReleaseManifestEntry = {
  url?: unknown;
};

type ReleaseManifest = Partial<Record<ReleasePlatform, ReleaseManifestEntry>>;

const RELEASE_MANIFEST_URL = "https://jiying.chat/releases/version.json";
const RELEASE_LINK_SELECTOR = "a[data-release-platform]";
const OFFICIAL_RELEASE_PATHS: Readonly<Record<ReleasePlatform, string>> = {
  android: "/releases/jiying.apk",
  ios: "/releases/jiying.dmg",
  "linux-amd": "/releases/jiying.amd.AppImage",
  "linux-arm": "/releases/jiying.arm.AppImage",
  macos: "/releases/jiying.dmg",
  windows: "/releases/jiying.exe",
};
const GITHUB_DESKTOP_SUFFIXES: Partial<Record<ReleasePlatform, string>> = {
  "linux-amd": "linux-x86_64.AppImage",
  "linux-arm": "linux-arm64.AppImage",
  macos: "mac-universal.dmg",
  windows: "win-x64.exe",
};

function isReleasePlatform(
  value: string | undefined,
): value is ReleasePlatform {
  return (
    value === "android" ||
    value === "ios" ||
    value === "linux-amd" ||
    value === "linux-arm" ||
    value === "macos" ||
    value === "windows"
  );
}

export function releaseUrl(
  value: unknown,
  platform: ReleasePlatform,
): string | undefined {
  if (typeof value !== "string") return undefined;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.search
    ) {
      return undefined;
    }
    if (url.origin === "https://jiying.chat") {
      return url.pathname === OFFICIAL_RELEASE_PATHS[platform]
        ? url.href
        : undefined;
    }
    const suffix = GITHUB_DESKTOP_SUFFIXES[platform];
    if (url.origin !== "https://github.com" || !suffix) return undefined;
    const match = url.pathname.match(
      new RegExp(
        `^/ptonlix/MagicChat/releases/download/desktop-v(\\d+\\.\\d+\\.\\d+)/Jiying-(\\d+\\.\\d+\\.\\d+)-${escapeRegExp(suffix)}$`,
      ),
    );
    return match && match[1] === match[2] ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function hydrateReleaseDownloadLinks(
  root: ParentNode = document,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const links = Array.from(
    root.querySelectorAll<HTMLAnchorElement>(RELEASE_LINK_SELECTOR),
  );
  if (links.length === 0) return;

  try {
    const response = await fetcher(RELEASE_MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) return;

    const manifest = (await response.json()) as ReleaseManifest;
    for (const link of links) {
      const platform = link.dataset.releasePlatform;
      if (!isReleasePlatform(platform)) continue;

      const url = releaseUrl(manifest[platform]?.url, platform);
      if (url) link.href = url;
    }
  } catch {
    // Keep the stable fallback href values when the manifest is unavailable.
  }
}
