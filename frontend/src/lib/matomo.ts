type MatomoCommand = [name: string, ...args: unknown[]];

declare global {
  interface Window {
    _paq?: MatomoCommand[];
  }
}

let identifiedUserId: string | null = null;
let lastObservedUrl = getCurrentUrl();
const paidSubscriptionFingerprints = new Map<string, string>();
const basicConcurrencyUpgradeStartedAt = new Map<string, number>();
const SUBSCRIPTION_CONVERSION_CATEGORY = "subscription_conversion";
const BASIC_CONCURRENCY_UPGRADE_GOAL_ID = 3;
const PAID_SUBSCRIPTION_STORAGE_PREFIX = "matomo_paid_subscription_observed:";
const BASIC_CONCURRENCY_UPGRADE_STORAGE_PREFIX =
  "matomo_basic_concurrency_upgrade_started_at:";
const BASIC_CONCURRENCY_UPGRADE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function getCurrentUrl() {
  return typeof window === "undefined" ? "" : window.location.href;
}

function getMatomoQueue() {
  if (typeof window === "undefined") {
    return null;
  }

  window._paq = window._paq || [];
  return window._paq;
}

export function identifyMatomoUser(userId: string) {
  const normalizedUserId = String(userId).trim();
  const queue = getMatomoQueue();

  if (!queue || !normalizedUserId || identifiedUserId === normalizedUserId) {
    return false;
  }

  queue.push(["setUserId", normalizedUserId]);
  identifiedUserId = normalizedUserId;
  return true;
}

export function trackMatomoAuthenticated() {
  getMatomoQueue()?.push(["trackEvent", "user", "authenticated"]);
}

export function trackSubscriptionConversion(
  action: string,
  name?: string,
  value?: number,
) {
  const queue = getMatomoQueue();
  if (!queue || !action) {
    return false;
  }

  const command: MatomoCommand = [
    "trackEvent",
    SUBSCRIPTION_CONVERSION_CATEGORY,
    action,
  ];
  if (name !== undefined || value !== undefined) {
    command.push(name ?? "");
  }
  if (value !== undefined) {
    command.push(value);
  }
  queue.push(command);
  return true;
}

function getBasicConcurrencyUpgradeStorageKey(userId: string) {
  return `${BASIC_CONCURRENCY_UPGRADE_STORAGE_PREFIX}${userId}`;
}

function getBasicConcurrencyUpgradeStartedAt(userId: string) {
  const sessionStartedAt = basicConcurrencyUpgradeStartedAt.get(userId);
  if (sessionStartedAt !== undefined) {
    return sessionStartedAt;
  }

  try {
    const storedStartedAt = Number(
      window.localStorage.getItem(getBasicConcurrencyUpgradeStorageKey(userId)),
    );
    if (Number.isFinite(storedStartedAt) && storedStartedAt > 0) {
      basicConcurrencyUpgradeStartedAt.set(userId, storedStartedAt);
      return storedStartedAt;
    }
  } catch {
    // Session-level attribution still applies when storage is unavailable.
  }

  return null;
}

function clearBasicConcurrencyUpgradeJourney(userId: string) {
  basicConcurrencyUpgradeStartedAt.delete(userId);
  try {
    window.localStorage.removeItem(getBasicConcurrencyUpgradeStorageKey(userId));
  } catch {
    // The in-memory journey has already been cleared.
  }
}

export function hasActiveBasicConcurrencyUpgradeJourney(userId: string) {
  const normalizedUserId = String(userId).trim();
  if (!normalizedUserId) {
    return false;
  }

  const startedAt = getBasicConcurrencyUpgradeStartedAt(normalizedUserId);
  if (startedAt === null) {
    return false;
  }
  if (Date.now() - startedAt > BASIC_CONCURRENCY_UPGRADE_WINDOW_MS) {
    clearBasicConcurrencyUpgradeJourney(normalizedUserId);
    return false;
  }
  return true;
}

