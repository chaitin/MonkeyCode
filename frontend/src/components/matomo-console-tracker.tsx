import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAppRuntime } from "@/components/app-runtime-provider";
import {
  identifyMatomoUser,
  observeMatomoRoute,
  trackMatomoAuthenticated,
} from "@/lib/matomo";

function isConsolePath(pathname: string) {
  return pathname === "/console" || pathname.startsWith("/console/");
}

export function MatomoConsoleTracker() {
  const { auth } = useAppRuntime();
  const location = useLocation();

  useEffect(() => {
    const normalizedPath = location.pathname.replace(/\/+$/, "") || "/";
    const consolePath = isConsolePath(normalizedPath);

    if (!consolePath) {
      observeMatomoRoute({ trackPageView: false });
      return;
    }

    // /console immediately redirects to its index route. Waiting avoids counting both URLs.
    if (normalizedPath === "/console") {
      return;
    }

    const userId = auth.user?.id;
    if (auth.status !== "authenticated" || !userId) {
      return;
    }

    const identified = identifyMatomoUser(userId);
    const pageViewTracked = observeMatomoRoute({ trackPageView: true });

    // A direct page load already produced the anonymous page view in index.html.
    // Send an event after identification instead of duplicating that page view.
    if (identified && !pageViewTracked) {
      trackMatomoAuthenticated();
    }
  }, [
    auth.status,
    auth.user?.id,
    location.hash,
    location.pathname,
    location.search,
  ]);

  return null;
}
