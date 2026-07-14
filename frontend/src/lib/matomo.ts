type MatomoCommand = [name: string, ...args: unknown[]];

declare global {
  interface Window {
    _paq?: MatomoCommand[];
  }
}

let identifiedUserId: string | null = null;
let lastObservedUrl = getCurrentUrl();

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
