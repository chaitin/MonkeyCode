import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appLinkOpenUrl,
  platformFromUserAgent,
  visibleDownloadPlatforms,
} from "../src/lib/app-link-fallback.ts";

describe("App Link 落地页兜底", () => {
  it("识别 iOS / Android / HarmonyOS / OpenHarmony / 桌面", () => {
    assert.equal(
      platformFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"),
      "ios",
    );
    assert.equal(
      platformFromUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9)"),
      "android",
    );
    assert.equal(
      platformFromUserAgent("Mozilla/5.0 (Linux; Android 12; HarmonyOS; ALN-AL00)"),
      "harmony",
    );
    assert.equal(
      platformFromUserAgent("Mozilla/5.0 (Linux; OpenHarmony 5.0)"),
      "openharmony",
    );
    assert.equal(
      platformFromUserAgent("Mozilla/5.0 (Linux; OpenHarmony 5.0; HarmonyOS)"),
      "openharmony",
    );
    assert.equal(
      platformFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"),
      "desktop",
    );
  });

  it("OpenHarmony 同时显示 APK 和华为应用市场", () => {
    assert.deepEqual(visibleDownloadPlatforms("ios"), ["ios"]);
    assert.deepEqual(visibleDownloadPlatforms("android"), ["android"]);
    assert.deepEqual(visibleDownloadPlatforms("harmony"), ["harmony"]);
    assert.deepEqual(visibleDownloadPlatforms("openharmony"), [
      "android",
      "harmony",
    ]);
    assert.deepEqual(visibleDownloadPlatforms("desktop"), [
      "android",
      "ios",
      "harmony",
    ]);
  });

  it("把网页 query 原样带到自定义 scheme", () => {
    assert.equal(
      appLinkOpenUrl("?v=1&server=x&id=y&secret=z"),
      "monkeyai-mobile://pair/scan?v=1&server=x&id=y&secret=z",
    );
    assert.equal(
      appLinkOpenUrl("v=1&server=x"),
      "monkeyai-mobile://pair/scan?v=1&server=x",
    );
    assert.equal(appLinkOpenUrl(""), "monkeyai-mobile://pair/scan");
  });
});
