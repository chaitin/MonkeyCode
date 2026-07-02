import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(new URL("../src/components/console/nav/wallet-dialog.tsx", import.meta.url), "utf8");
const cjkPattern = /[\u3400-\u9fff]/;

test("钱包弹窗使用 walletDialog i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("walletDialog\.nav\.earn"\)/);
  assert.match(source, /t\("walletDialog\.earn\.balanceTitle"\)/);
  assert.match(source, /t\("walletDialog\.usage\.creditConsumptionTitle"\)/);
  assert.match(source, /t\("walletDialog\.recharge\.title"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("钱包弹窗提供中英文资源", () => {
  assert.equal(cn.walletDialog.nav.earn, "我的积分");
  assert.equal(en.walletDialog.nav.earn, "My credits");
  assert.equal(cn.walletDialog.earn.checkinAction, "签到领 100 积分");
  assert.equal(en.walletDialog.earn.checkinAction, "Check in for 100 credits");
  assert.equal(cn.walletDialog.recharge.confirm, "确认充值");
  assert.equal(en.walletDialog.recharge.confirm, "Confirm recharge");
});

test("钱包弹窗国际版隐藏邀请注册入口", () => {
  assert.match(source, /const isGlobalRegion = serverConfig\?\.region === "global"/);
  assert.match(source, /if \(!isGlobalRegion\) \{\s*fetchInvitations\(\)\s*\}/);
  assert.match(source, /!\s*isGlobalRegion \? \([\s\S]*t\("walletDialog\.invite\.title"\)[\s\S]*\) : null/);
});

test("钱包弹窗国际版隐藏开发者社区入口", () => {
  assert.match(source, /!\s*isGlobalRegion \? \(\s*<div className="rounded-md border p-4">\s*<div>\s*<div className="text-md font-medium">\{t\("walletDialog\.community\.title"\)\}<\/div>/);
});
