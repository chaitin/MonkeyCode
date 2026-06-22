import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(new URL("../src/components/console/nav/nav-balance.tsx", import.meta.url), "utf8");
const cjkPattern = /[\u3400-\u9fff]/;

test("账户余额入口使用 navBalance i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("navBalance\.account\.title"\)/);
  assert.match(source, /t\("navBalance\.profile\.changeNameTitle"\)/);
  assert.match(source, /t\("navBalance\.security\.changePassword"\)/);
  assert.match(source, /t\("navBalance\.logout\.title"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("账户余额入口提供中英文资源", () => {
  assert.equal(cn.navBalance.account.title, "我的账户");
  assert.equal(en.navBalance.account.title, "My account");
  assert.equal(cn.navBalance.security.changePassword, "修改密码");
  assert.equal(en.navBalance.security.changePassword, "Change password");
  assert.equal(cn.navBalance.email.sendVerification, "发送验证邮件");
  assert.equal(en.navBalance.email.sendVerification, "Send verification email");
});
