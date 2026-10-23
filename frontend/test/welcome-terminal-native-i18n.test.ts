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
  assert.equal(cn.terminalNative.hero.tagline, "一站式 AI 办公开发平台");
  assert.equal(en.terminalNative.hero.tagline, "The all-in-one AI platform for work & code");
  assert.equal(cn.terminalNative.features.title, "功能与特色");
  assert.equal(en.terminalNative.features.title, "Features");
  assert.equal(cn.terminalNative.pricing.recommended, "推荐");
  assert.equal(en.terminalNative.pricing.recommended, "Recommended");
});

test("终端风格欢迎页移除私有化部署区块", () => {
  assert.doesNotMatch(source, /id="self-hosting"|terminalNative\.selfHosting\.|selfHostingAdvantage/);
});
