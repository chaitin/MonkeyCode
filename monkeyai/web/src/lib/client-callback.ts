const registeredCallbacks: Record<string, string> = {
  "monkeyai-desktop": "monkeyai-desktop://oauth/callback",
  "monkeyai-mobile": "monkeyai-mobile://oauth/callback",
}

// Mirror the server's native/loopback destinations, and bind the issued URL to
// the destination shown on the confirmation page. Never navigate arbitrary URLs.
export function isSafeClientLaunchURL(
  clientID: string,
  redirectURI: string,
  launchURL: string
): boolean {
  const registered = registeredCallbacks[clientID]
  if (!registered) return false
  if (redirectURI !== registered) {
    if (clientID !== "monkeyai-desktop") return false
    const loopback =
      /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})\/oauth\/callback$/.exec(
        redirectURI
      )
    if (!loopback || Number(loopback[1]) > 65535) return false
  }
  try {
    const target = new URL(launchURL)
    if (target.hash || target.username || target.password) return false
    const parameters = target.searchParams
    if (
      parameters.getAll("code").length !== 1 ||
      !parameters.get("code") ||
      parameters.getAll("state").length !== 1 ||
      !parameters.get("state") ||
      [...parameters.keys()].some((key) => key !== "code" && key !== "state")
    )
      return false
    target.search = ""
    return target.href === new URL(redirectURI).href
  } catch {
    return false
  }
}
