import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  findPassword: readSource("../src/pages/findpassword.tsx"),
  resetPassword: readSource("../src/pages/resetpassword.tsx"),
  teamOidcLogin: readSource("../src/pages/team-oidc-login.tsx"),
};

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("辅助登录页面使用 auth i18n key", () => {
  assert.match(sourceFiles.findPassword, /useTranslation/);
  assert.match(sourceFiles.findPassword, /t\("auth\.findPassword\.email"\)/);
  assert.match(sourceFiles.findPassword, /t\("auth\.findPassword\.toast\.sent"\)/);

  assert.match(sourceFiles.resetPassword, /useTranslation/);
  assert.match(sourceFiles.resetPassword, /t\("auth\.resetPassword\.confirmPassword"\)/);
  assert.match(sourceFiles.resetPassword, /t\("auth\.resetPassword\.successTitle"\)/);

  assert.match(sourceFiles.teamOidcLogin, /useTranslation/);
  assert.match(sourceFiles.teamOidcLogin, /t\("auth\.teamOidc\.title"\)/);
  assert.match(sourceFiles.teamOidcLogin, /t\("auth\.teamOidc\.disabled"\)/);
});

test("辅助登录页面提供中英文资源", () => {
  assert.equal(cn.auth.findPassword.action, "找回密码");
  assert.equal(en.auth.findPassword.action, "Reset password");
  assert.equal(cn.auth.resetPassword.invalidLinkTitle, "重置链接无效");
  assert.equal(en.auth.resetPassword.invalidLinkTitle, "Invalid reset link");
  assert.equal(cn.auth.teamOidc.title, "企业登录");
  assert.equal(en.auth.teamOidc.title, "Enterprise sign-in");
});
