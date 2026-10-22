// Chrome 86 supports AbortController but not abort reasons or throwIfAborted.
if (!("reason" in AbortSignal.prototype)) {
  const reasons = new WeakMap<AbortSignal, unknown>()
  const nativeAbort = AbortController.prototype.abort
  Object.defineProperty(AbortSignal.prototype, "reason", {
    configurable: true,
    get(this: AbortSignal) {
      if (!this.aborted) return undefined
      return reasons.has(this)
        ? reasons.get(this)
        : new DOMException("The operation was aborted", "AbortError")
    },
  })
  AbortController.prototype.abort = function (reason?: unknown) {
    if (!this.signal.aborted)
      reasons.set(
        this.signal,
        reason === undefined
          ? new DOMException("The operation was aborted", "AbortError")
          : reason
      )
    nativeAbort.call(this)
  }
}

// Vite transpiles syntax, while these platform APIs need runtime fallbacks.
if (!AbortSignal.prototype.throwIfAborted) {
  AbortSignal.prototype.throwIfAborted = function () {
    if (this.aborted) throw this.reason
  }
}

if (!AbortSignal.timeout) {
  AbortSignal.timeout = (milliseconds: number) => {
    const controller = new AbortController()
    window.setTimeout(
      () =>
        controller.abort(
          new DOMException("The operation timed out", "TimeoutError")
        ),
      milliseconds
    )
    return controller.signal
  }
}

// getRandomValues is available in Chrome 86 and also on HTTP intranet deployments.
if (globalThis.crypto && !crypto.randomUUID) {
  crypto.randomUUID = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (value) =>
      value.toString(16).padStart(2, "0")
    ).join("")
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
}
