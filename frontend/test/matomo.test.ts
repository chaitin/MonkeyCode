import assert from "node:assert/strict";
import test from "node:test";

test("Matomo 在识别用户后记录 Console 页面且避免重复 PV", async () => {
  const queue: unknown[][] = [];
  const location = new URL("https://monkeycode-ai.com/login");
  const storage = new Map<string, string>();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      _paq: queue,
      location,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { title: "MonkeyCode" },
  });

  const {
    identifyMatomoUser,
    hasActiveBasicConcurrencyUpgradeJourney,
    observeMatomoRoute,
    resetMatomoUser,
    startBasicConcurrencyUpgradeJourney,
    trackMatomoAuthenticated,
    trackBasicConcurrencyUpgradeEvent,
    trackBasicConcurrencyUpgradeGoal,
    trackPaidSubscriptionObserved,
    trackSubscriptionConversion,
  } = await import("../src/lib/matomo.ts");

  assert.equal(identifyMatomoUser("user-1"), true);
  assert.deepEqual(queue.at(-1), ["setUserId", "user-1"]);

  location.href = "https://monkeycode-ai.com/console/tasks";
  assert.equal(observeMatomoRoute({ trackPageView: true }), true);
  assert.deepEqual(queue.slice(-3), [
    ["setCustomUrl", "https://monkeycode-ai.com/console/tasks"],
    ["setDocumentTitle", "monkeycode-ai.com/MonkeyCode"],
    ["trackPageView"],
  ]);

  assert.equal(identifyMatomoUser("user-1"), false);
  assert.equal(observeMatomoRoute({ trackPageView: true }), false);

  trackMatomoAuthenticated();
  assert.deepEqual(queue.at(-1), ["trackEvent", "user", "authenticated"]);

  resetMatomoUser();
  assert.deepEqual(queue.slice(-2), [
    ["trackEvent", "user", "logout_success"],
    ["resetUserId"],
  ]);

  assert.equal(
    trackSubscriptionConversion("concurrency_limit_viewed", "basic"),
    true,
  );
  assert.deepEqual(queue.at(-1), [
    "trackEvent",
    "subscription_conversion",
    "concurrency_limit_viewed",
    "basic",
  ]);

  const queueLengthBeforeJourneyStart = queue.length;
  assert.equal(startBasicConcurrencyUpgradeJourney("user-1"), true);
  assert.equal(queue.length, queueLengthBeforeJourneyStart);
  assert.deepEqual(queue.at(-1), [
    "trackEvent",
    "subscription_conversion",
    "concurrency_limit_viewed",
    "basic",
  ]);

  assert.equal(hasActiveBasicConcurrencyUpgradeJourney("user-1"), true);
  assert.equal(
    trackBasicConcurrencyUpgradeEvent(
      "user-1",
      "subscription_plan_selected",
      "pro",
    ),
    true,
  );
  assert.equal(
    trackBasicConcurrencyUpgradeEvent(
      "paid-user",
      "subscription_plan_selected",
      "ultra",
    ),
    false,
  );

  assert.equal(
    trackSubscriptionConversion("subscription_checkout_created", "pro", 99),
    true,
  );
  assert.deepEqual(queue.at(-1), [
    "trackEvent",
    "subscription_conversion",
    "subscription_checkout_created",
    "pro",
    99,
  ]);

  assert.equal(trackBasicConcurrencyUpgradeGoal("user-1", 99), true);
  assert.deepEqual(queue.at(-1), ["trackGoal", 3, 99]);
  assert.equal(trackBasicConcurrencyUpgradeGoal("paid-user", 99), false);
  assert.equal(trackBasicConcurrencyUpgradeGoal("user-1", Number.NaN), false);

  assert.equal(trackPaidSubscriptionObserved("user-1", "basic"), false);
  assert.equal(
    trackPaidSubscriptionObserved("user-1", "pro", "2026-09-11T00:00:00Z"),
    true,
  );
  assert.deepEqual(queue.at(-1), [
    "trackEvent",
    "subscription_conversion",
    "paid_subscription_observed",
    "pro",
  ]);
  assert.equal(
    trackPaidSubscriptionObserved("user-1", "pro", "2026-09-11T00:00:00Z"),
    false,
  );
  assert.equal(
    trackPaidSubscriptionObserved("user-1", "ultra", "2026-10-11T00:00:00Z"),
    false,
  );
  assert.equal(hasActiveBasicConcurrencyUpgradeJourney("user-1"), false);
  assert.equal(
    trackPaidSubscriptionObserved("paid-user", "pro", "2026-10-11T00:00:00Z"),
    false,
  );
  assert.equal(
    trackPaidSubscriptionObserved(
      "flagship-user",
      "ultra",
      "2026-10-11T00:00:00Z",
    ),
    false,
  );

  const staleJourneyKey =
    "matomo_basic_concurrency_upgrade_started_at:stale-user";
  storage.set(staleJourneyKey, String(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1));
  assert.equal(hasActiveBasicConcurrencyUpgradeJourney("stale-user"), false);
  assert.equal(storage.has(staleJourneyKey), false);
});
