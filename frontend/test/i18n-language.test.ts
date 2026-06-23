import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLanguageCookie,
  detectLanguageFromBrowser,
  getDayjsLocale,
  getHtmlLang,
  isAppLanguage,
  resolveInitialLanguage,
} from "../src/i18n/language.ts";

test("语言 cookie 只接受 cn 和 en", () => {
  assert.equal(isAppLanguage("cn"), true);
  assert.equal(isAppLanguage("en"), true);
  assert.equal(isAppLanguage("zh-CN"), false);
  assert.equal(isAppLanguage("english"), false);
  assert.equal(isAppLanguage(""), false);
});

test("合法 language cookie 优先于浏览器语言", () => {
  assert.equal(resolveInitialLanguage("cn", "en-US"), "cn");
  assert.equal(resolveInitialLanguage("en", "zh-CN"), "en");
});

test("缺失或非法 language cookie 时根据浏览器语言重新初始化", () => {
  assert.equal(resolveInitialLanguage(undefined, "zh-CN"), "cn");
  assert.equal(resolveInitialLanguage("zh-CN", "en-US"), "en");
});

test("浏览器首选语言是中文时命中 cn", () => {
  assert.equal(detectLanguageFromBrowser("zh-Hant-TW"), "cn");
  assert.equal(detectLanguageFromBrowser("zh"), "cn");
});

test("浏览器首选语言不是中文时统一使用 en", () => {
  assert.equal(detectLanguageFromBrowser("en-US"), "en");
  assert.equal(detectLanguageFromBrowser("ja-JP"), "en");
  assert.equal(detectLanguageFromBrowser(null), "en");
  assert.equal(detectLanguageFromBrowser(""), "en");
});

test("语言映射到 html lang 和 dayjs locale", () => {
  assert.equal(getHtmlLang("cn"), "zh-CN");
  assert.equal(getHtmlLang("en"), "en");
  assert.equal(getDayjsLocale("cn"), "zh-cn");
  assert.equal(getDayjsLocale("en"), "en");
});

test("写入 cookie 使用 language=cn/en", () => {
  assert.match(buildLanguageCookie("cn"), /^language=cn;/);
  assert.match(buildLanguageCookie("en"), /^language=en;/);
});
