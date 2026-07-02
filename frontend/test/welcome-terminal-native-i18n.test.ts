import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(new URL("../src/components/welcome/terminal-native-page.tsx", import.meta.url), "utf8");
const cjkPattern = /[\u3400-\u9fff]/;

test("终端风格欢迎页使用 terminalNative i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("terminalNative\.hero\.tagline"\)/);
  assert.match(source, /t\("terminalNative\.features\.title"\)/);
  assert.match(source, /t\("terminalNative\.pricing\.title"\)/);
  assert.match(source, /t\("terminalNative\.heroTerminal\.title"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("终端风格欢迎页提供中英文资源", () => {
  assert.equal(cn.terminalNative.hero.tagline, "在线 AI 开发平台");
  assert.equal(en.terminalNative.hero.tagline, "Online AI development platform");
  assert.equal(cn.terminalNative.features.title, "功能与特色");
  assert.equal(en.terminalNative.features.title, "Features");
  assert.equal(cn.terminalNative.pricing.recommended, "推荐");
  assert.equal(en.terminalNative.pricing.recommended, "Recommended");
});

test("终端风格欢迎页国际版私有化按钮指向 GitHub", () => {
  assert.match(source, /const isGlobalRegion = serverConfig\?\.region === "global"/);
  assert.match(source, /const selfHostingActionLink = isGlobalRegion \? GITHUB_LINK : SELF_HOSTING_DOC_LINK/);
  assert.match(source, /<HeaderAction href=\{selfHostingActionLink\} external>/);
});
