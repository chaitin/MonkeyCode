import assert from "node:assert/strict";
import { test } from "node:test";
import { detectDevicePlatform } from "../src/lib/device-platform.ts";

test("移动设备优先于 UA 中的桌面系统标识", () => {
  assert.equal(detectDevicePlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14; arm64)" }).label, "Android");
  assert.equal(detectDevicePlatform({ userAgent: "iPhone; CPU iPhone OS 18 like Mac OS X" }).label, "iOS");
  assert.equal(detectDevicePlatform({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 }).label, "iOS");
});
test("Windows 7 使用兼容版，其他 Windows 使用普通版本", () => {
  assert.equal(detectDevicePlatform({ userAgent: "Windows NT 6.1; Win64; x64" }).label, "Win7 兼容版");
  assert.equal(detectDevicePlatform({ userAgent: "Windows NT 10.0; Win64; x64" }).label, "Windows");
});
test("macOS 仅在有明确架构信息时匹配安装包", () => {
  const mac = { userAgent: "Macintosh; Intel Mac OS X 10_15_7", platform: "MacIntel" };
  assert.equal(detectDevicePlatform(mac).label, undefined);
  assert.equal(detectDevicePlatform({ ...mac, architecture: "arm", bitness: "64" }).label, "macOS ARM");
  assert.equal(detectDevicePlatform({ ...mac, architecture: "x86", bitness: "64" }).label, "macOS Intel");
});
test("Linux 区分架构，不将 32 位 ARM 误判为 ARM64", () => {
  assert.equal(detectDevicePlatform({ userAgent: "Linux x86_64" }).label, "Linux x64");
  assert.equal(detectDevicePlatform({ userAgent: "Linux aarch64" }).label, "Linux ARM");
  assert.equal(detectDevicePlatform({ userAgent: "Linux armv7l" }).label, undefined);
  assert.equal(detectDevicePlatform({ userAgent: "Linux", architecture: "arm", bitness: "64" }).label, "Linux ARM");
});
test("识别明确的国产系统标识，未知设备不猜测", () => {
  assert.equal(detectDevicePlatform({ userAgent: "Linux UOS x86_64" }).label, "统信 UOS");
  assert.equal(detectDevicePlatform({ userAgent: "Linux Kylin x86_64" }).label, "银河麒麟");
  assert.equal(detectDevicePlatform({ userAgent: "HarmonyOS Mobile Android" }).label, "鸿蒙手机");
  assert.equal(detectDevicePlatform({ userAgent: "unknown" }), undefined);
});