export function startBasicConcurrencyUpgradeJourney(userId: string) {
  const normalizedUserId = String(userId).trim();
  if (!normalizedUserId) {
    return false;
  }

  const startedAt = Date.now();
  basicConcurrencyUpgradeStartedAt.set(normalizedUserId, startedAt);
  try {
    window.localStorage.setItem(
      getBasicConcurrencyUpgradeStorageKey(normalizedUserId),
      String(startedAt),
    );
  } catch {
    // Session-level attribution still applies when storage is unavailable.
  }
  return true;
}

export function trackBasicConcurrencyUpgradeEvent(
  userId: string,
  action: string,
  name?: string,
  value?: number,
) {
  if (!hasActiveBasicConcurrencyUpgradeJourney(userId)) {
    return false;
  }
  return trackSubscriptionConversion(action, name, value);
}

export function trackBasicConcurrencyUpgradeGoal(
  userId: string,
  revenue: number,
) {
  if (!hasActiveBasicConcurrencyUpgradeJourney(userId)) {
    return false;
  }

  const queue = getMatomoQueue();
  if (!queue || !Number.isFinite(revenue) || revenue < 0) {
    return false;
  }

  queue.push(["trackGoal", BASIC_CONCURRENCY_UPGRADE_GOAL_ID, revenue]);
  return true;
}

export function trackPaidSubscriptionObserved(
  userId: string,
  plan?: string | null,
  expiresAt?: string | null,
) {
  const normalizedUserId = String(userId).trim();
  const normalizedPlan = String(plan || "").toLowerCase();
  if (
    !normalizedUserId ||
    !["pro", "flagship", "ultra"].includes(normalizedPlan)
  ) {
    return false;
  }

  if (!hasActiveBasicConcurrencyUpgradeJourney(normalizedUserId)) {
    return false;
  }

  const fingerprint = `${normalizedPlan}:${expiresAt || ""}`;
  if (paidSubscriptionFingerprints.get(normalizedUserId) === fingerprint) {
    return false;
  }

  const storageKey = `${PAID_SUBSCRIPTION_STORAGE_PREFIX}${normalizedUserId}`;
  try {
    if (window.localStorage.getItem(storageKey) === fingerprint) {
      paidSubscriptionFingerprints.set(normalizedUserId, fingerprint);
      return false;
    }
  } catch {
    // Session-level deduplication still applies when storage is unavailable.
  }

  if (
    !trackSubscriptionConversion(
      "paid_subscription_observed",
      normalizedPlan,
    )
  ) {
    return false;
  }

  paidSubscriptionFingerprints.set(normalizedUserId, fingerprint);
  try {
    window.localStorage.setItem(storageKey, fingerprint);
  } catch {
    // Tracking remains valid when persistence is unavailable.
  }
  clearBasicConcurrencyUpgradeJourney(normalizedUserId);
  return true;
}

export function resetMatomoUser() {
  const queue = getMatomoQueue();

  if (!queue) {
    identifiedUserId = null;
    return;
  }

  if (identifiedUserId) {
    queue.push(["trackEvent", "user", "logout_success"]);
  }

  queue.push(["resetUserId"]);
  identifiedUserId = null;
}

type ObserveMatomoRouteOptions = {
  trackPageView: boolean;
  url?: string;
  title?: string;
};

export function observeMatomoRoute({
  trackPageView,
  url = getCurrentUrl(),
  title = typeof document === "undefined" ? "" : document.title,
}: ObserveMatomoRouteOptions) {
  if (!url || url === lastObservedUrl) {
    return false;
  }

  lastObservedUrl = url;

  if (!trackPageView) {
    return false;
  }

  const queue = getMatomoQueue();
  if (!queue) {
    return false;
  }

  const hostname =
    typeof window === "undefined" ? "" : window.location.hostname;
  queue.push(["setCustomUrl", url]);
  queue.push(["setDocumentTitle", `${hostname}/${title}`]);
  queue.push(["trackPageView"]);
  return true;
}
