import { useEffect } from "react";
import { desktopEndpointClient } from "@/lib/desktop-endpoint-client";

export function DesktopEndpointBridge({ authenticated }: { authenticated: boolean }) {
  useEffect(() => {
    if (!authenticated || !window.monkeyCodeDesktop?.endpointBridge) return;
    void desktopEndpointClient.start(window.location.origin).catch(() => undefined);
    return () => {
      void desktopEndpointClient.stop();
    };
  }, [authenticated]);

  return null;
}
