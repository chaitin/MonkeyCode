import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("会员转化漏斗覆盖并发弹窗、套餐下单和订阅生效", () => {
  const concurrentLimitDialog = readSource(
    "../src/components/console/task/task-concurrent-limit-dialog.tsx",
  );
  const subscriptionPlanDialog = readSource(
    "../src/components/console/nav/subscription-plan-dialog.tsx",
  );
  const dataProvider = readSource("../src/components/console/data-provider.tsx");

  assert.match(concurrentLimitDialog, /startBasicConcurrencyUpgradeJourney/);
  assert.match(concurrentLimitDialog, /trackSubscriptionConversion\("concurrency_limit_viewed", "basic"\)/);
  assert.match(concurrentLimitDialog, /"concurrency_limit_upgrade_clicked"/);
  assert.match(concurrentLimitDialog, /startBasicConcurrencyUpgradeJourney\(user\.id \|\| ""\)/);
  assert.match(concurrentLimitDialog, /const isBasicPlan = subscription\?\.plan === "basic"/);
  assert.match(concurrentLimitDialog, /\{isBasicPlan && \(/);
  assert.match(concurrentLimitDialog, /detail: \{ section: "plan" \}/);
  assert.doesNotMatch(concurrentLimitDialog, /!hasAdvancedPlan && \(/);
  assert.match(subscriptionPlanDialog, /"subscription_plan_dialog_viewed"/);
  assert.match(subscriptionPlanDialog, /"subscription_plan_selected"/);
  assert.match(subscriptionPlanDialog, /"subscription_checkout_created"/);
  assert.match(subscriptionPlanDialog, /trackBasicConcurrencyUpgradeGoal\(user\?\.id \|\| "", selectedOrderTotal\)/);
  assert.match(subscriptionPlanDialog, /"subscription_checkout_failed"/);
  assert.match(subscriptionPlanDialog, /const isBasicPlan = subscription\?\.plan === "basic"/);
  assert.match(dataProvider, /trackPaidSubscriptionObserved/);
  assert.doesNotMatch(subscriptionPlanDialog, /trackSubscriptionConversion/);
});
