import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(new URL("../src/components/console/nav/nav-balance.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/api/Api.ts", import.meta.url), "utf8");
const cjkPattern = /[\u3400-\u9fff]/;

test("账户余额入口使用 navBalance i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("navBalance\.account\.title"\)/);
  assert.match(source, /t\("navBalance\.profile\.changeNameTitle"\)/);
  assert.match(source, /const canRenewSubscription = normalizedSubscriptionPlan === "pro" \|\| normalizedSubscriptionPlan === "ultra"/);
  assert.match(source, /t\("navBalance\.plan\.upgrade"\)/);
  assert.match(source, /t\("navBalance\.plan\.renew"\)/);
  assert.match(source, /t\("navBalance\.balance\.creditBill"\)/);
  assert.match(source, /detail: \{ section: "usage" \}/);
  assert.match(source, /t\("navBalance\.security\.changePassword"\)/);
  assert.match(source, /t\("navBalance\.logout\.title"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("套餐信息完整显示并仅为有效自动续费合同展示下次扣款时间", () => {
  assert.match(source, /flex min-w-0 flex-wrap items-baseline/);
  assert.match(source, /whitespace-nowrap text-xs font-normal text-muted-foreground/);
  assert.match(source, /subscription\?\.payment_provider === "stripe"/);
  assert.match(source, /subscription\.billing_status === "active"/);
  assert.match(source, /subscription\.auto_renew/);
  assert.match(source, /!subscription\.cancel_at_period_end/);
  assert.match(source, /t\("navBalance\.plan\.nextCharge"/);
  assert.match(apiSource, /current_period_end\?: string;/);
  assert.match(apiSource, /payment_provider\?: string;/);
});

test("账户余额入口提供中英文资源", () => {
  assert.equal(cn.navBalance.account.title, "我的账户");
  assert.equal(en.navBalance.account.title, "My account");
  assert.equal(cn.navBalance.plan.upgrade, "开通高级会员");
  assert.equal(en.navBalance.plan.upgrade, "Upgrade membership");
  assert.equal(cn.navBalance.plan.renew, "续费");
  assert.equal(en.navBalance.plan.renew, "Renew");
  assert.equal(cn.navBalance.plan.nextCharge, "下次扣款：{{date}}");
  assert.equal(en.navBalance.plan.nextCharge, "Next charge: {{date}}");
  assert.equal(cn.navBalance.balance.creditBill, "积分账单");
  assert.equal(en.navBalance.balance.creditBill, "Credit bill");
  assert.equal(cn.navBalance.security.changePassword, "修改密码");
  assert.equal(en.navBalance.security.changePassword, "Change password");
  assert.equal(cn.navBalance.email.sendVerification, "发送验证邮件");
  assert.equal(en.navBalance.email.sendVerification, "Send verification email");
});
