import { describe, expect, it } from "vitest";
import {
  previewCaptureButtonDisabled,
  previewCapturePending,
  previewNativeShouldHide,
  transitionPreviewCapture,
  type PreviewCaptureState,
} from "./previewCaptureState";

const pending: PreviewCaptureState = { requestId: "active", purpose: "mark" };

describe("preview capture state machine", () => {
  it("keeps the native preview visible while capture is pending", () => {
    expect(previewCapturePending(pending)).toBe(true);
    expect(previewNativeShouldHide(pending)).toBe(false);
  });

  it("disables capture until listeners are ready and while a request exists", () => {
    expect(previewCaptureButtonDisabled(true, false, null)).toBe(true);
    expect(previewCaptureButtonDisabled(true, true, null)).toBe(false);
    expect(previewCaptureButtonDisabled(true, true, pending)).toBe(true);
  });

  it.each(["timeout", "cancel", "error"] as const)("clears the matching request on %s", (type) => {
    expect(transitionPreviewCapture(pending, { type, requestId: "active" })).toBeNull();
  });

  it("ignores late events after cancellation or from another request", () => {
    const cancelled = transitionPreviewCapture(pending, { type: "cancel", requestId: "active" });
    expect(transitionPreviewCapture(cancelled, { type: "captured", requestId: "active", dataUrl: "data:image/png;base64,x" })).toBeNull();
    expect(transitionPreviewCapture(pending, { type: "captured", requestId: "stale", dataUrl: "stale" })).toBe(pending);
  });

  it("hides the native preview after success and while the result overlay is shown", () => {
    const captured = transitionPreviewCapture(pending, { type: "captured", requestId: "active", dataUrl: "data:image/png;base64,x" });
    expect(previewCapturePending(captured)).toBe(false);
    expect(previewNativeShouldHide(captured)).toBe(true);
    expect(previewNativeShouldHide(null)).toBe(false);
  });
});
