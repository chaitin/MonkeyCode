import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const loginSource = readFileSync(
  new URL("../src/pages/login.tsx", import.meta.url),
  "utf8",
);

test("登录页使用 i18n 翻译 key 渲染主要文案", () => {
  assert.match(loginSource, /useTranslation/);
  assert.match(loginSource, /t\("login\.title"\)/);
  assert.match(loginSource, /t\("login\.tabs\.user"\)/);
  assert.match(loginSource, /t\("login\.choices\.password"\)/);
  assert.match(loginSource, /t\("login\.toast\.missingCredentials"\)/);
});

test("登录页翻译资源提供中英文文案", () => {
  assert.equal(cn.login.title, "MonkeyCode 智能开发平台");
  assert.equal(en.login.title, "MonkeyCode Intelligent Development Platform");
  assert.equal(cn.login.toast.captchaFailed, "验证码验证失败");
  assert.equal(en.login.toast.captchaFailed, "Captcha verification failed");
});
