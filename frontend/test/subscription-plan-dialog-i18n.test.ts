import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(new URL("../src/components/console/nav/subscription-plan-dialog.tsx", import.meta.url), "utf8");
const cjkPattern = /[\u3400-\u9fff]/;

test("套餐弹窗使用 subscriptionPlan i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("subscriptionPlan\.dialog\.title"\)/);
  assert.match(source, /t\("subscriptionPlan\.plans\.pro\.name"\)/);
  assert.match(source, /t\("subscriptionPlan\.features\.taskConcurrency\.label"\)/);
  assert.match(source, /t\("subscriptionPlan\.confirm\.renewTitle"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("套餐弹窗提供中英文资源", () => {
  assert.equal(cn.subscriptionPlan.dialog.title, "我的套餐");
  assert.equal(en.subscriptionPlan.dialog.title, "My plan");
  assert.equal(cn.subscriptionPlan.plans.pro.name, "专业会员");
  assert.equal(en.subscriptionPlan.plans.pro.name, "Pro");
  assert.equal(cn.subscriptionPlan.actions.subscribePlan, "开通{{plan}}");
  assert.equal(en.subscriptionPlan.actions.subscribePlan, "Subscribe to {{plan}}");
});

test("套餐弹窗使用固定设计高度并限制极小视口", () => {
  assert.match(source, /h-120/);
  assert.match(source, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.doesNotMatch(source, /h-\[40vh\]|max-h-\[80vh\]/);
});
