import assert from "node:assert/strict";
import test from "node:test";

test("Matomo 在识别用户后记录 Console 页面且避免重复 PV", async () => {
  const queue: unknown[][] = [];
  const location = new URL("https://monkeycode-ai.com/login");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      _paq: queue,
      location,
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { title: "MonkeyCode" },
  });

  const {
    identifyMatomoUser,
    observeMatomoRoute,
    resetMatomoUser,
    trackMatomoAuthenticated,
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
});
