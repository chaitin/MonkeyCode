import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function readSource(path: string) {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
}

test("app runtime provider loads server config and auth status globally", () => {
  const runtimeSource = readSource("components/app-runtime-provider.tsx");
  const mainSource = readSource("main.tsx");

  assert.match(runtimeSource, /v1ServerConfigList/);
  assert.match(runtimeSource, /v1UsersStatusList/);
  assert.match(runtimeSource, /Promise\.allSettled/);
  assert.match(runtimeSource, /export function useAppRuntime/);

  assert.match(mainSource, /AppRuntimeProvider/);
  assert.match(mainSource, /<AppRuntimeProvider>/);
});

test("legacy auth provider is replaced by app runtime", () => {
  assert.equal(
    existsSync(new URL("../src/components/auth-provider.tsx", import.meta.url)),
    false,
  );

  const publicSources = [
    "pages/welcome.tsx",
    "pages/privacy-policy.tsx",
    "pages/user-agreement.tsx",
    "pages/playground.tsx",
    "components/welcome/header.tsx",
    "components/welcome/terminal-chrome.tsx",
    "components/welcome/terminal-native-page.tsx",
  ].map(readSource);

  for (const source of publicSources) {
    assert.doesNotMatch(source, /AuthProvider|useAuth|auth-provider/);
  }
});

test("console data provider reuses runtime auth state", () => {
  const source = readSource("components/console/data-provider.tsx");

  assert.match(source, /useAppRuntime/);
  assert.match(source, /reloadAuth/);
  assert.doesNotMatch(source, /v1UsersStatusList/);
});
